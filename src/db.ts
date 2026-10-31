import { Env, UserRow, NodeRow, MaterialRow, FolderWithMaterials, isReservedButton } from "./types";

export function getBackupChannelId(env: Env): string | null {
  return env.BACKUP_CHANNEL_ID || null;
}

export async function getUser(env: Env, telegramId: number, fullName?: string): Promise<UserRow> {
  const superAdminId = env.SUPER_ADMIN_ID ? parseInt(env.SUPER_ADMIN_ID, 10) : null;
  const isSuper = superAdminId && telegramId === superAdminId;

  let user = await env.DB.prepare("SELECT * FROM users WHERE telegram_id = ?")
    .bind(telegramId)
    .first<UserRow>();

  if (!user) {
    const defaultRole = isSuper ? "super_admin" : "student";
    const defaultView = isSuper ? "admin" : "student";
    await env.DB.prepare(
      "INSERT INTO users (telegram_id, full_name, role, current_node_id, bot_state, view_mode, notifications_enabled) VALUES (?, ?, ?, NULL, 'browsing', ?, 1)"
    )
      .bind(telegramId, fullName || null, defaultRole, defaultView)
      .run();

    user = {
      telegram_id: telegramId,
      full_name: fullName || null,
      role: defaultRole,
      view_mode: defaultView,
      managed_node_id: null,
      current_node_id: null,
      bot_state: "browsing",
      subscribed_dept_id: null,
      notifications_enabled: 1,
      pending_target_id: null,
    };
  } else if (isSuper && user.role !== "super_admin") {
    await env.DB.prepare("UPDATE users SET role = 'super_admin' WHERE telegram_id = ?")
      .bind(telegramId)
      .run();
    user.role = "super_admin";
  }

  if (!user.view_mode) {
    user.view_mode = user.role === "student" ? "student" : "admin";
  }
  if (user.notifications_enabled === undefined || user.notifications_enabled === null) {
    user.notifications_enabled = 1;
  }

  return user;
}

export async function updateUserState(
  env: Env,
  telegramId: number,
  state: UserRow["bot_state"],
  currentNodeId?: number | null,
  managedNodeId?: number | null,
  pendingTargetId?: number | null
): Promise<void> {
  const updates: string[] = ["bot_state = ?"];
  const params: any[] = [state];

  if (currentNodeId !== undefined) {
    updates.push("current_node_id = ?");
    params.push(currentNodeId);
  }
  if (managedNodeId !== undefined) {
    updates.push("managed_node_id = ?");
    params.push(managedNodeId);
  }
  if (pendingTargetId !== undefined) {
    updates.push("pending_target_id = ?");
    params.push(pendingTargetId);
  }

  params.push(telegramId);
  const sql = `UPDATE users SET ${updates.join(", ")} WHERE telegram_id = ?`;
  await env.DB.prepare(sql).bind(...params).run();
}

export async function canManage(env: Env, user: UserRow, nodeId: number | null): Promise<boolean> {
  if (user.view_mode === "student") return false;
  if (user.role === "super_admin") return true;
  if (user.role === "leader") {
    if (nodeId === null) return false;
    const match = await env.DB.prepare(
      `WITH RECURSIVE ancestors(id, parent_id) AS (
        SELECT id, parent_id FROM nodes WHERE id = ?
        UNION ALL
        SELECT n.id, n.parent_id FROM nodes n JOIN ancestors a ON n.id = a.parent_id
      )
      SELECT 1 FROM ancestors a JOIN user_permissions p ON a.id = p.node_id WHERE p.telegram_id = ? LIMIT 1`
    )
      .bind(nodeId, user.telegram_id)
      .first();
    return !!match;
  }
  return false;
}

export async function canManageDept(env: Env, user: UserRow, deptId: number): Promise<boolean> {
  if (user.role === "super_admin") return true;
  if (user.role === "leader") {
    const has = await env.DB.prepare(
      "SELECT 1 FROM user_permissions WHERE telegram_id = ? AND node_id = ? LIMIT 1"
    ).bind(user.telegram_id, deptId).first();
    return !!has;
  }
  return false;
}

export function isPrivileged(user: UserRow): boolean {
  return user.role === "super_admin" || user.role === "leader";
}

