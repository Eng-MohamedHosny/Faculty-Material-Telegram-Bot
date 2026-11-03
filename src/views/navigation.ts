import { Keyboard, InlineKeyboard } from "grammy";
import { Env, UserRow, NodeRow, MaterialRow, ADMIN_GUIDE_NODE_ID } from "../types";
import {
  canManage,
  isPrivileged,
  getChildNodes,
  getNodeMaterials,
  getNodeHierarchy,
  updateUserState,
} from "../db";
import { sendBatchMaterials } from "../services/materials";

export async function renderDepartmentOnboarding(
  ctx: any,
  isChanging = false,
  env: Env
): Promise<void> {
  const depts = await getChildNodes(env, null);
  const inlineKb = new InlineKeyboard();

  for (const d of depts) {
    inlineKb.text(`🎓 ${d.title}`, `pick_initial_dept_${d.id}`).row();
  }
  if (isChanging) {
    inlineKb.text("❌ إلغاء", "close_notifications");
  }

  const msg = isChanging
    ? `🔄 **تغيير القسم الأكاديمي:**\n\nاختر قسمك الجديد من القائمة أدناه، وسيتم تحديث واجهتك وإشعاراتك وتاسكاتك فوراً 👇`
    : `👋 **أهلاً بك في بوت كلية الحاسبات والمعلومات!**\n\n` +
      `🎯 لكي نعرض لك مقرراتك، محاضراتك، وتسليماتك الخاصة بدون تشتت مع باقي الأقسام، يرجى اختيار **قسمك الأكاديمي** أولاً 👇`;

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(msg, { parse_mode: "Markdown", reply_markup: inlineKb });
    } catch {
      await ctx.reply(msg, { parse_mode: "Markdown", reply_markup: inlineKb });
    }
  } else {
    await ctx.reply(msg, { parse_mode: "Markdown", reply_markup: inlineKb });
  }
}

export async function renderNotificationToggleCard(ctx: any, user: UserRow, env: Env): Promise<void> {
  if (!user.subscribed_dept_id) {
    return renderDepartmentOnboarding(ctx, false, env);
  }

  const deptNode = await env.DB.prepare("SELECT title FROM nodes WHERE id = ?")
    .bind(user.subscribed_dept_id)
    .first<{ title: string }>();
  const deptTitle = deptNode?.title || "قسمك";

  const isEnabled = user.notifications_enabled === 1;
  const inlineKb = new InlineKeyboard();

  if (isEnabled) {
    inlineKb.text("🔕 إيقاف إشعارات القسم مؤقتاً", "mute_notifications").row();
  } else {
    inlineKb.text("🔔 تشغيل وتفعيل إشعارات القسم", "unmute_notifications").row();
  }
  inlineKb.text("🔄 تغيير القسم الأكاديمي", "open_change_dept").row();
  inlineKb.text("❌ إغلاق", "close_notifications");

  const text =
    `🔔 **إعدادات الإشعارات — [${deptTitle}]:**\n\n` +
    `• حالة الإشعارات الحالية: **${isEnabled ? "مفعلة ✅ (تعمل)" : "متوقفة 🔕 (مكتومة)"}**\n\n` +
    `📌 عند تفعيل الإشعارات، يصلك تنبيه فوري بمجرد رفع أي محاضرة أو شيت أو تاسك جديد يخص **${deptTitle}** فقط.\n\n` +
    `تحكم في الإشعارات بضغطة زر 👇`;

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: inlineKb });
    } catch {
      await ctx.reply(text, { parse_mode: "Markdown", reply_markup: inlineKb });
    }
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: inlineKb });
  }
}

