import { InlineKeyboard } from "grammy";
import { Env, UserRow, WeeklyTaskRow, SubmissionRow, NodeRow, KEYCAP_NUMS, formatTaskDeadlineArabic } from "../types";
import { canManageDept, getChildNodes, getNodeHierarchy } from "../db";
import { renderDepartmentOnboarding } from "./navigation";

export async function renderWeeklyTasks(ctx: any, user: UserRow, env: Env, targetDeptId?: number): Promise<void> {
  const deptId = targetDeptId || user.subscribed_dept_id;
  if (!deptId) {
    return renderDepartmentOnboarding(ctx, false, env);
  }

  const deptNode = await env.DB.prepare("SELECT title FROM nodes WHERE id = ?")
    .bind(deptId)
    .first<{ title: string }>();

  const isManager = await canManageDept(env, user, deptId);

  const { results: tasks } = await env.DB.prepare(
    `SELECT * FROM weekly_tasks 
     WHERE dept_node_id = ? AND due_date >= datetime('now') 
     ORDER BY due_date ASC`
  )
    .bind(deptId)
    .all<WeeklyTaskRow>();

  if (!tasks || tasks.length === 0) {
    const emptyKb = new InlineKeyboard();
    if (isManager) {
      emptyKb.text("⚙️ إدارة التاسكات السابقة", `manage_tasks_${deptId}`).row();
    }
    emptyKb.text("❌ إغلاق", "close_tasks");

    const emptyMsg =
      `🎉 **لا توجد تسليمات أو تاسكات نشطة حالياً!**\n\n` +
      `• القسم: **${deptNode?.title || "قسمك الأكاديمي"}**\n` +
      `استمتع بوقتك وراجع محاضراتك أولاً بأول! 🚀`;

    if (ctx.callbackQuery) {
      try {
        await ctx.editMessageText(emptyMsg, { parse_mode: "Markdown", reply_markup: emptyKb });
      } catch {
        await ctx.reply(emptyMsg, { parse_mode: "Markdown", reply_markup: emptyKb });
      }
    } else {
      await ctx.reply(emptyMsg, { parse_mode: "Markdown", reply_markup: emptyKb });
    }
    return;
  }

  const inlineKeyboard = new InlineKeyboard();
  let message = `📅 **تاسكات وتسليمات الأسبوع — [${deptNode?.title}]:**\n\n`;

  tasks.forEach((t, index) => {
    const numBadge = KEYCAP_NUMS[index] || `${index + 1}️⃣`;
    const formattedDeadline = formatTaskDeadlineArabic(t.due_date);

    message += `${numBadge} **مادة ${t.course_title}**\n`;
    message += `📝 **التكليف:** ${t.task_title}\n`;
    message += `⏰ **الموعد النهائي:** ${formattedDeadline}\n\n`;

    if (t.attachment_file_id) {
      inlineKeyboard.text(`📥 تحميل ماتيريال التاسك رقم ${numBadge}`, `dl_task_${t.id}`).row();
    }
  });

  if (isManager) {
    inlineKeyboard.text("⚙️ تعديل أو حذف تاسك", `manage_tasks_${deptId}`).row();
  }

  inlineKeyboard.text("❌ إغلاق", "close_tasks");

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(message, { parse_mode: "Markdown", reply_markup: inlineKeyboard });
    } catch {
      await ctx.reply(message, { parse_mode: "Markdown", reply_markup: inlineKeyboard });
    }
  } else {
    await ctx.reply(message, { parse_mode: "Markdown", reply_markup: inlineKeyboard });
  }
}

