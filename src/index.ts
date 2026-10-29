import { Bot, webhookCallback, Keyboard, InlineKeyboard } from "grammy";

export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  SUPER_ADMIN_ID?: string;
  BACKUP_CHANNEL_ID?: string;
}

interface UserRow {
  telegram_id: number;
  full_name: string | null;
  role: "student" | "leader" | "super_admin";
  view_mode: "admin" | "student";
  managed_node_id: number | null;
  current_node_id: number | null;
  bot_state:
    | "browsing"
    | "awaiting_folder"
    | "uploading"
    | "renaming"
    | "deleting"
    | "awaiting_leader_id"
    | "awaiting_broadcast"
    | "awaiting_admin_broadcast"
    | "awaiting_submission"
    | "awaiting_submission_folder"
    | "awaiting_task_title"
    | "awaiting_task_days"
    | "awaiting_task_attachment";
  subscribed_dept_id: number | null;
  notifications_enabled: number;
  pending_target_id: number | null;
}

interface NodeRow {
  id: number;
  parent_id: number | null;
  title: string;
  sort_order: number;
  created_by: number | null;
  is_full_width: number;
}

interface MaterialRow {
  id: number;
  node_id: number;
  file_name: string;
  telegram_file_id: string;
  file_type: "document" | "video" | "photo" | "audio" | "link";
  caption: string | null;
  uploaded_by: number | null;
  created_at: string;
  backup_message_id?: number | null;
}

interface FolderWithMaterials {
  folderPath: string;
  materials: MaterialRow[];
}

interface BroadcastJobRow {
  id: number;
  target_type: "department" | "all_admins";
  dept_node_id: number | null;
  dept_title: string;
  sender_id: number;
  from_chat_id: number;
  message_id: number;
  last_user_id: number;
  sent_count: number;
  failed_count: number;
  status: "pending" | "processing" | "completed" | "cancelled";
  created_at: string;
}

interface SubmissionRow {
  id: number;
  course_node_id: number;
  student_id: number;
  student_name: string | null;
  file_name: string;
  telegram_file_id: string;
  file_type: "document" | "photo" | "video";
  caption: string | null;
  backup_message_id: number | null;
  status: "pending" | "approved" | "ignored";
  created_at: string;
}

interface WeeklyTaskRow {
  id: number;
  dept_node_id: number;
  course_title: string;
  task_title: string;
  due_date: string;
  attachment_file_id: string | null;
  created_by: number | null;
  created_at: string;
}

// ================= INPUT VALIDATION & SAFE STATE GUARD =================

const RESERVED_PATTERNS = [
  "Back", "Cancel", "رجوع", "إلغاء", "تم",
  "إضافة", "رفع", "تعديل", "حذف",
  "تخصيص", "تحميل", "عرض وتحميل",
  "الرئيسية", "القائمة", "وضع", "إعدادات", "الإشعارات",
  "تاسكات", "ساهم", "إرسال", "اشتراك", "تخطي"
];

function isReservedButton(text: string): boolean {
  const clean = text.trim();
  if (!clean || clean.startsWith("/")) return true;
  return RESERVED_PATTERNS.some((pattern) => clean.includes(pattern));
}

// ================= BACKGROUND BROADCAST QUEUE WORKER =================

async function processBroadcastQueue(env: Env): Promise<void> {
  const bot = new Bot(env.BOT_TOKEN);

  // Fetch oldest pending or processing broadcast job
  const job = await env.DB.prepare(
    "SELECT * FROM broadcast_jobs WHERE status IN ('pending', 'processing') ORDER BY id ASC LIMIT 1"
  ).first<BroadcastJobRow>();

  if (!job) return;

  if (job.status === "pending") {
    await env.DB.prepare("UPDATE broadcast_jobs SET status = 'processing' WHERE id = ?")
      .bind(job.id)
      .run();
  }

  // Fetch up to 35 recipients per tick (stays well below Cloudflare free tier subrequest limit of 50)
  let students: { telegram_id: number }[] = [];

  if (job.target_type === "all_admins") {
    const { results } = await env.DB.prepare(
      `SELECT telegram_id FROM users 
       WHERE role IN ('leader', 'super_admin') AND telegram_id > ? 
       ORDER BY telegram_id ASC LIMIT 35`
    )
      .bind(job.last_user_id || 0)
      .all<{ telegram_id: number }>();
    students = results || [];
  } else {
    const { results } = await env.DB.prepare(
      `SELECT telegram_id FROM users 
       WHERE subscribed_dept_id = ? AND notifications_enabled = 1 AND telegram_id > ? 
       ORDER BY telegram_id ASC LIMIT 35`
    )
      .bind(job.dept_node_id, job.last_user_id || 0)
      .all<{ telegram_id: number }>();
    students = results || [];
  }

  if (students.length === 0) {
    // All recipients processed for this job
    await env.DB.prepare("UPDATE broadcast_jobs SET status = 'completed' WHERE id = ?")
      .bind(job.id)
      .run();

    // Send completion report to sender
    try {
      await bot.api.sendMessage(
        job.sender_id,
        `📢 **تقرير إرسال الإشعار:**\n\n` +
          `• الوجهة: **${job.dept_title}**\n` +
          `• تم الإرسال بنجاح: **${job.sent_count}** ✅\n` +
          `• تعذر الإرسال (أو حظر البوت): **${job.failed_count}** ⚠️\n\n` +
          `✅ اكتمل إرسال الإشعار لجميع المستهدفين بنجاح.`,
        { parse_mode: "Markdown" }
      );
    } catch (e) {}

    // Check if there is another pending job in queue
    const nextJob = await env.DB.prepare(
      "SELECT 1 FROM broadcast_jobs WHERE status IN ('pending', 'processing') LIMIT 1"
    ).first();
    if (nextJob) {
      await processBroadcastQueue(env);
    }
    return;
  }

  let sent = 0;
  let failed = 0;
  let maxUserId = job.last_user_id || 0;

  for (const student of students) {
    maxUserId = Math.max(maxUserId, student.telegram_id);
    try {
      await bot.api.copyMessage(student.telegram_id, job.from_chat_id, job.message_id);
      sent++;
    } catch (err: any) {
      failed++;
      // Auto-mute if student blocked bot, deactivated account, or chat not found (Telegram 403)
      if (
        err?.error_code === 403 ||
        err?.description?.includes("blocked") ||
        err?.description?.includes("deactivated") ||
        err?.description?.includes("chat not found")
      ) {
        try {
          await env.DB.prepare("UPDATE users SET notifications_enabled = 0 WHERE telegram_id = ?")
            .bind(student.telegram_id)
            .run();
        } catch (dbErr) {}
      }
    }
  }

  // Update cursor and counts in atomic transaction
  await env.DB.prepare(
    `UPDATE broadcast_jobs 
     SET sent_count = sent_count + ?, failed_count = failed_count + ?, last_user_id = ? 
     WHERE id = ?`
  )
    .bind(sent, failed, maxUserId, job.id)
    .run();
}

// ================= MAIN WORKER EXPORT =================