export async function renderFolderView(ctx: any, user: UserRow, nodeId: number | null, env: Env): Promise<void> {
  const [children, materials, isManager, hierarchy] = await Promise.all([
    getChildNodes(env, nodeId),
    nodeId !== null ? getNodeMaterials(env, nodeId) : Promise.resolve([]),
    canManage(env, user, nodeId),
    nodeId !== null
      ? getNodeHierarchy(env, nodeId)
      : Promise.resolve({ rootDept: null, semesterNode: null, courseNode: null, depth: 0, breadcrumb: "" }),
  ]);
  const { rootDept, courseNode } = hierarchy;
  const privileged = isPrivileged(user);

  // FOCUSED STUDENT ROOT VIEW:
  if (nodeId === null && !isManager) {
    if (!user.subscribed_dept_id) {
      await renderDepartmentOnboarding(ctx, false, env);
      return;
    }

    const myDept = await env.DB.prepare("SELECT * FROM nodes WHERE id = ?")
      .bind(user.subscribed_dept_id)
      .first<NodeRow>();

    if (!myDept) {
      await renderDepartmentOnboarding(ctx, false, env);
      return;
    }

    const notifStatus = user.notifications_enabled === 1 ? "مفعلة ✅" : "مكتومة 🔕";
    const rootStudentKb = new Keyboard()
      .text(myDept.title)
      .row()
      .text(`🔔 الإشعارات: ${notifStatus}`)
      .row()
      .text("🔄 تغيير القسم")
      .row();

    if (privileged) {
      rootStudentKb.text("🎥 شرح استخدام البوت (للمشرفين)").row();
      rootStudentKb.text("🏠 تبديل الوضع").row();
    }
    rootStudentKb.text("ℹ️ عن البوت").row();
    rootStudentKb.resized();

    await ctx.reply(
      `🎓 **قسمك الحالي: [${myDept.title}]**\n\nاضغط على زر قسمك بالأسفل لتصفح المواد والتسليمات الخاصة بك 👇`,
      { parse_mode: "Markdown", reply_markup: rootStudentKb }
    );
    return;
  }

  const keyboard = new Keyboard();
  keyboard.resized();

  // Weekly Tasks & Deadlines ONLY inside Semester view (depth === 2, where term courses are listed), as the very first button
  if (nodeId !== null && hierarchy.depth === 2) {
    keyboard.text("📅 تاسكات وتسليمات الأسبوع الحالي").row();
  }

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

  // 1. زر "📦 عرض وتحميل كل المحتوى" يظهر فقط داخل المادة الدراسية أو أقسامها الفرعية (courseNode !== null)
  // ولا يظهر أبداً في مستوى الأقسام أو مستوى الترم الأول والترم الثاني
  if (nodeId !== null && courseNode !== null && children.length > 0) {
    const hasDescendantMaterials = await env.DB.prepare(
      `WITH RECURSIVE subnodes(id) AS (
         SELECT id FROM nodes WHERE id = ?
         UNION ALL
         SELECT n.id FROM nodes n JOIN subnodes s ON n.parent_id = s.id
       )
       SELECT 1 FROM materials WHERE node_id IN (SELECT id FROM subnodes) LIMIT 1`
    )
      .bind(nodeId)
      .first();

    if (hasDescendantMaterials) {
      keyboard.text("📦 عرض وتحميل كل المحتوى").row();
    }
  }

  // تم حذف زر "📥 عرض المحتوى والملفات" نهائياً لمنع ازدواجية الأزرار

  const isInsideAdminGuide =
    nodeId === ADMIN_GUIDE_NODE_ID ||
    (courseNode !== null && courseNode.id === ADMIN_GUIDE_NODE_ID);

  // 2. زر مساهمة الطلاب (يظهر للطلاب فقط داخل المادة الدراسية، ولا يظهر مطلقاً داخل دليل المشرفين)
  if (!isManager && courseNode !== null && !isInsideAdminGuide) {
    keyboard.text("📝 ساهم بملخص أو امتحان").row();
  }

  const isAdminGuide = isInsideAdminGuide;

  if (isManager && nodeId !== null) {
    keyboard
      .text("📤 رفع المحتوى هنا")
      .text("➕ إضافة خانة/مادة")
      .row()
      .text("✏️ تعديل الاسم")
      .text("📐 تخصيص العرض والترتيب")
      .row()
      .text("🗑️ حذف خانة أو ملف");

    if (!isAdminGuide) {
      keyboard
        .text("📢 إرسال إشعار للقسم")
        .row()
        .text("📅 إضافة تاسك للأسبوع")
        .row();
    } else {
      keyboard.row();
    }
  } else if (isManager && nodeId === null) {
    keyboard
      .text("➕ إضافة قسم جديد")
      .text("📐 تخصيص العرض والترتيب")
      .row()
      .text("🎥 شرح استخدام البوت (للمشرفين)")
      .row();
  }

  if (nodeId !== null) {
    keyboard.text("⬅️ رجوع").text("🏠 الرئيسية").row();
  } else if (privileged) {
    keyboard.text("🏠 تبديل الوضع").row();
    keyboard.text("ℹ️ عن البوت").row();
  } else {
    keyboard.text("ℹ️ عن البوت").row();
  }

  if (children.length > 0) {
    if (materials.length > 0) {
      await ctx.reply("👇 الملفات والمحتويات المتاحة:", {
        reply_markup: keyboard,
      });
      await sendBatchMaterials(ctx, materials, env);
    } else {
      await ctx.reply("اختر من القوائم بالأسفل 👇", {
        reply_markup: keyboard,
      });
    }
  } else if (materials.length === 0) {
    const emptyMsg = isAdminGuide
      ? `🎥 **شرح استخدام البوت للمشرفين والليدرات:**\n\nلم يتم رفع محتوى بعد.` +
        (isManager ? "\n\nاضغط [📤 رفع المحتوى هنا] لرفع فيديو أو شرح نصي." : "")
      : "هذا القسم فارغ حالياً.";
    await ctx.reply(emptyMsg, {
      reply_markup: keyboard,
    });
  } else {
    // إرسال رسالة العنوان والكيبورد أولاً قبل المحتوى
    await ctx.reply("👇 الملفات والمحتويات المتاحة:", {
      reply_markup: keyboard,
    });
    await sendBatchMaterials(ctx, materials, env);
  }
}