export async function renderTaskManagementList(ctx: any, deptId: number, user: UserRow, env: Env): Promise<void> {
  if (!(await canManageDept(env, user, deptId))) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "❌ لا تملك الصلاحية لإدارة تاسكات هذا القسم", show_alert: true }).catch(() => {});
    }
    return;
  }

  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery().catch(() => {});
  }

  const deptNode = await env.DB.prepare("SELECT title FROM nodes WHERE id = ?").bind(deptId).first<{ title: string }>();
  const { results: tasks } = await env.DB.prepare(
    "SELECT * FROM weekly_tasks WHERE dept_node_id = ? ORDER BY due_date ASC"
  ).bind(deptId).all<WeeklyTaskRow>();

  const kb = new InlineKeyboard();
  if (!tasks || tasks.length === 0) {
    kb.text("⬅️ رجوع لقائمة التاسكات", `back_to_tasks_${deptId}`).row();
    const emptyMsg = `⚙️ **إدارة التاسكات — [${deptNode?.title}]:**\n\nلا توجد تاسكات مسجلة حالياً في هذا القسم.`;
    if (ctx.callbackQuery) {
      try {
        await ctx.editMessageText(emptyMsg, { parse_mode: "Markdown", reply_markup: kb });
      } catch {
        await ctx.editMessageText(emptyMsg.replace(/[*_`\[\]]/g, ""), { reply_markup: kb });
      }
    } else {
      await ctx.reply(emptyMsg, { parse_mode: "Markdown", reply_markup: kb });
    }
    return;
  }

  let text = `⚙️ **لوحة إدارة وتعديل التاسكات — [${deptNode?.title}]:**\n\nاضغط على أي تاسك لتعديل عنوانه، موعده (Deadline)، ملفه المرفق، أو حذفه بالكامل 👇\n\n`;
  tasks.forEach((t, i) => {
    const formattedDeadline = formatTaskDeadlineArabic(t.due_date);
    text += `${i + 1}️⃣ **${t.course_title}:** ${t.task_title}\n⏰ الموعد: ${formattedDeadline}\n\n`;
    kb.text(`✏️ تعديل / 🗑️ حذف: ${t.course_title}`, `task_menu_${t.id}`).row();
  });

  kb.text("⬅️ رجوع لقائمة التاسكات", `back_to_tasks_${deptId}`).row();
  kb.text("❌ إغلاق", "close_tasks");

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
    } catch {
      await ctx.editMessageText(text.replace(/[*_`\[\]]/g, ""), { reply_markup: kb });
    }
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
  }
}

