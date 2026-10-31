import { Keyboard, InlineKeyboard } from "grammy";
import { Env, UserRow, NodeRow, MaterialRow } from "../types";
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
  const isManager = await canManage(env, user, nodeId);
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
      rootStudentKb.text("🏠 تبديل الوضع").row();
    }
    rootStudentKb.resized();

    await ctx.reply(
      `🎓 **قسمك الحالي: [${myDept.title}]**\n\nاضغط على زر قسمك بالأسفل لتصفح المواد والتسليمات الخاصة بك 👇`,
      { parse_mode: "Markdown", reply_markup: rootStudentKb }
    );
    return;
  }

  const [children, materials, hierarchy] = await Promise.all([
    getChildNodes(env, nodeId),
    nodeId ? getNodeMaterials(env, nodeId) : Promise.resolve([]),
    nodeId
      ? getNodeHierarchy(env, nodeId)
      : Promise.resolve({ rootDept: null, semesterNode: null, courseNode: null, depth: 0, breadcrumb: "" }),
  ]);

  const { courseNode } = hierarchy;

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

  if (nodeId !== null && children.length > 0) {
    const hasDescendantMaterials = await env.DB.prepare(
      `WITH RECURSIVE subnodes(id) AS (
        SELECT id FROM nodes WHERE parent_id = ?
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

  // Only show "📥 إرسال الملفات" if this folder actually has direct materials AND children
  if (materials.length > 0 && children.length > 0) {
    keyboard.text("📥 إرسال الملفات").row();
  }

  // Student Contribution button: ONLY on the Course level (where sections like المحاضرات, السكاشن, الملخصات are listed)
  if (!isManager && courseNode !== null && nodeId === courseNode.id) {
    keyboard.text("📝 ساهم بملخص أو امتحان").row();
  }

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

  if (nodeId !== null) {
    keyboard.text("⬅️ رجوع").text("🏠 الرئيسية").row();
  } else if (privileged) {
    keyboard.text("🏠 تبديل الوضع").row();
  }

  if (children.length > 0) {
    await ctx.reply("اختر من القوائم بالأسفل 👇", {
      reply_markup: keyboard,
    });
  } else if (materials.length === 0) {
    await ctx.reply("هذا القسم فارغ حالياً.", {
      reply_markup: keyboard,
    });
  } else {
    await ctx.reply("الملفات المتاحة 👇", {
      reply_markup: keyboard,
    });
    await sendBatchMaterials(ctx, materials, env);
  }
}

export function buildWidthCustomizationKeyboard(children: NodeRow[], hasParent: boolean): InlineKeyboard {
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
      .resized();

    await ctx.reply(
      `👋 أهلاً بك يا ${user.full_name || ctx.from?.first_name || "مستخدم"}!\n\nبصفتك مسؤولاً، يرجى اختيار وضع الدخول:`,
      { reply_markup: keyboard }
    );
    return;
  }

  await renderFolderView(ctx, user, null, env);
}