export function buildWidthCustomizationKeyboard(
  children: NodeRow[],
  hasParent: boolean,
  selectedNodeId?: number | null
): InlineKeyboard {
  const inlineKeyboard = new InlineKeyboard();
  if (children.length === 0) {
    inlineKeyboard.text("❌ إغلاق", "close_customization");
    return inlineKeyboard;
  }

  // إذا لم يتم تحديد خانة بعد، نحدد الخانة الأولى افتراضياً
  const activeId =
    selectedNodeId && children.some((c) => c.id === selectedNodeId)
      ? selectedNodeId
      : children[0].id;
  const activeIdx = children.findIndex((c) => c.id === activeId);
  const activeChild = children[activeIdx];

  // 1. عرض كل خانة في سطر كامل مستقل (100% عرض) حتى يظهر الاسم كاملاً بدون أي قص
  children.forEach((child, idx) => {
    const isSelected = child.id === activeId;
    const pointer = isSelected ? "🎯 " : "";
    const modeBadge = child.is_full_width === 1 ? "[🔘 كامل]" : "[👥 مزدوج]";
    inlineKeyboard
      .text(`${pointer}${idx + 1}. ${child.title} ${modeBadge}`, `select_custom_node_${child.id}`)
      .row();
  });

  // 2. شريط التحكم بالخانة المحددة حالياً (رفع / تنزيل / تبديل العرض)
  if (activeChild) {
    if (activeIdx > 0) {
      inlineKeyboard.text("⬆️ رفع المحدد لأعلى", `move_node_up_${activeChild.id}`);
    }
    if (activeIdx < children.length - 1) {
      inlineKeyboard.text("⬇️ تنزيل المحدد لأسفل", `move_node_down_${activeChild.id}`);
    }
    if (activeIdx > 0 || activeIdx < children.length - 1) {
      inlineKeyboard.row();
    }

    const nextModeText =
      activeChild.is_full_width === 1
        ? "🔄 تحويل المحدد إلى (👥 صف مزدوج)"
        : "🔄 تحويل المحدد إلى (🔘 صف كامل)";
    inlineKeyboard.text(nextModeText, `toggle_width_${activeChild.id}`).row();
  }

  // 3. أزرار التعميم السريعة
  inlineKeyboard
    .text("🔘 جعل الكل (صف كامل)", "set_all_full")
    .text("👥 جعل الكل (صف مزدوج)", "set_all_half")
    .row();

  if (hasParent) {
    inlineKeyboard.text("⚡ تطبيق هذا التنسيق على باقي مواد هذا القسم", "apply_layout_dept").row();
    inlineKeyboard.text("🌍 تطبيق هذا التنسيق على كل مواد الكلية", "apply_layout_all").row();
  }

  inlineKeyboard.text("✅ حفظ وإغلاق", "close_customization");
  return inlineKeyboard;
}

export async function buildDeleteKeyboard(env: Env, nodeId: number): Promise<InlineKeyboard> {
  const [children, materials] = await Promise.all([
    getChildNodes(env, nodeId),
    getNodeMaterials(env, nodeId),
  ]);

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

export async function renderTopLevel(ctx: any, user: UserRow, env: Env): Promise<void> {
  await updateUserState(env, user.telegram_id, "browsing", null, null, null);
  user.current_node_id = null;
  user.bot_state = "browsing";

  if (isPrivileged(user)) {
    const keyboard = new Keyboard()
      .text("🎓 وضع الطالب (تصفح المقررات)")
      .row()
      .text("⚙️ وضع المشرف (الإدارة والتحكم)")
      .row()
      .text("🎥 شرح استخدام البوت (للمشرفين)")
      .row()
      .text("ℹ️ عن البوت")
      .resized();

    await ctx.reply(
      `👋 أهلاً بك يا ${user.full_name || ctx.from?.first_name || "مستخدم"}!\n\nبصفتك مسؤولاً، يرجى اختيار وضع الدخول:`,
      { reply_markup: keyboard }
    );
    return;
  }

  await renderFolderView(ctx, user, null, env);
}