export default {
  async scheduled(event: ScheduledEvent, env: Env, executionCtx: ExecutionContext): Promise<void> {
    executionCtx.waitUntil(processBroadcastQueue(env));
  },

  async fetch(request: Request, env: Env, executionCtx: ExecutionContext): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("FCAI Telegram Bot Worker is running smoothly 🚀", { status: 200 });
    }

    const bot = new Bot(env.BOT_TOKEN);

    // ================= HELPER FUNCTIONS =================

    let cachedBackupChannelId: string | null = null;
    function getBackupChannelId(): string | null {
      if (cachedBackupChannelId) return cachedBackupChannelId;
      return env.BACKUP_CHANNEL_ID || null;
    }

    async function getUser(telegramId: number, fullName?: string): Promise<UserRow> {
      const superAdminId = env.SUPER_ADMIN_ID ? parseInt(env.SUPER_ADMIN_ID, 10) : null;
      const isSuper = superAdminId && telegramId === superAdminId;

      let user = await env.DB.prepare("SELECT * FROM users WHERE telegram_id = ?")
        .bind(telegramId)
        .first<UserRow>();

      if (!user) {
        const defaultRole = isSuper ? "super_admin" : "student";
        await env.DB.prepare(
          "INSERT INTO users (telegram_id, full_name, role, current_node_id, bot_state, view_mode, notifications_enabled) VALUES (?, ?, ?, NULL, 'browsing', 'admin', 1)"
        )
          .bind(telegramId, fullName || null, defaultRole)
          .run();

        user = {
          telegram_id: telegramId,
          full_name: fullName || null,
          role: defaultRole,
          view_mode: "admin",
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
        user.view_mode = "admin";
      }
      if (user.notifications_enabled === undefined || user.notifications_enabled === null) {
        user.notifications_enabled = 1;
      }

      return user;
    }

    async function updateUserState(
      telegramId: number,
      state: UserRow["bot_state"],
      currentNodeId?: number | null,
      managedNodeId?: number | null,
      pendingTargetId?: number | null
    ) {
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

    async function canManage(user: UserRow, nodeId: number | null): Promise<boolean> {
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

    function isPrivileged(user: UserRow): boolean {
      return user.role === "super_admin" || user.role === "leader";
    }

    async function getRootDepartment(nodeId: number): Promise<NodeRow | null> {
      const res = await env.DB.prepare(
        `WITH RECURSIVE ancestors(id, parent_id, title, sort_order, created_by, is_full_width) AS (
          SELECT id, parent_id, title, sort_order, created_by, is_full_width FROM nodes WHERE id = ?
          UNION ALL
          SELECT n.id, n.parent_id, n.title, n.sort_order, n.created_by, n.is_full_width
          FROM nodes n JOIN ancestors a ON n.id = a.parent_id
        )
        SELECT * FROM ancestors WHERE parent_id IS NULL LIMIT 1`
      )
        .bind(nodeId)
        .first<NodeRow>();
      return res || null;
    }

    async function getCourseNode(nodeId: number): Promise<NodeRow | null> {
      const { results: ancestors } = await env.DB.prepare(
        `WITH RECURSIVE node_path(id, parent_id, title, sort_order, created_by, is_full_width, depth) AS (
          SELECT id, parent_id, title, sort_order, created_by, is_full_width, 0 FROM nodes WHERE id = ?
          UNION ALL
          SELECT n.id, n.parent_id, n.title, n.sort_order, n.created_by, n.is_full_width, np.depth + 1
          FROM nodes n JOIN node_path np ON n.id = np.parent_id
        )
        SELECT * FROM node_path ORDER BY depth DESC`
      ).bind(nodeId).all<NodeRow & { depth: number }>();

      if (!ancestors || ancestors.length < 3) return null;
      // ancestors[0] = Root Dept, ancestors[1] = Semester/Term, ancestors[2] = Course
      return ancestors[2] || null;
    }

    async function handleFolderCreateOrRename(
      user: UserRow,
      rawInput: string,
      isRename: boolean,
      targetNodeId: number | null
    ): Promise<{ ok: boolean; cleanTitle?: string; errorMsg?: string }> {
      const cleanTitle = rawInput.trim();

      // 1. Guard against reserved button labels
      if (isReservedButton(cleanTitle)) {
        return { ok: false, errorMsg: "⚠️ لا يمكن استخدام هذا الاسم لأنه يطابق زراً أو أمراً محجوزاً في النظام." };
      }

      // 2. Resolve parent ID
      let parentId: number | null = null;
      if (isRename && targetNodeId) {
        const node = await env.DB.prepare("SELECT parent_id FROM nodes WHERE id = ?").bind(targetNodeId).first<{ parent_id: number | null }>();
        parentId = node?.parent_id ?? null;
      } else {
        parentId = user.current_node_id;
      }

      // 3. Duplicate Prevention at the same level
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

    async function getChildNodes(parentId: number | null): Promise<NodeRow[]> {
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

    async function getNodeMaterials(nodeId: number): Promise<MaterialRow[]> {
      const { results } = await env.DB.prepare(
        "SELECT * FROM materials WHERE node_id = ? ORDER BY id ASC"
      )
        .bind(nodeId)
        .all<MaterialRow>();
      return results || [];
    }

    async function getAllDescendantMaterialsGrouped(
      nodeId: number
    ): Promise<FolderWithMaterials[]> {
      const { results: children } = await env.DB.prepare(
        "SELECT id, title FROM nodes WHERE parent_id = ? ORDER BY sort_order ASC, id ASC"
      ).bind(nodeId).all<{ id: number; title: string }>();

      if (!children || children.length === 0) return [];

      const childIds = children.map((c) => c.id);
      const placeholders = childIds.map(() => "?").join(",");
      const { results: allMaterials } = await env.DB.prepare(
        `SELECT * FROM materials WHERE node_id IN (${placeholders}) ORDER BY id ASC`
      ).bind(...childIds).all<MaterialRow>();

      const result: FolderWithMaterials[] = [];
      for (const child of children) {
        const mats = (allMaterials || []).filter((m) => m.node_id === child.id);
        if (mats.length > 0) {
          result.push({
            folderPath: child.title,
            materials: mats,
          });
        }
      }

      return result;
    }

    async function renderNotificationSettings(ctx: any, user: UserRow) {
      const { results: depts } = await env.DB.prepare(
        "SELECT id, title FROM nodes WHERE parent_id IS NULL ORDER BY sort_order ASC, id ASC"
      ).all<{ id: number; title: string }>();

      let currentSubDeptTitle = "غير محدد";
      if (user.subscribed_dept_id) {
        const subDept = (depts || []).find((d) => d.id === user.subscribed_dept_id);
        if (subDept) {
          currentSubDeptTitle = subDept.title;
        }
      }

      const inlineKeyboard = new InlineKeyboard();

      for (const dept of depts || []) {
        const isSubbed = user.subscribed_dept_id === dept.id;
        const icon = isSubbed ? "✅ " : "";
        inlineKeyboard.text(`${icon}${dept.title}`, `sub_dept_${dept.id}`).row();
      }

      if (user.notifications_enabled === 1) {
        inlineKeyboard.text("🔕 كتم الإشعارات مؤقتاً", "mute_notifications").row();
      } else {
        inlineKeyboard.text("🔔 تفعيل الإشعارات", "unmute_notifications").row();
      }

      inlineKeyboard.text("❌ إغلاق", "close_notifications");

      const statusText = user.notifications_enabled === 1 ? "مفعلة ✅" : "مكتومة 🔕";
      const messageText =
        `🔔 **إعدادات الإشعارات واشتراك الأقسام:**\n\n` +
        `• قسمك المشترك به: **${currentSubDeptTitle}**\n` +
        `• حالة وصول التنبيهات: **${statusText}**\n\n` +
        `📌 باشتراكك في قسمك، ستصلك تنبيهات فورية عند رفع محاضرات أو ملفات جديدة أو إعلانات وتاسكات تخص قسمك فقط.\n\n` +
        `اختر قسمك من القائمة أدناه لتحديث الاشتراك 👇`;

      if (ctx.callbackQuery) {
        try {
          await ctx.editMessageText(messageText, { parse_mode: "Markdown", reply_markup: inlineKeyboard });
        } catch {
          await ctx.reply(messageText, { parse_mode: "Markdown", reply_markup: inlineKeyboard });
        }
      } else {
        await ctx.reply(messageText, { parse_mode: "Markdown", reply_markup: inlineKeyboard });
      }
    }

    async function renderWeeklyTasks(ctx: any, user: UserRow) {
      if (!user.subscribed_dept_id) {
        const inlineKb = new InlineKeyboard()
          .text("🔔 تحديد واشتراك القسم الآن", "open_notifications_from_tasks")
          .row();
        return ctx.reply(
          `⚠️ **يرجى تحديد قسمك الأكاديمي أولاً!**\n\n` +
            `لعرض تاسكات وتسليمات المواد الخاصة بقسمك بدقة، اضغط الزر أدناه لاختيار قسمك.`,
          { parse_mode: "Markdown", reply_markup: inlineKb }
        );
      }

      const deptNode = await env.DB.prepare("SELECT title FROM nodes WHERE id = ?")
        .bind(user.subscribed_dept_id)
        .first<{ title: string }>();

      const { results: tasks } = await env.DB.prepare(
        `SELECT * FROM weekly_tasks 
         WHERE dept_node_id = ? AND due_date >= datetime('now') 
         ORDER BY due_date ASC`
      )
        .bind(user.subscribed_dept_id)
        .all<WeeklyTaskRow>();

      if (!tasks || tasks.length === 0) {
        return ctx.reply(
          `🎉 **لا توجد تسليمات أو تاسكات مطلوبة حالياً!**\n\n` +
            `• القسم: **${deptNode?.title || "قسمك الأكاديمي"}**\n` +
            `استمتع بوقتك وراجع محاضراتك أولاً بأول! 🚀`,
          { parse_mode: "Markdown" }
        );
      }

      const inlineKeyboard = new InlineKeyboard();
      let message = `📅 **تاسكات وتسليمات الأسبوع — [${deptNode?.title}]:**\n\n`;

      const now = Date.now();
      tasks.forEach((t, index) => {
        const dueTime = new Date(t.due_date).getTime();
        const diffHours = Math.round((dueTime - now) / (1000 * 60 * 60));
        const diffDays = Math.ceil(diffHours / 24);
        const remainingText = diffHours <= 24 ? `متبقي ${Math.max(1, diffHours)} ساعة ⚠️` : `متبقي ${diffDays} يوم`;

        message += `${index + 1}️⃣ **مادة ${t.course_title}**\n`;
        message += `📝 **التكليف:** ${t.task_title}\n`;
        message += `⏰ **الموعد النهائي:** ${t.due_date} (${remainingText})\n\n`;

        if (t.attachment_file_id) {
          inlineKeyboard.text(`📥 تحميل شيت: ${t.course_title}`, `dl_task_${t.id}`).row();
        }
      });

      inlineKeyboard.text("❌ إغلاق", "close_tasks");

      await ctx.reply(message, { parse_mode: "Markdown", reply_markup: inlineKeyboard });
    }

    async function renderStats(ctx: any, user: UserRow) {
      if (user.role === "super_admin") {
        const totalUsers = (await env.DB.prepare("SELECT COUNT(*) as c FROM users").first<{ c: number }>())?.c || 0;
        const activeSub = (await env.DB.prepare("SELECT COUNT(*) as c FROM users WHERE notifications_enabled = 1 AND subscribed_dept_id IS NOT NULL").first<{ c: number }>())?.c || 0;
        const mutedUsers = (await env.DB.prepare("SELECT COUNT(*) as c FROM users WHERE notifications_enabled = 0").first<{ c: number }>())?.c || 0;

        const { results: depts } = await env.DB.prepare(
          "SELECT id, title FROM nodes WHERE parent_id IS NULL ORDER BY sort_order ASC, id ASC"
        ).all<{ id: number; title: string }>();

        let deptDetails = "";
        for (const d of depts || []) {
          const subCount = (await env.DB.prepare("SELECT COUNT(*) as c FROM users WHERE subscribed_dept_id = ?").bind(d.id).first<{ c: number }>())?.c || 0;
          const pct = totalUsers > 0 ? Math.round((subCount / totalUsers) * 100) : 0;

          const matCount = (await env.DB.prepare(
            `WITH RECURSIVE subnodes(id) AS (
              SELECT id FROM nodes WHERE id = ?
              UNION ALL
              SELECT n.id FROM nodes n JOIN subnodes s ON n.parent_id = s.id
            )
            SELECT COUNT(*) as c FROM materials WHERE node_id IN (SELECT id FROM subnodes)`
          ).bind(d.id).first<{ c: number }>())?.c || 0;

          deptDetails += `• **${d.title}:**\n  👥 الطلاب المشتركون: **${subCount}** (${pct}%)\n  📚 الملفات المرفوعة: **${matCount}** ملف\n\n`;
        }

        // Empty courses check (gap analysis)
        const { results: allCourses } = await env.DB.prepare(
          `SELECT c.id, c.title, d.title as dept_title
           FROM nodes c
           JOIN nodes t ON c.parent_id = t.id
           JOIN nodes d ON t.parent_id = d.id
           WHERE d.parent_id IS NULL`
        ).all<{ id: number; title: string; dept_title: string }>();

        const emptyCourses: string[] = [];
        for (const c of allCourses || []) {
          const hasMats = await env.DB.prepare(
            `WITH RECURSIVE subnodes(id) AS (
              SELECT id FROM nodes WHERE id = ?
              UNION ALL
              SELECT n.id FROM nodes n JOIN subnodes s ON n.parent_id = s.id
            )
            SELECT 1 FROM materials WHERE node_id IN (SELECT id FROM subnodes) LIMIT 1`
          ).bind(c.id).first();

          if (!hasMats) {
            emptyCourses.push(`${c.title} (${c.dept_title})`);
          }
        }

        let emptySection = "";
        if (emptyCourses.length > 0) {
          emptySection = `⚠️ **المواد الفارغة (بدون أي ملفات حتى الآن):**\n` + emptyCourses.map(e => `• ${e}`).join("\n");
        } else {
          emptySection = `🎉 **رائع! جميع المواد تم رفع محتوى بداخلها.**`;
        }

        const text =
          `📊 **لوحة إحصائيات النظام الشاملة (Super Admin):**\n\n` +
          `👤 إجمالي مستخدمي البوت: **${totalUsers}** مستخدم\n` +
          `🔔 الإشعارات النشطة: **${activeSub}** طالب ✅\n` +
          `🔕 الإشعارات المكتومة: **${mutedUsers}** ⚠️\n\n` +
          `🏫 **تفاصيل الأقسام:**\n${deptDetails}` +
          `${emptySection}`;

        await ctx.reply(text, { parse_mode: "Markdown" });
        return;
      }

      if (user.role === "leader") {
        const { results: perms } = await env.DB.prepare(
          `SELECT n.id, n.title FROM user_permissions p JOIN nodes n ON p.node_id = n.id WHERE p.telegram_id = ?`
        ).bind(user.telegram_id).all<{ id: number; title: string }>();

        if (!perms || perms.length === 0) {
          return ctx.reply("⚠️ لم يتم تعيين أي أقسام لك بعد.");
        }

        let text = `📊 **إحصائيات أقسامك المسندة إليك (Leader View):**\n\n`;

        for (const p of perms) {
          const subCount = (await env.DB.prepare(
            "SELECT COUNT(*) as c FROM users WHERE subscribed_dept_id = ? AND notifications_enabled = 1"
          ).bind(p.id).first<{ c: number }>())?.c || 0;

          const totalDeptUsers = (await env.DB.prepare(
            "SELECT COUNT(*) as c FROM users WHERE subscribed_dept_id = ?"
          ).bind(p.id).first<{ c: number }>())?.c || 0;

          const pendingSubmissions = (await env.DB.prepare(
            `WITH RECURSIVE subnodes(id) AS (
              SELECT id FROM nodes WHERE id = ?
              UNION ALL
              SELECT n.id FROM nodes n JOIN subnodes s ON n.parent_id = s.id
            )
            SELECT COUNT(*) as c FROM submissions WHERE status = 'pending' AND course_node_id IN (SELECT id FROM subnodes)`
          ).bind(p.id).first<{ c: number }>())?.c || 0;

          const activeTasks = (await env.DB.prepare(
            "SELECT COUNT(*) as c FROM weekly_tasks WHERE dept_node_id = ? AND due_date >= datetime('now')"
          ).bind(p.id).first<{ c: number }>())?.c || 0;

          text +=
            `🏫 **قسم ${p.title}:**\n` +
            `• المشتركون في الإشعارات: **${subCount}** طالب (من أصل ${totalDeptUsers})\n` +
            `• تاسكات الأسبوع النشطة: **${activeTasks}** تاسك\n` +
            `• مساهمات الطلاب بانتظار المراجعة: **${pendingSubmissions}** مساهمة ${pendingSubmissions > 0 ? "⚠️" : "✅"}\n\n`;
        }

        await ctx.reply(text, { parse_mode: "Markdown" });
        return;
      }

      await ctx.reply("❌ هذا الأمر مخصص للمسؤولين والليدرز فقط.");
    }

    async function renderFolderView(ctx: any, user: UserRow, nodeId: number | null) {
      const children = await getChildNodes(nodeId);
      const materials = nodeId ? await getNodeMaterials(nodeId) : [];
      const isManager = await canManage(user, nodeId);
      const privileged = isPrivileged(user);
      const courseNode = nodeId ? await getCourseNode(nodeId) : null;

      const keyboard = new Keyboard();
      keyboard.resized();

      // Smart row formatting based on is_full_width
      let rowBuffer: NodeRow[] = [];
      for (const child of children) {
        if (child.is_full_width === 1) {
          if (rowBuffer.length > 0) {
            for (const b of rowBuffer) keyboard.text(b.title);
            keyboard.row();
            rowBuffer = [];
          }
          keyboard.text(child.title).row();
        } else {
          rowBuffer.push(child);
          if (rowBuffer.length === 2) {
            keyboard.text(rowBuffer[0].title).text(rowBuffer[1].title).row();
            rowBuffer = [];
          }
        }
      }
      if (rowBuffer.length > 0) {
        for (const b of rowBuffer) keyboard.text(b.title);
        keyboard.row();
      }

      // Fast single-query check for "Download All" button (0 lag)
      if (nodeId !== null && children.length > 0) {
        const hasDescendantMaterials = await env.DB.prepare(
          "SELECT 1 FROM materials WHERE node_id IN (SELECT id FROM nodes WHERE parent_id = ?) LIMIT 1"
        )
          .bind(nodeId)
          .first();

        if (hasDescendantMaterials) {
          keyboard.text("📦 عرض وتحميل كل المحتوى").row();
        }
      }

      // If this folder has direct materials, add a button to re-trigger sending
      if (materials.length > 0 && children.length > 0) {
        keyboard.text("📥 إرسال الملفات").row();
      }

      // Crowdsourced student note contribution button (visible to students inside course or its subfolders)
      if (!isManager && courseNode !== null) {
        keyboard.text("📝 ساهم بملخص أو امتحان").row();
      }

      // Admin Action Bar (if in admin view mode)
      if (isManager && nodeId !== null) {
        keyboard
          .text("📤 رفع ملفات هنا")
          .text("➕ إضافة خانة/مادة")
          .row()
          .text("✏️ تعديل الاسم")
          .text("📐 تخصيص العرض والصفوف")
          .row()
          .text("🗑️ حذف خانة أو ملف")
          .text("📢 إرسال إشعار للقسم")
          .row()
          .text("📅 إضافة تاسك للأسبوع")
          .row();
      } else if (isManager && nodeId === null) {
        keyboard
          .text("➕ إضافة قسم جديد")
          .text("📐 تخصيص العرض والصفوف")
          .row();
      }

      // Student tools at root level (nodeId === null)
      if (nodeId === null) {
        keyboard
          .text("📅 تاسكات وتسليمات الأسبوع الحالي")
          .row()
          .text("🔔 إعدادات الإشعارات واشتراك القسم")
          .row();
      }

      // Navigation Buttons
      if (nodeId !== null) {
        keyboard.text("⬅️ رجوع").text("🏠 الرئيسية").row();
      } else if (privileged) {
        keyboard.text("🏠 تبديل الوضع").row();
      }

      // Direct, clean message without current path clutter
      if (children.length > 0) {
        await ctx.reply("اختر من القوائم بالأسفل 👇", {
          reply_markup: keyboard,
        });
      } else if (materials.length === 0) {
        await ctx.reply("هذا القسم فارغ حالياً.", {
          reply_markup: keyboard,
        });
      } else {
        // Folder has direct materials and no subfolders
        await ctx.reply("الملفات المتاحة 👇", {
          reply_markup: keyboard,
        });
        await sendBatchMaterials(ctx, materials);
      }
    }

    async function sendBatchMaterials(ctx: any, materials: MaterialRow[]) {
      const chunkSize = 10;
      for (let i = 0; i < materials.length; i += chunkSize) {
        const chunk = materials.slice(i, i + chunkSize);
        
        const mediaGroup = chunk.map((m) => {
          let type: "document" | "video" | "photo" | "audio" = "document";
          if (m.file_type === "video") type = "video";
          else if (m.file_type === "photo") type = "photo";
          else if (m.file_type === "audio") type = "audio";
          return {
            type: type,
            media: m.telegram_file_id,
            caption: m.caption || m.file_name,
          };
        });

        try {
          if (mediaGroup.length === 1) {
            const single = chunk[0];
            if (single.file_type === "video") {
              await ctx.replyWithVideo(single.telegram_file_id, { caption: single.caption || single.file_name });
            } else if (single.file_type === "photo") {
              await ctx.replyWithPhoto(single.telegram_file_id, { caption: single.caption || single.file_name });
            } else if (single.file_type === "audio") {
              await ctx.replyWithAudio(single.telegram_file_id, { caption: single.caption || single.file_name });
            } else {
              await ctx.replyWithDocument(single.telegram_file_id, { caption: single.caption || single.file_name });
            }
          } else {
            await ctx.replyWithMediaGroup(mediaGroup);
          }
        } catch (e: any) {
          for (const m of chunk) {
            try {
              await ctx.replyWithDocument(m.telegram_file_id, { caption: m.caption || m.file_name });
            } catch (err) {}
          }
        }
      }
    }

    function buildWidthCustomizationKeyboard(children: NodeRow[], hasParent: boolean): InlineKeyboard {
      const inlineKeyboard = new InlineKeyboard();
      for (const child of children) {
        const statusIcon = child.is_full_width === 1 ? "🔘 صف كامل" : "👥 صف مزدوج";
        inlineKeyboard.text(`${statusIcon}: ${child.title}`, `toggle_width_${child.id}`).row();
      }

      if (hasParent) {
        inlineKeyboard.text("⚡ تطبيق هذا التنسيق على باقي مواد هذا القسم", "apply_layout_dept").row();
        inlineKeyboard.text("🌍 تطبيق هذا التنسيق على كل مواد الكلية", "apply_layout_all").row();
      }

      inlineKeyboard.text("❌ إغلاق", "close_customization");
      return inlineKeyboard;
    }

    async function buildDeleteKeyboard(nodeId: number): Promise<InlineKeyboard> {
      const children = await getChildNodes(nodeId);
      const materials = await getNodeMaterials(nodeId);

      const inlineKeyboard = new InlineKeyboard();
      for (const child of children) {
        inlineKeyboard.text(`📁 حذف: ${child.title}`, `del_node_${child.id}`).row();
      }
      for (const m of materials) {
        inlineKeyboard.text(`📄 حذف: ${m.file_name}`, `del_mat_${m.id}`).row();
      }
      inlineKeyboard.text("❌ إغلاق", "close_delete");
      return inlineKeyboard;
    }

    // ================= COMMANDS & LOGIC =================

    async function renderTopLevel(ctx: any, user: UserRow) {
      await updateUserState(user.telegram_id, "browsing", null, null, null);
      user.current_node_id = null;
      user.bot_state = "browsing";

      if (isPrivileged(user)) {
        const keyboard = new Keyboard()
          .text("🎓 وضع الطالب (تصفح المقررات)")
          .row()
          .text("⚙️ وضع المشرف (الإدارة والتحكم)")
          .resized();

        await ctx.reply(
          `👋 أهلاً بك يا ${user.full_name || ctx.from?.first_name || "مستخدم"}!\n\nبصفتك مسؤولاً، يرجى اختيار وضع الدخول:`,
          { reply_markup: keyboard }
        );
        return;
      }

      await renderFolderView(ctx, user, null);
    }

    bot.on("channel_post", async (ctx) => {
      const channelId = ctx.chat.id.toString();
      await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_channel_id', ?)")
        .bind(channelId)
        .run();
    });

    bot.command("start", async (ctx) => {
      const user = await getUser(ctx.from!.id, ctx.from!.first_name);
      await renderTopLevel(ctx, user);
    });

    bot.command(["notifications", "notify"], async (ctx) => {
      const user = await getUser(ctx.from!.id, ctx.from!.first_name);
      await renderNotificationSettings(ctx, user);
    });

    bot.command(["tasks", "deadlines"], async (ctx) => {
      const user = await getUser(ctx.from!.id, ctx.from!.first_name);
      await renderWeeklyTasks(ctx, user);
    });

    bot.command("stats", async (ctx) => {
      const user = await getUser(ctx.from!.id, ctx.from!.first_name);
      await renderStats(ctx, user);
    });

    bot.command("id", async (ctx) => {
      const id = ctx.from!.id;
      const name = ctx.from!.first_name || "مستخدم";
      await ctx.reply(
        `👤 **معلومات حسابك:**\n\n` +
          `• الاسم: **${name}**\n` +
          `• المعرف الخاص بك (Telegram ID):\n\`${id}\`\n\n` +
          `_(اضغط على الرقم لنسخه ومشاركته مع المسؤول مباشرة)_`,
        { parse_mode: "Markdown" }
      );
    });

    async function renderAdminPanel(ctx: any) {
      const backupChannel = await getBackupChannelId();
      const inlineKeyboard = new InlineKeyboard()
        .text("👥 إدارة الليدرز وصلاحيات الأقسام", "admin_list_leaders")
        .row()
        .text("📢 مراسلة جميع القادة والمشرفين", "admin_notify_all_leaders")
        .row()
        .text("📊 لوحة الإحصائيات الشاملة", "admin_stats")
        .row()
        .text("➕ تعيين ليدر جديد", "admin_add_leader")
        .row()
        .text("❌ إغلاق", "close_admin");

      const messageText =
        `👑 **لوحة تحكم المسؤول العام (Super Admin):**\n\n` +
        `• يمكنك تعيين ليدرز وتحديد الأقسام المسموح لكل ليدر بإدارتها.\n` +
        `• يمكنك إرسال تعميم فوري لكافة القادة والمشرفين.\n` +
        `• الاطلاع على الإحصائيات الشاملة والمواد التي لم تُرفع بعد.\n\n` +
        `• قناة الأرشيف: ${backupChannel ? `\`${backupChannel}\` ✅` : "غير مربوطة ⚠️"}`;

      if (ctx.callbackQuery) {
        try {
          await ctx.editMessageText(messageText, { parse_mode: "Markdown", reply_markup: inlineKeyboard });
        } catch {
          await ctx.reply(messageText, { parse_mode: "Markdown", reply_markup: inlineKeyboard });
        }
      } else {
        await ctx.reply(messageText, { parse_mode: "Markdown", reply_markup: inlineKeyboard });
      }
    }

    async function renderLeadersList(ctx: any) {
      const { results: leaders } = await env.DB.prepare(
        "SELECT telegram_id, full_name, role FROM users WHERE role = 'leader' ORDER BY full_name ASC, telegram_id ASC"
      ).all<{ telegram_id: number; full_name: string | null; role: string }>();

      const inlineKeyboard = new InlineKeyboard();
      let text = `👥 **قائمة الليدرز والصلاحيات:**\n\n`;

      if (!leaders || leaders.length === 0) {
        text += `لا يوجد ليدرز حالياً في النظام.\nاضغط الزر بالأسفل لتعيين ليدر جديد وتحديد أقسامه.`;
      } else {
        for (const leader of leaders) {
          const { results: depts } = await env.DB.prepare(
            "SELECT n.title FROM user_permissions p JOIN nodes n ON p.node_id = n.id WHERE p.telegram_id = ? ORDER BY n.sort_order ASC, n.id ASC"
          )
            .bind(leader.telegram_id)
            .all<{ title: string }>();

          const deptTitles = (depts || []).map((d) => d.title).join(" | ");
          text += `• 👤 **${leader.full_name || "بدون اسم"}** (\`${leader.telegram_id}\`)\n`;
          text += `  الأقسام: ${deptTitles ? `**${deptTitles}**` : "⚠️ لم تُحدد أي أقسام بعد"}\n\n`;

          inlineKeyboard.text(`⚙️ إعداد صلاحيات: ${leader.full_name || leader.telegram_id}`, `manage_leader_${leader.telegram_id}`).row();
        }
        text += `اضغط على أي ليدر بالأسفل لتعديل صلاحياته أو سحبها 👇`;
      }

      inlineKeyboard.text("➕ تعيين ليدر جديد", "admin_add_leader").row();
      inlineKeyboard.text("📢 مراسلة جميع القادة والمشرفين", "admin_notify_all_leaders").row();
      inlineKeyboard.text("⬅️ رجوع للوحة الإدارة", "admin_back_to_panel").row();

      if (ctx.callbackQuery) {
        try {
          await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: inlineKeyboard });
        } catch {
          await ctx.reply(text, { parse_mode: "Markdown", reply_markup: inlineKeyboard });
        }
      } else {
        await ctx.reply(text, { parse_mode: "Markdown", reply_markup: inlineKeyboard });
      }
    }

    async function renderLeaderPermissions(ctx: any, leaderId: number) {
      const leader = await env.DB.prepare("SELECT telegram_id, full_name FROM users WHERE telegram_id = ?")
        .bind(leaderId)
        .first<{ telegram_id: number; full_name: string | null }>();

      if (!leader) {
        if (ctx.callbackQuery) {
          await ctx.answerCallbackQuery({ text: "المستخدم غير موجود", show_alert: true });
        }
        return;
      }

      const { results: depts } = await env.DB.prepare(
        "SELECT id, title FROM nodes WHERE parent_id IS NULL ORDER BY sort_order ASC, id ASC"
      ).all<{ id: number; title: string }>();

      const { results: perms } = await env.DB.prepare(
        "SELECT node_id FROM user_permissions WHERE telegram_id = ?"
      )
        .bind(leaderId)
        .all<{ node_id: number }>();

      const permSet = new Set((perms || []).map((p) => p.node_id));

      const inlineKeyboard = new InlineKeyboard();
      for (const dept of depts || []) {
        const hasPerm = permSet.has(dept.id);
        const icon = hasPerm ? "✅" : "❌";
        inlineKeyboard.text(`${icon} ${dept.title}`, `toggle_perm_${leaderId}_${dept.id}`).row();
      }

      inlineKeyboard
        .text("🗑️ سحب رتبة الليدر وحذف الصلاحيات", `demote_leader_${leaderId}`)
        .row()
        .text("⬅️ رجوع لقائمة الليدرز", "admin_list_leaders")
        .row()
        .text("✅ حفظ وإنهاء", "close_admin");

      const text =
        `👤 **صلاحيات الليدر:**\n\n` +
        `• الاسم: **${leader.full_name || "بدون اسم"}**\n` +
        `• المعرف: \`${leader.telegram_id}\`\n\n` +
        `اضغط على أي قسم لتفعيله ✅ أو إيقافه ❌:\n` +
        `(الصلاحية تسري تلقائياً على كل مواد ومحاضرات القسم)`;

      if (ctx.callbackQuery) {
        try {
          await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: inlineKeyboard });
        } catch {
          await ctx.reply(text, { parse_mode: "Markdown", reply_markup: inlineKeyboard });
        }
      } else {
        await ctx.reply(text, { parse_mode: "Markdown", reply_markup: inlineKeyboard });
      }
    }

    bot.command("admin", async (ctx) => {
      const user = await getUser(ctx.from!.id);
      if (user.role !== "super_admin") {
        return ctx.reply("❌ هذا الأمر مخصص للمسؤول العام (Super Admin) فقط.");
      }
      await renderAdminPanel(ctx);
    });

    bot.command("leaders", async (ctx) => {
      const user = await getUser(ctx.from!.id);
      if (user.role !== "super_admin") {
        return ctx.reply("❌ هذا الأمر مخصص للمسؤول العام (Super Admin) فقط.");
      }
      await renderLeadersList(ctx);
    });

    bot.command("notify_admins", async (ctx) => {
      const user = await getUser(ctx.from!.id);
      if (user.role !== "super_admin") {
        return ctx.reply("❌ هذا الأمر مخصص للمسؤول العام فقط.");
      }
      await updateUserState(user.telegram_id, "awaiting_admin_broadcast");
      user.bot_state = "awaiting_admin_broadcast";
      const cancelKeyboard = new Keyboard().text("❌ إلغاء").resized();
      await ctx.reply(
        `📢 **مراسلة جميع القادة والمشرفين:**\n\n` +
          `✍️ أرسل الآن الرسالة أو المنشور المراد تعميمه على كافة الليدرز والمشرفين بالكلية.\n` +
          `(يمكنك إرسال نص، صورة، أو فيديو)\n\n` +
          `اضغط زر [❌ إلغاء] للتراجع.`,
        { parse_mode: "Markdown", reply_markup: cancelKeyboard }
      );
    });

    bot.command("promote", async (ctx) => {
      const admin = await getUser(ctx.from!.id);
      if (admin.role !== "super_admin") return;

      const parts = ctx.message!.text.split(" ");
      if (parts.length < 2) {
        return ctx.reply("يرجى كتابة: /promote <telegram_id>");
      }
      const targetId = parseInt(parts[1], 10);
      if (isNaN(targetId)) return ctx.reply("معرف غير صالح.");

      const existing = await env.DB.prepare("SELECT * FROM users WHERE telegram_id = ?").bind(targetId).first<UserRow>();
      if (!existing) {
        await env.DB.prepare("INSERT INTO users (telegram_id, full_name, role, bot_state, view_mode, notifications_enabled) VALUES (?, ?, 'leader', 'browsing', 'admin', 1)")
          .bind(targetId, `User ${targetId}`)
          .run();
      } else {
        await env.DB.prepare("UPDATE users SET role = 'leader' WHERE telegram_id = ?").bind(targetId).run();
      }

      await ctx.reply(`✅ تم ترقية المستخدم (${targetId}) إلى رتبة Leader بنجاح.`);
      await renderLeaderPermissions(ctx, targetId);
    });

    bot.command("demote", async (ctx) => {
      const admin = await getUser(ctx.from!.id);
      if (admin.role !== "super_admin") return;

      const parts = ctx.message!.text.split(" ");
      if (parts.length < 2) {
        return ctx.reply("يرجى كتابة: /demote <telegram_id>");
      }
      const targetId = parseInt(parts[1], 10);
      if (isNaN(targetId)) return ctx.reply("معرف غير صالح.");

      await env.DB.prepare("UPDATE users SET role = 'student' WHERE telegram_id = ?").bind(targetId).run();
      await env.DB.prepare("DELETE FROM user_permissions WHERE telegram_id = ?").bind(targetId).run();
      await ctx.reply(`✅ تم تخفيض رتبة المستخدم (${targetId}) إلى Student وحذف كافة صلاحياته.`);
    });

    // ================= MESSAGE HANDLER =================

    bot.on("message", async (ctx) => {
      const user = await getUser(ctx.from!.id, ctx.from!.first_name);
      const text = ctx.message.text?.trim();

      // Priority 1: Navigation & Cancellation Guard (Prevents state corruption)
      const isNavCancel =
        text === "❌ إلغاء" ||
        text === "⬅️ رجوع" ||
        text === "🏠 الرئيسية" ||
        text === "🏠 تبديل الوضع" ||
        text === "إلغاء" ||
        text === "رجوع" ||
        (text && text.startsWith("/") && text !== "/start" && !text.startsWith("/promote") && !text.startsWith("/demote"));

      if (isNavCancel && user.bot_state !== "browsing") {
        await updateUserState(user.telegram_id, "browsing", user.current_node_id, null, null);
        user.bot_state = "browsing";
        user.managed_node_id = null;
        user.pending_target_id = null;
        await ctx.reply("تم الإلغاء والعودة إلى وضع التصفح.");
        await renderFolderView(ctx, user, user.current_node_id);
        return;
      }

      // Notification settings menu trigger
      if (text === "🔔 إعدادات الإشعارات واشتراك القسم") {
        await renderNotificationSettings(ctx, user);
        return;
      }

      // Weekly tasks menu trigger
      if (text === "📅 تاسكات وتسليمات الأسبوع الحالي") {
        await renderWeeklyTasks(ctx, user);
        return;
      }

      // Top Level Mode Selection for Admins / Leaders
      if (text?.startsWith("🎓 وضع الطالب") && isPrivileged(user)) {
        await env.DB.prepare("UPDATE users SET view_mode = 'student', current_node_id = NULL WHERE telegram_id = ?").bind(user.telegram_id).run();
        user.view_mode = "student";
        user.current_node_id = null;
        await ctx.reply("🎓 تم تفعيل **وضع الطالب**.", { parse_mode: "Markdown" });
        await renderFolderView(ctx, user, null);
        return;
      }

      if (text?.startsWith("⚙️ وضع المشرف") && isPrivileged(user)) {
        await env.DB.prepare("UPDATE users SET view_mode = 'admin', current_node_id = NULL WHERE telegram_id = ?").bind(user.telegram_id).run();
        user.view_mode = "admin";
        user.current_node_id = null;
        await ctx.reply("⚙️ تم تفعيل **وضع المشرف** (إظهار كافة أدوات الإدارة والتحكم).", { parse_mode: "Markdown" });
        await renderFolderView(ctx, user, null);
        return;
      }

      // Check if message was forwarded from a channel (for easy auto-linking)
      const forwardChat = (ctx.message as any).forward_from_chat || (ctx.message as any).forward_origin?.chat;
      if (forwardChat && (forwardChat.type === "channel" || forwardChat.type === "supergroup") && user.role === "super_admin") {
        const channelId = forwardChat.id.toString();
        await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_channel_id', ?)")
          .bind(channelId)
          .run();

        await ctx.reply(
          `🎉 **تم ربط وتفعيل قناة الأرشيف الاحتياطي بنجاح!**\n\n` +
            `📢 **اسم القناة:** ${forwardChat.title}\n` +
            `🆔 **معرف القناة:** \`${channelId}\``,
          { parse_mode: "Markdown" }
        );
        return;
      }

      // State: AWAITING LEADER ID
      if (user.bot_state === "awaiting_leader_id") {
        let targetId: number | null = null;
        let targetName: string | null = null;

        const fUser = (ctx.message as any).forward_from;
        if (fUser) {
          targetId = fUser.id;
          targetName = [fUser.first_name, fUser.last_name].filter(Boolean).join(" ");
        } else if (text && /^\d+$/.test(text)) {
          targetId = parseInt(text, 10);
        }

        if (!targetId) {
          await ctx.reply("⚠️ يرجى إرسال أرقام الـ Telegram ID فقط أو تحويل (Forward) أي رسالة من الشخص.\nأو اضغط [❌ إلغاء].");
          return;
        }

        const existing = await env.DB.prepare("SELECT * FROM users WHERE telegram_id = ?").bind(targetId).first<UserRow>();
        if (!existing) {
          await env.DB.prepare("INSERT INTO users (telegram_id, full_name, role, bot_state, view_mode, notifications_enabled) VALUES (?, ?, 'leader', 'browsing', 'admin', 1)")
            .bind(targetId, targetName || `User ${targetId}`)
            .run();
        } else {
          await env.DB.prepare("UPDATE users SET role = 'leader', full_name = COALESCE(?, full_name) WHERE telegram_id = ?")
            .bind(targetName, targetId)
            .run();
        }

        await updateUserState(user.telegram_id, "browsing", user.current_node_id, null, null);
        user.bot_state = "browsing";

        await ctx.reply(`✅ تم تعيين المستخدم (${targetId}) كليدر بنجاح.\nحدد الآن الأقسام المسموح له بإدارتها 👇`);
        await renderLeaderPermissions(ctx, targetId);
        return;
      }

      // State: AWAITING BROADCAST MESSAGE (Department Broadcast)
      if (user.bot_state === "awaiting_broadcast") {
        const targetDeptId = user.managed_node_id;
        if (!targetDeptId) {
          await updateUserState(user.telegram_id, "browsing", user.current_node_id, null, null);
          user.bot_state = "browsing";
          await ctx.reply("⚠️ حدث خطأ في تحديد القسم المستهدف.");
          await renderFolderView(ctx, user, user.current_node_id);
          return;
        }

        const deptNode: NodeRow | null = await env.DB.prepare("SELECT * FROM nodes WHERE id = ?")
          .bind(targetDeptId)
          .first<NodeRow>();

        const deptTitle = deptNode?.title || "القسم";

        await env.DB.prepare(
          `INSERT INTO broadcast_jobs (target_type, dept_node_id, dept_title, sender_id, from_chat_id, message_id, status)
           VALUES ('department', ?, ?, ?, ?, ?, 'pending')`
        )
          .bind(targetDeptId, deptTitle, user.telegram_id, ctx.chat.id, ctx.message.message_id)
          .run();

        const subCount = await env.DB.prepare(
          "SELECT COUNT(*) as count FROM users WHERE subscribed_dept_id = ? AND notifications_enabled = 1"
        )
          .bind(targetDeptId)
          .first<{ count: number }>();

        await updateUserState(user.telegram_id, "browsing", user.current_node_id, null, null);
        user.bot_state = "browsing";

        await ctx.reply(
          `✅ **تم جدولة إرسال الإشعار بنجاح!**\n\n` +
            `• القسم المستهدف: **${deptTitle}**\n` +
            `• عدد الطلاب المشتركين: **${subCount?.count || 0}** طالب\n\n` +
            `⏳ يجري الإرسال بالخلفية بأمان لتفادي قيود تيليجرام، وستصلك رسالة تأكيد فور اكتمال الإرسال للجميع.`,
          { parse_mode: "Markdown" }
        );

        executionCtx.waitUntil(processBroadcastQueue(env));
        await renderFolderView(ctx, user, user.current_node_id);
        return;
      }

      // State: AWAITING ADMIN BROADCAST (Super Admin -> All Leaders)
      if (user.bot_state === "awaiting_admin_broadcast") {
        await env.DB.prepare(
          `INSERT INTO broadcast_jobs (target_type, dept_node_id, dept_title, sender_id, from_chat_id, message_id, status)
           VALUES ('all_admins', 0, 'جميع القادة والمشرفين', ?, ?, ?, 'pending')`
        )
          .bind(user.telegram_id, ctx.chat.id, ctx.message.message_id)
          .run();

        const adminCount = await env.DB.prepare(
          "SELECT COUNT(*) as count FROM users WHERE role IN ('leader', 'super_admin')"
        ).first<{ count: number }>();

        await updateUserState(user.telegram_id, "browsing", user.current_node_id, null, null);
        user.bot_state = "browsing";

        await ctx.reply(
          `✅ **تم جدولة الإرسال لجميع القادة والمشرفين!**\n\n` +
            `• عدد المسؤولين المستهدفين: **${adminCount?.count || 0}** قائد\n\n` +
            `⏳ يجري الإرسال في الخلفية الآن...`,
          { parse_mode: "Markdown" }
        );

        executionCtx.waitUntil(processBroadcastQueue(env));
        await renderFolderView(ctx, user, user.current_node_id);
        return;
      }

      // State: AWAITING STUDENT SUBMISSION (Crowdsourced Notes)
      if (user.bot_state === "awaiting_submission") {
        const courseId = user.pending_target_id;
        if (!courseId) {
          await updateUserState(user.telegram_id, "browsing", user.current_node_id, null, null);
          user.bot_state = "browsing";
          await ctx.reply("حدث خطأ في تحديد المادة.");
          await renderFolderView(ctx, user, user.current_node_id);
          return;
        }

        let fileId: string | null = null;
        let fileName = "ملخص طالب";
        let fileType: "document" | "photo" | "video" = "document";
        const caption = ctx.message.caption || null;

        if (ctx.message.document) {
          fileId = ctx.message.document.file_id;
          fileName = ctx.message.document.file_name || "الملف.pdf";
          fileType = "document";
        } else if (ctx.message.photo) {
          const highestPhoto = ctx.message.photo[ctx.message.photo.length - 1];
          fileId = highestPhoto.file_id;
          fileName = "صورة_مساهمة.jpg";
          fileType = "photo";
        } else if (ctx.message.video) {
          fileId = ctx.message.video.file_id;
          fileName = ctx.message.video.file_name || "فيديو_مساهمة.mp4";
          fileType = "video";
        }

        if (!fileId) {
          await ctx.reply("⚠️ يرجى إرسال ملف PDF، صورة، أو فيديو للمساهمة بها، أو اضغط [❌ إلغاء].");
          return;
        }

        const courseNode = await env.DB.prepare("SELECT title FROM nodes WHERE id = ?").bind(courseId).first<{ title: string }>();
        const courseTitle = courseNode?.title || "المادة";

        const subRes = await env.DB.prepare(
          `INSERT INTO submissions (course_node_id, student_id, student_name, file_name, telegram_file_id, file_type, caption, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending') RETURNING id`
        )
          .bind(courseId, user.telegram_id, user.full_name || ctx.from?.first_name || "طالب", fileName, fileId, fileType, caption)
          .first<{ id: number }>();

        await updateUserState(user.telegram_id, "browsing", user.current_node_id, null, null);
        user.bot_state = "browsing";

        // Positive feedback to student (no embarrassment)
        await ctx.reply(
          `❤️ **شكراً لمساهمتك الجميلة يا ${user.full_name || ctx.from?.first_name || "بطل"}!**\n\n` +
            `تم استلام الملف بنجاح لمراجعته واعتماده في مادة **${courseTitle}**.`,
          { parse_mode: "Markdown" }
        );

        // Notify course leader(s)
        if (subRes?.id) {
          const subId = subRes.id;
          executionCtx.waitUntil((async () => {
            try {
              const rootDept = await getRootDepartment(courseId);
              let leaderIds: number[] = [];

              if (rootDept) {
                const { results: lRes } = await env.DB.prepare(
                  "SELECT telegram_id FROM user_permissions WHERE node_id = ?"
                ).bind(rootDept.id).all<{ telegram_id: number }>();
                leaderIds = (lRes || []).map((l) => l.telegram_id);
              }

              if (leaderIds.length === 0 && env.SUPER_ADMIN_ID) {
                leaderIds = [parseInt(env.SUPER_ADMIN_ID, 10)];
              }

              const modCardText =
                `📥 **مساهمة طلابية جديدة بانتظار المراجعة:**\n\n` +
                `• المادة: **${courseTitle}**\n` +
                `• الطالب: **${user.full_name || "طالب"}** (\`${user.telegram_id}\`)\n` +
                `• الملف: **${fileName}**\n` +
                (caption ? `• الوصف: ${caption}\n\n` : `\n`) +
                `اختر الإجراء المناسب 👇`;

              const modKb = new InlineKeyboard()
                .text("✅ قبول واختيار الفولدر", `sub_pick_folder:${subId}`)
                .row()
                .text("🗑️ تجاهل وحذف بصمت", `sub_ignore:${subId}`);

              for (const lid of leaderIds) {
                try {
                  if (fileType === "photo") {
                    await bot.api.sendPhoto(lid, fileId!, { caption: modCardText, parse_mode: "Markdown", reply_markup: modKb });
                  } else if (fileType === "video") {
                    await bot.api.sendVideo(lid, fileId!, { caption: modCardText, parse_mode: "Markdown", reply_markup: modKb });
                  } else {
                    await bot.api.sendDocument(lid, fileId!, { caption: modCardText, parse_mode: "Markdown", reply_markup: modKb });
                  }
                } catch (err) {}
              }
            } catch (e) {}
          })());
        }

        await renderFolderView(ctx, user, user.current_node_id);
        return;
      }

      // State: AWAITING SUBMISSION FOLDER NAME (Leader creating new folder for approved submission)
      if (user.bot_state === "awaiting_submission_folder") {
        const subId = user.pending_target_id;
        const courseId = user.managed_node_id;

        if (!subId || !courseId || !text) {
          await updateUserState(user.telegram_id, "browsing", user.current_node_id, null, null);
          user.bot_state = "browsing";
          await ctx.reply("حدث خطأ.");
          await renderFolderView(ctx, user, user.current_node_id);
          return;
        }

        const check = await handleFolderCreateOrRename(user, text, false, null);
        if (!check.ok) {
          await ctx.reply(check.errorMsg || "⚠️ اسم غير صالح، يرجى إرسال اسم آخر أو [❌ إلغاء].");
          return;
        }
        const cleanTitle = check.cleanTitle!;

        const sub = await env.DB.prepare("SELECT * FROM submissions WHERE id = ?").bind(subId).first<SubmissionRow>();
        if (!sub) {
          await updateUserState(user.telegram_id, "browsing", user.current_node_id, null, null);
          user.bot_state = "browsing";
          return ctx.reply("لم يتم العثور على المساهمة.");
        }

        // Create new folder
        const maxOrder = await env.DB.prepare("SELECT MAX(sort_order) as m FROM nodes WHERE parent_id = ?")
          .bind(courseId)
          .first<{ m: number | null }>();
        const nextOrder = (maxOrder?.m ?? 0) + 1;

        const newFolder = await env.DB.prepare(
          "INSERT INTO nodes (parent_id, title, created_by, is_full_width, sort_order) VALUES (?, ?, ?, 0, ?) RETURNING id"
        )
          .bind(courseId, cleanTitle, user.telegram_id, nextOrder)
          .first<{ id: number }>();

        if (newFolder?.id) {
          await env.DB.prepare(
            `INSERT INTO materials (node_id, file_name, telegram_file_id, file_type, caption, uploaded_by)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
            .bind(newFolder.id, sub.file_name, sub.telegram_file_id, sub.file_type, sub.caption, sub.student_id)
            .run();

          await env.DB.prepare("UPDATE submissions SET status = 'approved' WHERE id = ?").bind(subId).run();
        }

        await updateUserState(user.telegram_id, "browsing", user.current_node_id, null, null);
        user.bot_state = "browsing";

        await ctx.reply(`✅ تم إنشاء مجلد **${cleanTitle}** ونشر ملف الطالب بداخله بنجاح!`, { parse_mode: "Markdown" });
        await renderFolderView(ctx, user, user.current_node_id);
        return;
      }

      // State: AWAITING TASK TITLE
      if (user.bot_state === "awaiting_task_title") {
        if (!text || isReservedButton(text)) {
          return ctx.reply("⚠️ يرجى إرسال عنوان واضح للتاسك أو التكليف (مثال: 'تسليم الشيت الثالث').");
        }

        const deptId = user.managed_node_id;
        const courseId = user.pending_target_id;
        const courseNode = courseId ? await env.DB.prepare("SELECT title FROM nodes WHERE id = ?").bind(courseId).first<{ title: string }>() : null;

        await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
          .bind(
            `task_draft_${user.telegram_id}`,
            JSON.stringify({
              dept_id: deptId,
              course_title: courseNode?.title || "المقرر",
              task_title: text,
            })
          )
          .run();

        await updateUserState(user.telegram_id, "awaiting_task_days", user.current_node_id, deptId, courseId);
        user.bot_state = "awaiting_task_days";

        await ctx.reply(
          `⏰ **كم يوماً متبقياً للتسليم من الآن؟**\n\n` +
            `أرسل رقماً فقط (مثال: "3" لـ 3 أيام، أو "7" لأسبوع كامل):\n` +
            `(أو اضغط [❌ إلغاء] للتراجع)`,
          { parse_mode: "Markdown" }
        );
        return;
      }

      // State: AWAITING TASK DAYS
      if (user.bot_state === "awaiting_task_days") {
        const days = text ? parseInt(text, 10) : NaN;
        if (isNaN(days) || days <= 0 || days > 60) {
          return ctx.reply("⚠️ يرجى إرسال عدد الأيام كرقم صحيح (بين 1 و 60 يوماً).");
        }

        const draftRow = await env.DB.prepare("SELECT value FROM settings WHERE key = ?")
          .bind(`task_draft_${user.telegram_id}`)
          .first<{ value: string }>();

        if (!draftRow?.value) {
          await updateUserState(user.telegram_id, "browsing", user.current_node_id, null, null);
          user.bot_state = "browsing";
          return ctx.reply("حدث خطأ.");
        }

        const draft = JSON.parse(draftRow.value);
        const due = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        const dueDateStr = due.toISOString().replace("T", " ").substring(0, 19);

        draft.due_date = dueDateStr;
        draft.days = days;
        await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
          .bind(`task_draft_${user.telegram_id}`, JSON.stringify(draft))
          .run();

        await updateUserState(user.telegram_id, "awaiting_task_attachment", user.current_node_id, draft.dept_id, null);
        user.bot_state = "awaiting_task_attachment";

        const skipKeyboard = new Keyboard().text("تخطي بدون ملف").row().text("❌ إلغاء").resized();
        await ctx.reply(
          `📎 **ملف الشيت أو التكليف (اختياري):**\n\n` +
            `أرسل الآن ملف الـ PDF أو الصورة الخاصة بالشيت أو التكليف،\n` +
            `أو اضغط زر **[تخطي بدون ملف]** لنشر التاسك فوراً دون إرفاق ملف.`,
          { parse_mode: "Markdown", reply_markup: skipKeyboard }
        );
        return;
      }

      // State: AWAITING TASK ATTACHMENT
      if (user.bot_state === "awaiting_task_attachment") {
        const draftRow = await env.DB.prepare("SELECT value FROM settings WHERE key = ?")
          .bind(`task_draft_${user.telegram_id}`)
          .first<{ value: string }>();

        if (!draftRow?.value) {
          await updateUserState(user.telegram_id, "browsing", user.current_node_id, null, null);
          user.bot_state = "browsing";
          return ctx.reply("حدث خطأ.");
        }

        const draft = JSON.parse(draftRow.value);
        let attachmentId: string | null = null;

        if (ctx.message.document) {
          attachmentId = ctx.message.document.file_id;
        } else if (ctx.message.photo) {
          const highestPhoto = ctx.message.photo[ctx.message.photo.length - 1];
          attachmentId = highestPhoto.file_id;
        }

        const taskInsert = await env.DB.prepare(
          `INSERT INTO weekly_tasks (dept_node_id, course_title, task_title, due_date, attachment_file_id, created_by)
           VALUES (?, ?, ?, ?, ?, ?) RETURNING id`
        )
          .bind(draft.dept_id, draft.course_title, draft.task_title, draft.due_date, attachmentId, user.telegram_id)
          .first<{ id: number }>();

        await env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(`task_draft_${user.telegram_id}`).run();
        await updateUserState(user.telegram_id, "browsing", user.current_node_id, null, null);
        user.bot_state = "browsing";

        const notifyKb = new InlineKeyboard().text(
          "🔔 إرسال تنبيه لطلاب القسم بهذا التاسك",
          `notify_new_task_${taskInsert?.id}_${draft.dept_id}`
        );

        await ctx.reply(
          `✅ **تم حفظ ونشر تاسك الأسبوع بنجاح!**\n\n` +
            `• المادة: **${draft.course_title}**\n` +
            `• التكليف: **${draft.task_title}**\n` +
            `• الموعد: خلال **${draft.days}** أيام\n\n` +
            `أصبح التاسك ظاهراً الآن في قائمة [📅 تاسكات الأسبوع]. هل تريد إشعار طلاب القسم به؟`,
          { parse_mode: "Markdown", reply_markup: notifyKb }
        );

        await renderFolderView(ctx, user, user.current_node_id);
        return;
      }

      // State: UPLOADING (Batch File Upload)
      if (user.bot_state === "uploading") {
        if (text === "✅ إنهاء الحفظ" || text === "إنهاء الحفظ") {
          const folderNode = user.current_node_id
            ? await env.DB.prepare("SELECT * FROM nodes WHERE id = ?").bind(user.current_node_id).first<NodeRow>()
            : null;
          const folderTitle = folderNode?.title || "المقرر";

          const rootDept = user.current_node_id ? await getRootDepartment(user.current_node_id) : null;

          await updateUserState(user.telegram_id, "browsing", user.current_node_id, null, null);
          user.bot_state = "browsing";

          if (rootDept && user.current_node_id) {
            const inlineBtn = new InlineKeyboard().text(
              "🔔 إرسال تنبيه لطلاب القسم بالملفات الجديدة",
              `notify_new_materials_${user.current_node_id}_${rootDept.id}`
            );
            await ctx.reply(
              `✅ **تم حفظ كافة الملفات بنجاح في:**\n📂 **${folderTitle}**\n\nهل ترغب في إرسال تنبيه فوري لجميع طلاب قسم **${rootDept.title}** المشتركين بالإشعارات؟`,
              { parse_mode: "Markdown", reply_markup: inlineBtn }
            );
          } else {
            await ctx.reply("✅ تم حفظ كافة الملفات بنجاح.");
          }

          await renderFolderView(ctx, user, user.current_node_id);
          return;
        }

        let fileId: string | null = null;
        let fileName = "Unnamed File";
        let fileType: MaterialRow["file_type"] = "document";
        const caption = ctx.message.caption || null;

        if (ctx.message.document) {
          fileId = ctx.message.document.file_id;
          fileName = ctx.message.document.file_name || "Document.pdf";
          fileType = "document";
        } else if (ctx.message.video) {
          fileId = ctx.message.video.file_id;
          fileName = ctx.message.video.file_name || "Video.mp4";
          fileType = "video";
        } else if (ctx.message.photo) {
          const highestPhoto = ctx.message.photo[ctx.message.photo.length - 1];
          fileId = highestPhoto.file_id;
          fileName = "Photo.jpg";
          fileType = "photo";
        } else if (ctx.message.audio) {
          fileId = ctx.message.audio.file_id;
          fileName = ctx.message.audio.file_name || "Audio.mp3";
          fileType = "audio";
        }

        if (fileId && user.current_node_id) {
          let backupMsgId: number | null = null;
          const backupChannelId = await getBackupChannelId();
          if (backupChannelId) {
            try {
              const res = await ctx.api.copyMessage(backupChannelId, ctx.chat.id, ctx.message.message_id, {
                caption: `📄 الملف: ${fileName}`,
              });
              if (res?.message_id) backupMsgId = res.message_id;
            } catch (e) {
              try {
                const res = await ctx.forwardMessage(backupChannelId);
                if (res?.message_id) backupMsgId = res.message_id;
              } catch (err) {}
            }
          }

          await env.DB.prepare(
            "INSERT INTO materials (node_id, file_name, telegram_file_id, file_type, caption, uploaded_by, backup_message_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
          )
            .bind(user.current_node_id, fileName, fileId, fileType, caption, user.telegram_id, backupMsgId)
            .run();

          return;
        }
      }

      // State: RENAMING (Guarded against reserved names and duplicates)
      if (user.bot_state === "renaming") {
        if (text && user.managed_node_id) {
          const check = await handleFolderCreateOrRename(user, text, true, user.managed_node_id);
          if (!check.ok) {
            await ctx.reply(check.errorMsg || "⚠️ اسم غير صالح.");
            return;
          }
          const cleanTitle = check.cleanTitle!;

          const targetNode: NodeRow | null = await env.DB.prepare("SELECT * FROM nodes WHERE id = ?")
            .bind(user.managed_node_id)
            .first<NodeRow>();
          const oldTitle = targetNode?.title || "";

          await env.DB.prepare("UPDATE nodes SET title = ? WHERE id = ?")
            .bind(cleanTitle, user.managed_node_id)
            .run();

          await updateUserState(user.telegram_id, "browsing", user.current_node_id, null, null);
          user.bot_state = "browsing";
          await ctx.reply(`✅ تم تعديل الاسم بنجاح:\nمن: **${oldTitle}**\nإلى: **${cleanTitle}**`, { parse_mode: "Markdown" });
          await renderFolderView(ctx, user, user.current_node_id);
          return;
        }
      }

      // State: AWAITING FOLDER NAME (Guarded against reserved names and duplicates)
      if (user.bot_state === "awaiting_folder") {
        if (text) {
          const check = await handleFolderCreateOrRename(user, text, false, null);
          if (!check.ok) {
            await ctx.reply(check.errorMsg || "⚠️ اسم غير صالح.");
            return;
          }
          const cleanTitle = check.cleanTitle!;
          const isFull = user.current_node_id === null ? 1 : 0;

          let maxOrderRow: { max_val: number | null } | null;
          if (user.current_node_id === null) {
            maxOrderRow = await env.DB.prepare(
              "SELECT MAX(sort_order) as max_val FROM nodes WHERE parent_id IS NULL"
            ).first<{ max_val: number | null }>();
          } else {
            maxOrderRow = await env.DB.prepare(
              "SELECT MAX(sort_order) as max_val FROM nodes WHERE parent_id = ?"
            ).bind(user.current_node_id).first<{ max_val: number | null }>();
          }

          const nextSortOrder = (maxOrderRow?.max_val ?? 0) + 1;

          await env.DB.prepare(
            "INSERT INTO nodes (parent_id, title, created_by, is_full_width, sort_order) VALUES (?, ?, ?, ?, ?)"
          )
            .bind(user.current_node_id, cleanTitle, user.telegram_id, isFull, nextSortOrder)
            .run();

          await updateUserState(user.telegram_id, "browsing", user.current_node_id, null, null);
          user.bot_state = "browsing";
          await ctx.reply(`✅ تم إنشاء الخانة الجديدة: **${cleanTitle}**`, { parse_mode: "Markdown" });
          await renderFolderView(ctx, user, user.current_node_id);
          return;
        }
      }

      // Navigation: HOME / Mode Switch
      if (text === "🏠 الرئيسية" || text === "🏠 تبديل الوضع") {
        await renderTopLevel(ctx, user);
        return;
      }

      // Navigation: BACK
      if (text === "⬅️ رجوع") {
        if (user.current_node_id === null) {
          await renderTopLevel(ctx, user);
          return;
        }
        const currentNode: NodeRow | null = await env.DB.prepare("SELECT * FROM nodes WHERE id = ?")
          .bind(user.current_node_id)
          .first<NodeRow>();

        const parentId = currentNode ? currentNode.parent_id : null;
        await updateUserState(user.telegram_id, "browsing", parentId, null, null);
        user.current_node_id = parentId;
        user.bot_state = "browsing";
        if (parentId === null && isPrivileged(user)) {
          await renderTopLevel(ctx, user);
        } else {
          await renderFolderView(ctx, user, parentId);
        }
        return;
      }

      // Feature: Download All Content Recursively
      if (text === "📦 عرض وتحميل كل المحتوى" && user.current_node_id) {
        const groups = await getAllDescendantMaterialsGrouped(user.current_node_id);
        if (groups.length === 0) {
          return ctx.reply("لا توجد ملفات مرفوعة في أي من المحاضرات أو السكاشن هنا بعد.");
        }

        for (const g of groups) {
          await ctx.reply(`📂 **[ ${g.folderPath} ]**`, { parse_mode: "Markdown" });
          await sendBatchMaterials(ctx, g.materials);
        }
        return;
      }

      // Student Action: Crowdsource note contribution
      if (text === "📝 ساهم بملخص أو امتحان" && user.current_node_id) {
        const courseNode = await getCourseNode(user.current_node_id);
        if (!courseNode) {
          return ctx.reply("⚠️ يرجى الدخول لمادة دراسية أولاً للمساهمة فيها.");
        }

        await updateUserState(user.telegram_id, "awaiting_submission", user.current_node_id, null, courseNode.id);
        user.bot_state = "awaiting_submission";
        user.pending_target_id = courseNode.id;

        const cancelKeyboard = new Keyboard().text("❌ إلغاء").resized();
        await ctx.reply(
          `📝 **مساهمة طلابية — [${courseNode.title}]:**\n\n` +
            `أرسل الآن ملف الـ PDF، أو الصور، أو التلخيص لمشاركته مع زملائك.\n` +
            `(يمكنك كتابة وصف مع الملف إن أحببت)\n\n` +
            `⚠️ سيتم مراجعة الملف واعتماده من ليدر المادة قبل نشره للجميع.\n` +
            `اضغط [❌ إلغاء] للتراجع.`,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard }
        );
        return;
      }

      // Leader Action: Add Weekly Task
      if (text === "📅 إضافة تاسك للأسبوع" && (await canManage(user, user.current_node_id)) && user.current_node_id !== null) {
        const rootDept = await getRootDepartment(user.current_node_id);
        const courseNode = await getCourseNode(user.current_node_id);

        if (!rootDept) {
          return ctx.reply("⚠️ لا يمكن تحديد القسم التابع له هذا المجلد.");
        }

        const effectiveCourseId = courseNode ? courseNode.id : user.current_node_id;
        const effectiveCourseTitle = courseNode ? courseNode.title : "المقرر";

        await updateUserState(user.telegram_id, "awaiting_task_title", user.current_node_id, rootDept.id, effectiveCourseId);
        user.bot_state = "awaiting_task_title";
        user.managed_node_id = rootDept.id;
        user.pending_target_id = effectiveCourseId;

        const cancelKeyboard = new Keyboard().text("❌ إلغاء").resized();
        await ctx.reply(
          `📅 **إضافة تاسك/تكليف للأسبوع — [${effectiveCourseTitle}]:**\n\n` +
            `✍️ أرسل الآن عنوان التاسك أو التكليف المطلوب:\n` +
            `(مثال: "تسليم الشيت الثالث — مسائل الـ Syntax Analysis")\n\n` +
            `اضغط [❌ إلغاء] للتراجع.`,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard }
        );
        return;
      }

      // Admin Action: Manual Broadcast to Department
      if (text === "📢 إرسال إشعار للقسم" && (await canManage(user, user.current_node_id)) && user.current_node_id !== null) {
        const rootDept = await getRootDepartment(user.current_node_id);
        if (!rootDept) {
          return ctx.reply("⚠️ لا يمكن تحديد القسم التابع له هذا المجلد.");
        }

        await updateUserState(user.telegram_id, "awaiting_broadcast", user.current_node_id, rootDept.id, null);
        user.bot_state = "awaiting_broadcast";
        user.managed_node_id = rootDept.id;

        const cancelKeyboard = new Keyboard().text("❌ إلغاء").resized();
        await ctx.reply(
          `📢 **إرسال إشعار لطلاب قسم [${rootDept.title}]:**\n\n` +
            `✍️ أرسل الآن الرسالة أو المنشور المراد تعميمه على جميع طلاب هذا القسم المشتركين بالإشعارات.\n` +
            `(يمكنك إرسال نص عادي، أو صورة، أو فيديو، أو ملف PDF مع الشرح)\n\n` +
            `⚠️ ستصل الرسالة بنسختها الأصلية لكل الطلاب المشتركين.\n` +
            `أو اضغط زر **[❌ إلغاء]** للتراجع.`,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard }
        );
        return;
      }

      // Admin Action: Upload Files
      if (text === "📤 رفع ملفات هنا" && (await canManage(user, user.current_node_id))) {
        if (!user.current_node_id) {
          return ctx.reply("❌ لا يمكن رفع ملفات في الصفحة الرئيسية، يرجى الدخول لمادة أو خانة أولاً.");
        }
        await updateUserState(user.telegram_id, "uploading", user.current_node_id, null, null);
        user.bot_state = "uploading";
        const uploadKeyboard = new Keyboard().text("✅ إنهاء الحفظ").resized();
        await ctx.reply(
          `📤 **وضع الرفع نشط الآن:**\n\nقم بإرسال أو تحويل (Forward) كل ملفات الـ PDF أو الفيديوهات أو الصور هنا دفعة واحدة.\n\nوعند الانتهاء اضغط زر **[✅ إنهاء الحفظ]**.`,
          { parse_mode: "Markdown", reply_markup: uploadKeyboard }
        );
        return;
      }

      // Admin Action: Add Node
      if ((text === "➕ إضافة خانة/مادة" || text === "➕ إضافة قسم جديد") && (await canManage(user, user.current_node_id))) {
        await updateUserState(user.telegram_id, "awaiting_folder", user.current_node_id, null, null);
        user.bot_state = "awaiting_folder";
        const cancelKeyboard = new Keyboard().text("❌ إلغاء").resized();
        await ctx.reply("✍️ أرسل الآن اسم المادة أو الخانة الجديدة:", {
          reply_markup: cancelKeyboard,
        });
        return;
      }

      // Admin Action: Layout Customization
      if (text === "📐 تخصيص العرض والصفوف" && (await canManage(user, user.current_node_id))) {
        const children = await getChildNodes(user.current_node_id);
        if (children.length === 0) {
          return ctx.reply("لا توجد أزرار لتخصيص عرضها في هذا المجلد.");
        }

        const inlineKeyboard = buildWidthCustomizationKeyboard(children, user.current_node_id !== null);
        await ctx.reply(
          `📐 **تخصيص العرض والصفوف للأزرار:**\n\n` +
            `اضغط على أي زر لتغيير نمط عرضه محلياً بين (صف كامل 🔘 ↔️ صف مزدوج 👥).\n\n` +
            `أو اضغط خيارات التعميم لنقل التنسيق لباقي المواد.`,
          { parse_mode: "Markdown", reply_markup: inlineKeyboard }
        );
        return;
      }

      // Admin Action: Rename
      if (text === "✏️ تعديل الاسم" && (await canManage(user, user.current_node_id))) {
        const children = await getChildNodes(user.current_node_id);
        const inlineKeyboard = new InlineKeyboard();

        if (user.current_node_id !== null) {
          inlineKeyboard.text("📝 تعديل اسم هذا المجلد الحالي", `rename_${user.current_node_id}`).row();
        }

        for (const child of children) {
          inlineKeyboard.text(`📝 ${child.title}`, `rename_${child.id}`).row();
        }
        inlineKeyboard.text("❌ إلغاء", "close_rename");

        await ctx.reply("اختر ما تريد تعديل اسمه:", {
          reply_markup: inlineKeyboard,
        });
        return;
      }

      // Student / Manager Action: Re-trigger files sending
      if (text?.startsWith("📥 إرسال الملفات") && user.current_node_id) {
        const materials = await getNodeMaterials(user.current_node_id);
        if (materials.length > 0) {
          await sendBatchMaterials(ctx, materials);
        } else {
          await ctx.reply("لا توجد ملفات في هذه الخانة بعد.");
        }
        return;
      }

      // Admin Action: Delete node or material
      if (text === "🗑️ حذف خانة أو ملف" && (await canManage(user, user.current_node_id)) && user.current_node_id) {
        const children = await getChildNodes(user.current_node_id);
        const materials = await getNodeMaterials(user.current_node_id);

        if (children.length === 0 && materials.length === 0) {
          await ctx.reply("لا توجد ملفات أو خانات لحذفها في هذا المجلد.");
          return;
        }

        const inlineKeyboard = await buildDeleteKeyboard(user.current_node_id);

        await ctx.reply(
          `🗑️ **قائمة الحذف:**\n\nاضغط على أي ملف أو خانة لحذفها مباشرة (يمكنك حذف عدة عناصر متتالية).\nوعند الانتهاء اضغط زر [❌ إغلاق].`,
          {
            parse_mode: "Markdown",
            reply_markup: inlineKeyboard,
          }
        );
        return;
      }

      // Check if text matches any child node
      if (text) {
        let childNode: NodeRow | null = null;
        if (user.current_node_id === null) {
          childNode = await env.DB.prepare("SELECT * FROM nodes WHERE parent_id IS NULL AND title = ?")
            .bind(text)
            .first<NodeRow>();
        } else {
          childNode = await env.DB.prepare("SELECT * FROM nodes WHERE parent_id = ? AND title = ?")
            .bind(user.current_node_id, text)
            .first<NodeRow>();
        }

        if (childNode) {
          const subChildrenCount = await env.DB.prepare(
            "SELECT COUNT(*) as count FROM nodes WHERE parent_id = ?"
          )
            .bind(childNode.id)
            .first<{ count: number }>();

          const hasSubfolders = subChildrenCount && subChildrenCount.count > 0;

          // If in student mode (or normal student) AND this node has NO subfolders:
          // Deliver files directly without leaving the current menu!
          if (!(await canManage(user, childNode.id)) && !hasSubfolders) {
            const mats = await getNodeMaterials(childNode.id);
            if (mats.length > 0) {
              await sendBatchMaterials(ctx, mats);
            } else {
              await ctx.reply(`لا توجد ملفات في ${childNode.title} بعد.`);
            }
            return;
          }

          // Otherwise, navigate inside:
          await updateUserState(user.telegram_id, "browsing", childNode.id, null, null);
          user.current_node_id = childNode.id;
          await renderFolderView(ctx, user, childNode.id);
          return;
        }
      }

      // Default fallback
      await renderFolderView(ctx, user, user.current_node_id);
    });

    // ================= INLINE CALLBACKS =================

    bot.on("callback_query:data", async (ctx) => {
      const user = await getUser(ctx.from.id);
      const data = ctx.callbackQuery.data;

      if (
        data === "close_admin" ||
        data === "close_customization" ||
        data === "close_rename" ||
        data === "close_tasks" ||
        data === "close_sub_pick"
      ) {
        await ctx.deleteMessage();
        return;
      }

      if (data === "close_delete") {
        await ctx.deleteMessage();
        await renderFolderView(ctx, user, user.current_node_id);
        return;
      }

      if (data === "close_notifications") {
        await ctx.deleteMessage();
        return;
      }

      if (data === "open_notifications_from_tasks") {
        await ctx.deleteMessage();
        await renderNotificationSettings(ctx, user);
        return;
      }

      // Download task attachment
      if (data.startsWith("dl_task_")) {
        const taskId = parseInt(data.replace("dl_task_", ""), 10);
        const task = await env.DB.prepare("SELECT * FROM weekly_tasks WHERE id = ?").bind(taskId).first<WeeklyTaskRow>();
        if (!task || !task.attachment_file_id) {
          await ctx.answerCallbackQuery({ text: "لا يوجد ملف مرفق لهذا التاسك", show_alert: true });
          return;
        }

        await ctx.answerCallbackQuery();
        await ctx.replyWithDocument(task.attachment_file_id, {
          caption: `📄 **ملف تكليف:** ${task.task_title}\n📌 مادة: ${task.course_title}`,
        });
        return;
      }

      // Notification settings callbacks
      if (data.startsWith("sub_dept_")) {
        const deptId = parseInt(data.replace("sub_dept_", ""), 10);
        await env.DB.prepare("UPDATE users SET subscribed_dept_id = ?, notifications_enabled = 1 WHERE telegram_id = ?")
          .bind(deptId, user.telegram_id)
          .run();
        user.subscribed_dept_id = deptId;
        user.notifications_enabled = 1;
        await ctx.answerCallbackQuery({ text: "✅ تم تحديث اشتراكك في القسم وتفعيل الإشعارات!" });
        await renderNotificationSettings(ctx, user);
        return;
      }

      if (data === "mute_notifications") {
        await env.DB.prepare("UPDATE users SET notifications_enabled = 0 WHERE telegram_id = ?")
          .bind(user.telegram_id)
          .run();
        user.notifications_enabled = 0;
        await ctx.answerCallbackQuery({ text: "🔕 تم كتم الإشعارات مؤقتاً." });
        await renderNotificationSettings(ctx, user);
        return;
      }

      if (data === "unmute_notifications") {
        await env.DB.prepare("UPDATE users SET notifications_enabled = 1 WHERE telegram_id = ?")
          .bind(user.telegram_id)
          .run();
        user.notifications_enabled = 1;
        await ctx.answerCallbackQuery({ text: "🔔 تم تفعيل الإشعارات بنجاح!" });
        await renderNotificationSettings(ctx, user);
        return;
      }

      // Silent moderation: Ignore submission (No notification sent to student)
      if (data.startsWith("sub_ignore:")) {
        const subId = parseInt(data.replace("sub_ignore:", ""), 10);
        await env.DB.prepare("UPDATE submissions SET status = 'ignored' WHERE id = ?").bind(subId).run();
        await ctx.deleteMessage().catch(() => {});
        await ctx.answerCallbackQuery({ text: "🗑️ تم التجاهل والحذف بصمت." });
        return;
      }

      // Moderation: Leader picks folder for approved submission
      if (data.startsWith("sub_pick_folder:")) {
        const subId = parseInt(data.replace("sub_pick_folder:", ""), 10);
        const sub = await env.DB.prepare("SELECT * FROM submissions WHERE id = ?").bind(subId).first<SubmissionRow>();
        if (!sub) {
          await ctx.answerCallbackQuery({ text: "المساهمة غير موجودة", show_alert: true });
          return;
        }

        const { results: folders } = await env.DB.prepare(
          "SELECT id, title FROM nodes WHERE parent_id = ? ORDER BY sort_order ASC, id ASC"
        ).bind(sub.course_node_id).all<{ id: number; title: string }>();

        const kb = new InlineKeyboard();
        for (const f of folders || []) {
          kb.text(`📁 ${f.title}`, `sub_place:${subId}:${f.id}`).row();
        }
        kb.text("➕ إنشاء فولدر جديد هنا", `sub_new_folder:${subId}:${sub.course_node_id}`).row();
        kb.text("❌ إلغاء", "close_sub_pick");

        await ctx.editMessageReplyMarkup({ reply_markup: kb });
        await ctx.answerCallbackQuery();
        return;
      }

      // Moderation: Place approved submission in existing folder
      if (data.startsWith("sub_place:")) {
        const parts = data.replace("sub_place:", "").split(":");
        const subId = parseInt(parts[0], 10);
        const targetFolderId = parseInt(parts[1], 10);

        const sub = await env.DB.prepare("SELECT * FROM submissions WHERE id = ?").bind(subId).first<SubmissionRow>();
        if (!sub) {
          await ctx.answerCallbackQuery({ text: "المساهمة غير موجودة" });
          return;
        }

        const folderNode = await env.DB.prepare("SELECT title FROM nodes WHERE id = ?").bind(targetFolderId).first<{ title: string }>();

        await env.DB.prepare(
          `INSERT INTO materials (node_id, file_name, telegram_file_id, file_type, caption, uploaded_by, backup_message_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(targetFolderId, sub.file_name, sub.telegram_file_id, sub.file_type, sub.caption, sub.student_id, sub.backup_message_id)
          .run();

        await env.DB.prepare("UPDATE submissions SET status = 'approved' WHERE id = ?").bind(subId).run();

        const successText = `✅ **تم اعتماد المساهمة ونشر الملف بنجاح في مجلد [${folderNode?.title || "المقرر"}]!**`;
        try {
          await ctx.editMessageCaption({ caption: successText, parse_mode: "Markdown" });
        } catch {
          await ctx.editMessageText(successText, { parse_mode: "Markdown" });
        }
        await ctx.answerCallbackQuery({ text: "✅ تم النشر في المجلد بنجاح!" });
        return;
      }

      // Moderation: Leader wants to create a new folder for the submission
      if (data.startsWith("sub_new_folder:")) {
        const parts = data.replace("sub_new_folder:", "").split(":");
        const subId = parseInt(parts[0], 10);
        const courseId = parseInt(parts[1], 10);

        await updateUserState(user.telegram_id, "awaiting_submission_folder", user.current_node_id, courseId, subId);
        user.bot_state = "awaiting_submission_folder";
        user.managed_node_id = courseId;
        user.pending_target_id = subId;

        await ctx.deleteMessage().catch(() => {});
        const cancelKeyboard = new Keyboard().text("❌ إلغاء").resized();
        await ctx.reply(
          `📁 **إنشاء فولدر جديد للمساهمة:**\n\n` +
            `✍️ أرسل الآن اسم الفولدر الجديد الذي ترغب في إنشائه ووضع هذا الملف بداخله (مثال: "ملخصات الطلاب"):`,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard }
        );
        return;
      }

      // Batch upload broadcast prompt callback
      if (data.startsWith("notify_new_materials_")) {
        const parts = data.replace("notify_new_materials_", "").split("_");
        const folderId = parseInt(parts[0], 10);
        const deptId = parseInt(parts[1], 10);

        if (!(await canManage(user, folderId))) {
          await ctx.answerCallbackQuery({ text: "❌ لا تملك الصلاحية", show_alert: true });
          return;
        }

        const folderNode = await env.DB.prepare("SELECT * FROM nodes WHERE id = ?").bind(folderId).first<NodeRow>();
        const deptNode = await env.DB.prepare("SELECT * FROM nodes WHERE id = ?").bind(deptId).first<NodeRow>();
        const folderTitle = folderNode?.title || "المقرر";
        const deptTitle = deptNode?.title || "القسم";

        const announcementMsg = await ctx.reply(
          `📚 **تنبيه بمحتوى جديد — [${deptTitle}]**\n\n` +
            `تم رفع ملفات ومحاضرات جديدة في:\n` +
            `📂 **${folderTitle}**\n\n` +
            `اضغط زر الرئيسية أو تصفح البوت للاطلاع عليها وتحميلها! 🚀`,
          { parse_mode: "Markdown" }
        );

        const chatId = ctx.chat?.id || ctx.from.id;
        await env.DB.prepare(
          `INSERT INTO broadcast_jobs (target_type, dept_node_id, dept_title, sender_id, from_chat_id, message_id, status)
           VALUES ('department', ?, ?, ?, ?, ?, 'pending')`
        )
          .bind(deptId, deptTitle, user.telegram_id, chatId, announcementMsg.message_id)
          .run();

        const subCount = await env.DB.prepare(
          "SELECT COUNT(*) as count FROM users WHERE subscribed_dept_id = ? AND notifications_enabled = 1"
        )
          .bind(deptId)
          .first<{ count: number }>();

        await ctx.answerCallbackQuery({ text: "✅ تم جدولة إرسال التنبيه للطلاب بنجاح!" });

        try {
          await ctx.editMessageText(
            `✅ **تم جدولة التنبيه بنجاح لطلاب قسم [${deptTitle}]** (${subCount?.count || 0} طالب).\nيجري الإرسال في الخلفية...`,
            { parse_mode: "Markdown" }
          );
        } catch (e) {}

        executionCtx.waitUntil(processBroadcastQueue(env));
        return;
      }

      // New weekly task broadcast prompt callback
      if (data.startsWith("notify_new_task_")) {
        const parts = data.replace("notify_new_task_", "").split("_");
        const taskId = parseInt(parts[0], 10);
        const deptId = parseInt(parts[1], 10);

        const task = await env.DB.prepare("SELECT * FROM weekly_tasks WHERE id = ?").bind(taskId).first<WeeklyTaskRow>();
        const deptNode = await env.DB.prepare("SELECT title FROM nodes WHERE id = ?").bind(deptId).first<{ title: string }>();
        const deptTitle = deptNode?.title || "القسم";

        if (!task) {
          await ctx.answerCallbackQuery({ text: "التاسك غير موجود" });
          return;
        }

        const taskAnnounceMsg = await ctx.reply(
          `📅 **تاسك وتكليف جديد — [${deptTitle}]**\n\n` +
            `📌 مادة: **${task.course_title}**\n` +
            `📝 **${task.task_title}**\n` +
            `⏰ الموعد النهائي: **${task.due_date}**\n\n` +
            `افتح البوت واضغط زر **[📅 تاسكات الأسبوع]** للاطلاع والتحميل! 🚀`,
          { parse_mode: "Markdown" }
        );

        const chatId = ctx.chat?.id || ctx.from.id;
        await env.DB.prepare(
          `INSERT INTO broadcast_jobs (target_type, dept_node_id, dept_title, sender_id, from_chat_id, message_id, status)
           VALUES ('department', ?, ?, ?, ?, ?, 'pending')`
        )
          .bind(deptId, deptTitle, user.telegram_id, chatId, taskAnnounceMsg.message_id)
          .run();

        const subCount = await env.DB.prepare(
          "SELECT COUNT(*) as count FROM users WHERE subscribed_dept_id = ? AND notifications_enabled = 1"
        )
          .bind(deptId)
          .first<{ count: number }>();

        await ctx.answerCallbackQuery({ text: "✅ تم جدولة إرسال التنبيه لطلاب القسم!" });

        try {
          await ctx.editMessageText(
            `✅ **تم جدولة التنبيه بنجاح لطلاب قسم [${deptTitle}]** (${subCount?.count || 0} طالب).\nيجري الإرسال في الخلفية...`,
            { parse_mode: "Markdown" }
          );
        } catch (e) {}

        executionCtx.waitUntil(processBroadcastQueue(env));
        return;
      }

      // Admin panel callbacks (Super Admin only)
      if (data === "admin_back_to_panel") {
        if (user.role !== "super_admin") {
          await ctx.answerCallbackQuery({ text: "❌ مخصص للمسؤول العام فقط", show_alert: true });
          return;
        }
        await renderAdminPanel(ctx);
        return;
      }

      if (data === "admin_stats") {
        if (user.role !== "super_admin") {
          await ctx.answerCallbackQuery({ text: "❌ مخصص للمسؤول العام فقط", show_alert: true });
          return;
        }
        await renderStats(ctx, user);
        return;
      }

      if (data === "admin_notify_all_leaders") {
        if (user.role !== "super_admin") {
          await ctx.answerCallbackQuery({ text: "❌ مخصص للمسؤول العام فقط", show_alert: true });
          return;
        }
        await updateUserState(user.telegram_id, "awaiting_admin_broadcast", user.current_node_id, null, null);
        user.bot_state = "awaiting_admin_broadcast";
        await ctx.deleteMessage().catch(() => {});
        const cancelKeyboard = new Keyboard().text("❌ إلغاء").resized();
        await ctx.reply(
          `📢 **مراسلة جميع القادة والمشرفين:**\n\n` +
            `✍️ أرسل الآن الرسالة أو المنشور المراد تعميمه على كافة الليدرز والمشرفين بالكلية.\n` +
            `(يمكنك إرسال نص، صورة، أو فيديو)\n\n` +
            `اضغط زر [❌ إلغاء] للتراجع.`,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard }
        );
        return;
      }

      if (data === "admin_list_leaders") {
        if (user.role !== "super_admin") {
          await ctx.answerCallbackQuery({ text: "❌ مخصص للمسؤول العام فقط", show_alert: true });
          return;
        }
        await renderLeadersList(ctx);
        return;
      }

      if (data === "admin_add_leader") {
        if (user.role !== "super_admin") {
          await ctx.answerCallbackQuery({ text: "❌ مخصص للمسؤول العام فقط", show_alert: true });
          return;
        }
        await updateUserState(user.telegram_id, "awaiting_leader_id", user.current_node_id, null, null);
        user.bot_state = "awaiting_leader_id";
        const cancelKeyboard = new Keyboard().text("❌ إلغاء").resized();
        await ctx.reply(
          `➕ **تعيين ليدر جديد:**\n\nأرسل الآن الـ **Telegram ID** الخاص بالمستخدم (أو قم بعمل Forward لأي رسالة منه هنا مباشرة):\n\n(اضغط [❌ إلغاء] للإلغاء)`,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard }
        );
        return;
      }

      if (data.startsWith("manage_leader_")) {
        if (user.role !== "super_admin") {
          await ctx.answerCallbackQuery({ text: "❌ مخصص للمسؤول العام فقط", show_alert: true });
          return;
        }
        const leaderId = parseInt(data.replace("manage_leader_", ""), 10);
        await renderLeaderPermissions(ctx, leaderId);
        return;
      }

      if (data.startsWith("toggle_perm_")) {
        if (user.role !== "super_admin") {
          await ctx.answerCallbackQuery({ text: "❌ مخصص للمسؤول العام فقط", show_alert: true });
          return;
        }
        const parts = data.replace("toggle_perm_", "").split("_");
        const leaderId = parseInt(parts[0], 10);
        const deptId = parseInt(parts[1], 10);

        const exists = await env.DB.prepare(
          "SELECT 1 FROM user_permissions WHERE telegram_id = ? AND node_id = ?"
        ).bind(leaderId, deptId).first();

        if (exists) {
          await env.DB.prepare(
            "DELETE FROM user_permissions WHERE telegram_id = ? AND node_id = ?"
          ).bind(leaderId, deptId).run();
          await ctx.answerCallbackQuery({ text: "❌ تم سحب صلاحية القسم" });
        } else {
          await env.DB.prepare(
            "INSERT INTO user_permissions (telegram_id, node_id) VALUES (?, ?)"
          ).bind(leaderId, deptId).run();
          await ctx.answerCallbackQuery({ text: "✅ تم منح صلاحية القسم" });
        }

        await renderLeaderPermissions(ctx, leaderId);
        return;
      }

      if (data.startsWith("demote_leader_")) {
        if (user.role !== "super_admin") {
          await ctx.answerCallbackQuery({ text: "❌ مخصص للمسؤول العام فقط", show_alert: true });
          return;
        }
        const leaderId = parseInt(data.replace("demote_leader_", ""), 10);
        await env.DB.prepare("UPDATE users SET role = 'student' WHERE telegram_id = ?").bind(leaderId).run();
        await env.DB.prepare("DELETE FROM user_permissions WHERE telegram_id = ?").bind(leaderId).run();
        await ctx.answerCallbackQuery({ text: "✅ تم سحب رتبة الليدر وحذف صلاحياته" });
        await renderLeadersList(ctx);
        return;
      }

      // General canManage permission check for other modifications
      if (!(await canManage(user, user.current_node_id))) {
        await ctx.answerCallbackQuery({ text: "❌ لا تملك الصلاحية في هذا القسم", show_alert: true });
        return;
      }

      // Toggle width
      if (data.startsWith("toggle_width_")) {
        const nodeId = parseInt(data.replace("toggle_width_", ""), 10);
        if (!(await canManage(user, nodeId))) {
          await ctx.answerCallbackQuery({ text: "❌ لا تملك الصلاحية", show_alert: true });
          return;
        }
        const node: NodeRow | null = await env.DB.prepare("SELECT * FROM nodes WHERE id = ?")
          .bind(nodeId)
          .first<NodeRow>();

        if (node) {
          const newWidth = node.is_full_width === 1 ? 0 : 1;
          await env.DB.prepare("UPDATE nodes SET is_full_width = ? WHERE id = ?").bind(newWidth, nodeId).run();
          await ctx.answerCallbackQuery({
            text: newWidth === 1 ? "🔘 تم التغيير: صف كامل منفرد" : "👥 تم التغيير: صف مزدوج",
          });

          const children = await getChildNodes(user.current_node_id);
          const updatedInlineKeyboard = buildWidthCustomizationKeyboard(children, user.current_node_id !== null);
          await ctx.editMessageReplyMarkup({ reply_markup: updatedInlineKeyboard });

          await renderFolderView(ctx, user, user.current_node_id);
          return;
        }
      }

      // Propagate layout to department sibling subjects
      if (data === "apply_layout_dept") {
        if (!user.current_node_id) return;
        const currentNode: NodeRow | null = await env.DB.prepare("SELECT * FROM nodes WHERE id = ?")
          .bind(user.current_node_id)
          .first<NodeRow>();

        if (!currentNode || !currentNode.parent_id) {
          await ctx.answerCallbackQuery({ text: "لا توجد مواد شقيقة لتعميم التنسيق عليها هنا.", show_alert: true });
          return;
        }

        const templateChildren = await getChildNodes(user.current_node_id);
        const { results: siblingSubjects } = await env.DB.prepare("SELECT id FROM nodes WHERE parent_id = ? AND id != ?")
          .bind(currentNode.parent_id, currentNode.id)
          .all<{ id: number }>();

        if (siblingSubjects && siblingSubjects.length > 0) {
          for (const sub of siblingSubjects) {
            for (const tc of templateChildren) {
              await env.DB.prepare("UPDATE nodes SET is_full_width = ?, sort_order = ? WHERE parent_id = ? AND title = ?")
                .bind(tc.is_full_width, tc.sort_order, sub.id, tc.title)
                .run();
            }
          }
        }

        await ctx.answerCallbackQuery({ text: "✅ تم بنجاح تعميم هذا التنسيق على جميع مواد هذا القسم!", show_alert: true });
        return;
      }

      // Propagate layout across the entire college (Super Admin only)
      if (data === "apply_layout_all") {
        if (user.role !== "super_admin") {
          await ctx.answerCallbackQuery({ text: "⚠️ تعميم التنسيق على كل أقسام الكلية متاح للمسؤول العام فقط.", show_alert: true });
          return;
        }
        const templateChildren = await getChildNodes(user.current_node_id);
        for (const tc of templateChildren) {
          await env.DB.prepare("UPDATE nodes SET is_full_width = ?, sort_order = ? WHERE title = ?")
            .bind(tc.is_full_width, tc.sort_order, tc.title)
            .run();
        }

        await ctx.answerCallbackQuery({ text: "✅ تم بنجاح تعميم هذا التنسيق على كل مواد الكلية!", show_alert: true });
        return;
      }

      // Rename prompt
      if (data.startsWith("rename_")) {
        const nodeId = parseInt(data.replace("rename_", ""), 10);
        if (!(await canManage(user, nodeId))) {
          await ctx.answerCallbackQuery({ text: "❌ لا تملك الصلاحية", show_alert: true });
          return;
        }
        const targetNode: NodeRow | null = await env.DB.prepare("SELECT * FROM nodes WHERE id = ?")
          .bind(nodeId)
          .first<NodeRow>();

        await updateUserState(user.telegram_id, "renaming", user.current_node_id, nodeId, null);
        user.bot_state = "renaming";
        user.managed_node_id = nodeId;
        await ctx.deleteMessage();

        const cancelKeyboard = new Keyboard().text("❌ إلغاء").text("⬅️ رجوع").resized();
        await ctx.reply(
          `✏️ **تعديل اسم الخانة:**\n\n` +
            `• الاسم الحالي: **${targetNode?.title || "غير محدد"}**\n\n` +
            `✍️ أرسل الآن الاسم الجديد في رسالة:\n` +
            `(أو اضغط [❌ إلغاء] أو [⬅️ رجوع] للإلغاء دون تغيير)`,
          {
            parse_mode: "Markdown",
            reply_markup: cancelKeyboard,
          }
        );
        return;
      }

      // Delete node
      if (data.startsWith("del_node_")) {
        const nodeId = parseInt(data.replace("del_node_", ""), 10);
        if (!(await canManage(user, nodeId))) {
          await ctx.answerCallbackQuery({ text: "❌ لا تملك الصلاحية", show_alert: true });
          return;
        }

        // 1. Instant in-memory keyboard calculation (0ms latency)
        const existingKeyboard = ctx.callbackQuery.message?.reply_markup?.inline_keyboard || [];
        const updatedKeyboard = existingKeyboard
          .map((row: any[]) => row.filter((btn: any) => btn.callback_data !== data))
          .filter((row: any[]) => row.length > 0);

        const onlyCloseLeft =
          updatedKeyboard.length === 0 ||
          (updatedKeyboard.length === 1 && updatedKeyboard[0][0]?.callback_data === "close_delete");

        // 2. Immediate non-blocking UI update to Telegram
        const uiPromise = onlyCloseLeft
          ? Promise.all([
              ctx.answerCallbackQuery(),
              ctx.editMessageText("✅ تم حذف جميع العناصر في هذا المجلد.", {
                reply_markup: new InlineKeyboard().text("❌ إغلاق", "close_delete"),
              }),
            ])
          : Promise.all([
              ctx.answerCallbackQuery(),
              ctx.editMessageReplyMarkup({
                reply_markup: { inline_keyboard: updatedKeyboard },
              }),
            ]);

        // 3. Database & backup channel deletion executed concurrently in background
        const dbPromise = (async () => {
          try {
            const backupChannelId = getBackupChannelId();
            if (backupChannelId) {
              executionCtx.waitUntil(
                (async () => {
                  try {
                    const { results: subMaterials } = await env.DB.prepare(
                      `WITH RECURSIVE subnodes(id) AS (
                        SELECT id FROM nodes WHERE id = ?
                        UNION ALL
                        SELECT n.id FROM nodes n JOIN subnodes s ON n.parent_id = s.id
                      )
                      SELECT backup_message_id FROM materials WHERE node_id IN (SELECT id FROM subnodes) AND backup_message_id IS NOT NULL`
                    ).bind(nodeId).all<{ backup_message_id: number }>();

                    if (subMaterials && subMaterials.length > 0) {
                      for (const sm of subMaterials) {
                        try {
                          await ctx.api.deleteMessage(backupChannelId, sm.backup_message_id);
                        } catch (err) {}
                      }
                    }
                  } catch (e) {}
                })()
              );
            }

            await env.DB.prepare("DELETE FROM nodes WHERE id = ?").bind(nodeId).run();
          } catch (err) {
            console.error("DB error deleting node:", err);
          }
        })();

        await Promise.all([uiPromise, dbPromise]);
        return;
      }

      // Delete material
      if (data.startsWith("del_mat_")) {
        const matId = parseInt(data.replace("del_mat_", ""), 10);
        if (!(await canManage(user, user.current_node_id))) {
          await ctx.answerCallbackQuery({ text: "❌ لا تملك الصلاحية", show_alert: true });
          return;
        }

        // 1. Instant in-memory keyboard calculation (0ms latency)
        const existingKeyboard = ctx.callbackQuery.message?.reply_markup?.inline_keyboard || [];
        const updatedKeyboard = existingKeyboard
          .map((row: any[]) => row.filter((btn: any) => btn.callback_data !== data))
          .filter((row: any[]) => row.length > 0);

        const onlyCloseLeft =
          updatedKeyboard.length === 0 ||
          (updatedKeyboard.length === 1 && updatedKeyboard[0][0]?.callback_data === "close_delete");

        // 2. Immediate non-blocking UI update to Telegram
        const uiPromise = onlyCloseLeft
          ? Promise.all([
              ctx.answerCallbackQuery(),
              ctx.editMessageText("✅ تم حذف جميع العناصر في هذا المجلد.", {
                reply_markup: new InlineKeyboard().text("❌ إغلاق", "close_delete"),
              }),
            ])
          : Promise.all([
              ctx.answerCallbackQuery(),
              ctx.editMessageReplyMarkup({
                reply_markup: { inline_keyboard: updatedKeyboard },
              }),
            ]);

        // 3. Database deletion using atomic RETURNING query
        const dbPromise = (async () => {
          try {
            const deleted = await env.DB.prepare(
              "DELETE FROM materials WHERE id = ? RETURNING backup_message_id"
            )
              .bind(matId)
              .first<{ backup_message_id: number | null }>();

            const backupChannelId = getBackupChannelId();
            if (backupChannelId && deleted?.backup_message_id) {
              executionCtx.waitUntil(
                (async () => {
                  try {
                    await ctx.api.deleteMessage(backupChannelId, deleted.backup_message_id!);
                  } catch (e) {}
                })()
              );
            }
          } catch (err) {
            console.error("DB error deleting material:", err);
          }
        })();

        await Promise.all([uiPromise, dbPromise]);
        return;
      }
    });

    return webhookCallback(bot, "cloudflare-mod")(request);
  },
};