export async function renderSingleTaskEditor(ctx: any, taskId: number, user: UserRow, env: Env): Promise<void> {
  const task = await env.DB.prepare("SELECT * FROM weekly_tasks WHERE id = ?").bind(taskId).first<WeeklyTaskRow>();
  if (!task) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "التاسك غير موجود أو تم حذفه", show_alert: true }).catch(() => {});
    }
    return;
  }

  if (!(await canManageDept(env, user, task.dept_node_id))) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "❌ لا تملك الصلاحية", show_alert: true }).catch(() => {});
    }
    return;
  }

  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery().catch(() => {});
  }

  const hasFile = Boolean(task.attachment_file_id);
  const kb = new InlineKeyboard()
    .text("📝 تعديل عنوان التكليف", `edit_t_title_${taskId}`)
    .row()
    .text("⏰ تعديل موعد التسليم (الـ Deadline)", `edit_t_days_${taskId}`)
    .row()
    .text(hasFile ? "📎 تغيير ملف التكليف" : "📎 إضافة ملف للتكليف", `edit_t_file_${taskId}`)
    .row();

  if (hasFile) {
    kb.text("❌ إزالة الملف المرفق فقط", `remove_t_file_${taskId}`).row();
  }

  kb.text("🗑️ حذف هذا التاسك بالكامل", `del_t_prompt_${taskId}`).row();
  kb.text("⬅️ رجوع لقائمة الإدارة", `manage_tasks_${task.dept_node_id}`).row();

  const formattedDeadline = formatTaskDeadlineArabic(task.due_date);
  const text =
    `⚙️ **خيارات تعديل التاسك:**\n\n` +
    `• المادة: **${task.course_title}**\n` +
    `• التكليف: **${task.task_title}**\n` +
    `• الموعد النهائي: **${formattedDeadline}**\n` +
    `• الملف المرفق: ${hasFile ? "موجود ✅" : "لا يوجد ❌"}\n\n` +
    `اختر الإجراء الذي تريد تطبيقه بالأسفل 👇`;

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
    } catch {
      await ctx.editMessageText(text.replace(/[*_`\[\]]/g, ""), { reply_markup: kb });
    }
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
  }
}

export async function renderSubmissionTreeBrowser(
  ctx: any,
  subId: number,
  currentFolderId: number,
  env: Env
): Promise<void> {
  const [sub, currentNode, children, hierarchy] = await Promise.all([
    env.DB.prepare("SELECT * FROM submissions WHERE id = ?").bind(subId).first<SubmissionRow>(),
    env.DB.prepare("SELECT * FROM nodes WHERE id = ?").bind(currentFolderId).first<NodeRow>(),
    getChildNodes(env, currentFolderId),
    getNodeHierarchy(env, currentFolderId),
  ]);

  if (!sub || !currentNode) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "المساهمة أو المجلد غير موجود", show_alert: true });
    }
    return;
  }

  const courseRootId = sub.course_node_id;
  const kb = new InlineKeyboard();

  // 1. Subfolders: Clicking any subfolder DRILLS DOWN into it
  for (const child of children) {
    kb.text(`📂 فتح: ${child.title}`, `sub_browse:${subId}:${child.id}`).row();
  }

  // 2. Explicit Save Button in the CURRENT reached path:
  if (currentFolderId !== courseRootId) {
    if (children.length === 0) {
      kb.text(`✅ اعتماد وحفظ الملف هنا في [${currentNode.title}]`, `sub_place:${subId}:${currentFolderId}`).row();
    } else {
      kb.text(`📌 حفظ مباشر في [${currentNode.title}] (بدون دخول فرعي)`, `sub_place:${subId}:${currentFolderId}`).row();
    }
  }

  // 3. Create a NEW Folder/Section inside the EXACT current path reached
  kb.text(`➕ إنشاء قسم/مجلد جديد داخل [${currentNode.title}]`, `sub_new_folder:${subId}:${currentFolderId}`).row();

  // 4. Back button to navigate up one level in the inline tree
  if (currentNode.parent_id !== null && currentFolderId !== courseRootId) {
    kb.text("⬅️ رجوع للمجلد الأعلى", `sub_browse:${subId}:${currentNode.parent_id}`).row();
  }

  kb.text("🗑️ تجاهل وحذف المساهمة بصمت", `sub_ignore:${subId}`).row();
  kb.text("❌ إغلاق القائمة", "close_sub_pick");

  const statusText =
    `🧭 **تحديد مسار حفظ المساهمة الطلابية:**\n` +
    `📄 الملف: **${sub.file_name}**\n\n` +
    `📍 **المسار المفتوح حالياً:**\n` +
    `\`${hierarchy.breadcrumb || currentNode.title}\`\n\n` +
    (children.length > 0
      ? `👇 **اضغط على أي مجلد بالأسفل للدخول بداخله** (أو أنشئ قسماً جديداً في هذا المسار):`
      : `🎯 **أنت الآن داخل المجلد الفرعي النهائي [${currentNode.title}].**\nاضغط **[✅ اعتماد وحفظ الملف هنا]** لنشره فوراً، أو أنشئ مجلداً جديداً بداخله:`);

  try {
    await ctx.editMessageCaption({ caption: statusText, parse_mode: "Markdown", reply_markup: kb });
  } catch {
    try {
      await ctx.editMessageText(statusText, { parse_mode: "Markdown", reply_markup: kb });
    } catch {
      await ctx.reply(statusText, { parse_mode: "Markdown", reply_markup: kb });
    }
  }
}