export async function getNodeHierarchy(
  env: Env,
  nodeId: number
): Promise<{
  rootDept: NodeRow | null;
  semesterNode: NodeRow | null;
  courseNode: NodeRow | null;
  depth: number;
  breadcrumb: string;
}> {
  const { results: ancestors } = await env.DB.prepare(
    `WITH RECURSIVE node_path(id, parent_id, title, sort_order, created_by, is_full_width, depth) AS (
      SELECT id, parent_id, title, sort_order, created_by, is_full_width, 0 FROM nodes WHERE id = ?
      UNION ALL
      SELECT n.id, n.parent_id, n.title, n.sort_order, n.created_by, n.is_full_width, np.depth + 1
      FROM nodes n JOIN node_path np ON n.id = np.parent_id
    )
    SELECT * FROM node_path ORDER BY depth DESC`
  ).bind(nodeId).all<NodeRow & { depth: number }>();

  if (!ancestors || ancestors.length === 0) {
    return { rootDept: null, semesterNode: null, courseNode: null, depth: 0, breadcrumb: "" };
  }
  const rootDept = ancestors[0] || null;
  const semesterNode = ancestors.length >= 2 ? ancestors[1] : null;
  const courseNode = ancestors.length >= 3 ? ancestors[2] : null;
  const depth = ancestors.length;
  const breadcrumb = ancestors.map((a) => a.title).join(" ⬅️ ");
  return { rootDept, semesterNode, courseNode, depth, breadcrumb };
}

export async function handleFolderCreateOrRename(
  env: Env,
  user: UserRow,
  rawInput: string,
  isRename: boolean,
  targetNodeId: number | null,
  explicitParentId?: number | null
): Promise<{ ok: boolean; cleanTitle?: string; errorMsg?: string }> {
  const cleanTitle = rawInput.trim();

  if (isReservedButton(cleanTitle)) {
    return { ok: false, errorMsg: "⚠️ لا يمكن استخدام هذا الاسم لأنه يطابق زراً أو أمراً محجوزاً في النظام." };
  }

  let parentId: number | null = null;
  if (explicitParentId !== undefined) {
    parentId = explicitParentId;
  } else if (isRename && targetNodeId) {
    const node = await env.DB.prepare("SELECT parent_id FROM nodes WHERE id = ?").bind(targetNodeId).first<{ parent_id: number | null }>();
    parentId = node?.parent_id ?? null;
  } else {
    parentId = user.current_node_id;
  }

  const duplicate = await env.DB.prepare(
    `SELECT id FROM nodes 
     WHERE (parent_id IS ? OR parent_id = ?) 
     AND LOWER(TRIM(title)) = LOWER(?) 
     AND (? IS NULL OR id != ?)`
  ).bind(parentId, parentId, cleanTitle, targetNodeId, targetNodeId).first();

  if (duplicate) {
    return { ok: false, errorMsg: "⚠️ يوجد مجلد أو خانة أخرى بنفس هذا الاسم في هذا المستوى بالفعل." };
  }

  return { ok: true, cleanTitle };
}

export async function getChildNodes(env: Env, parentId: number | null): Promise<NodeRow[]> {
  if (parentId === null) {
    const { results } = await env.DB.prepare(
      "SELECT * FROM nodes WHERE parent_id IS NULL ORDER BY sort_order ASC, id ASC"
    ).all<NodeRow>();
    return results || [];
  } else {
    const { results } = await env.DB.prepare(
      "SELECT * FROM nodes WHERE parent_id = ? ORDER BY sort_order ASC, id ASC"
    )
      .bind(parentId)
      .all<NodeRow>();
    return results || [];
  }
}

export async function getNodeMaterials(env: Env, nodeId: number): Promise<MaterialRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM materials WHERE node_id = ? ORDER BY id ASC"
  )
    .bind(nodeId)
    .all<MaterialRow>();
  return results || [];
}

/**
 * Enhanced full-depth recursive material collector for "📦 عرض وتحميل كل المحتوى"
 */
export async function getAllDescendantMaterialsGrouped(
  env: Env,
  nodeId: number
): Promise<FolderWithMaterials[]> {
  const { results: descNodes } = await env.DB.prepare(
    `WITH RECURSIVE tree(id, title, depth, sort_order) AS (
      SELECT id, title, 1, sort_order FROM nodes WHERE parent_id = ?
      UNION ALL
      SELECT n.id, tree.title || ' / ' || n.title, tree.depth + 1, n.sort_order
      FROM nodes n JOIN tree ON n.parent_id = tree.id
    )
    SELECT id, title FROM tree ORDER BY depth ASC, sort_order ASC, id ASC`
  ).bind(nodeId).all<{ id: number; title: string }>();

  if (!descNodes || descNodes.length === 0) return [];

  const childIds = descNodes.map((c) => c.id);
  const placeholders = childIds.map(() => "?").join(",");
  const { results: allMaterials } = await env.DB.prepare(
    `SELECT * FROM materials WHERE node_id IN (${placeholders}) ORDER BY id ASC`
  ).bind(...childIds).all<MaterialRow>();

  const result: FolderWithMaterials[] = [];
  for (const node of descNodes) {
    const mats = (allMaterials || []).filter((m) => m.node_id === node.id);
    if (mats.length > 0) {
      result.push({
        folderPath: node.title,
        materials: mats,
      });
    }
  }
  return result;
}
