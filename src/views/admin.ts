import { InlineKeyboard } from "grammy";
import { Env, UserRow } from "../types";
import { getBackupChannelId, getChildNodes } from "../db";

export async function renderStats(ctx: any, user: UserRow, env: Env): Promise<void> {
  if (user.role === "super_admin") {
    const summary = await env.DB.prepare(
      `SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN notifications_enabled = 1 AND subscribed_dept_id IS NOT NULL THEN 1 ELSE 0 END) as active_sub,
        SUM(CASE WHEN notifications_enabled = 0 THEN 1 ELSE 0 END) as muted_users
       FROM users`
    ).first<{ total_users: number; active_sub: number; muted_users: number }>();

    const totalUsers = summary?.total_users || 0;
    const activeSub = summary?.active_sub || 0;
    const mutedUsers = summary?.muted_users || 0;

    const { results: deptStats } = await env.DB.prepare(
      `SELECT n.id, n.title, COUNT(u.telegram_id) as sub_count
       FROM nodes n
       LEFT JOIN users u ON u.subscribed_dept_id = n.id
       WHERE n.parent_id IS NULL
       GROUP BY n.id, n.title
       ORDER BY n.sort_order ASC, n.id ASC`
    ).all<{ id: number; title: string; sub_count: number }>();

    let deptDetails = "";
    for (const d of deptStats || []) {
      const pct = totalUsers > 0 ? Math.round((d.sub_count / totalUsers) * 100) : 0;
      const matCount = (await env.DB.prepare(
        `WITH RECURSIVE subnodes(id) AS (
          SELECT id FROM nodes WHERE id = ?
          UNION ALL
          SELECT n.id FROM nodes n JOIN subnodes s ON n.parent_id = s.id
        )
        SELECT COUNT(*) as c FROM materials WHERE node_id IN (SELECT id FROM subnodes)`
      ).bind(d.id).first<{ c: number }>())?.c || 0;

      deptDetails += `• **${d.title}:**\n  👥 الطلاب المشتركون: **${d.sub_count}** (${pct}%)\n  📚 الملفات المرفوعة: **${matCount}** ملف\n\n`;
    }

    const { results: emptyCoursesRows } = await env.DB.prepare(
      `SELECT c.title, d.title as dept_title
       FROM nodes c
       JOIN nodes t ON c.parent_id = t.id
       JOIN nodes d ON t.parent_id = d.id
       WHERE d.parent_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM materials m WHERE m.node_id = c.id
           UNION ALL
           SELECT 1 FROM nodes sub JOIN materials m2 ON m2.node_id = sub.id WHERE sub.parent_id = c.id
         )`
    ).all<{ title: string; dept_title: string }>();

    const emptyCourses = (emptyCoursesRows || []).map((r) => `${r.title} (${r.dept_title})`);
    let emptySection = "";
    if (emptyCourses.length > 0) {
      const displayed = emptyCourses.slice(0, 15);
      const remaining = emptyCourses.length - displayed.length;
      emptySection =
        `⚠️ **المواد الفارغة (بدون أي ملفات حتى الآن - ${emptyCourses.length} مادة):**\n` +
        displayed.map((e) => `• ${e}`).join("\n") +
        (remaining > 0 ? `\n• ...وغيرها (${remaining} مادة أخرى)` : "");
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
      const counts = await env.DB.prepare(
        `SELECT 
          COUNT(*) as total_dept,
          SUM(CASE WHEN notifications_enabled = 1 THEN 1 ELSE 0 END) as active_sub
         FROM users WHERE subscribed_dept_id = ?`
      ).bind(p.id).first<{ total_dept: number; active_sub: number }>();

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
        `• المشتركون في الإشعارات: **${counts?.active_sub || 0}** طالب (من أصل ${counts?.total_dept || 0})\n` +
        `• تاسكات الأسبوع النشطة: **${activeTasks}** تاسك\n` +
        `• مساهمات الطلاب بانتظار المراجعة: **${pendingSubmissions}** مساهمة ${pendingSubmissions > 0 ? "⚠️" : "✅"}\n\n`;
    }

    await ctx.reply(text, { parse_mode: "Markdown" });
    return;
  }

  await ctx.reply("❌ هذا الأمر مخصص للمسؤولين والليدرز فقط.");
}

export async function renderAdminPanel(ctx: any, env: Env): Promise<void> {
  const backupChannel = getBackupChannelId(env);
  const inlineKeyboard = new InlineKeyboard()
    .text("👥 إدارة الليدرز وصلاحيات الأقسام", "admin_list_leaders")
    .row()
    .text("📢 مراسلة جميع القادة والمشرفين", "admin_notify_all_leaders")
    .row()
    .text("📊 لوحة الإحصائيات الشاملة", "admin_stats")
    .row()
    .text("🧹 تنظيف المجلدات/الملفات التجريبية", "admin_cleanup_test")
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

export async function renderLeadersList(ctx: any, env: Env): Promise<void> {
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

export async function renderLeaderPermissions(ctx: any, leaderId: number, env: Env): Promise<void> {
  const leader = await env.DB.prepare("SELECT telegram_id, full_name FROM users WHERE telegram_id = ?")
    .bind(leaderId)
    .first<{ telegram_id: number; full_name: string | null }>();

  if (!leader) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "المستخدم غير موجود", show_alert: true });
    }
    return;
  }

  const [depts, permsRes] = await Promise.all([
    getChildNodes(env, null),
    env.DB.prepare("SELECT node_id FROM user_permissions WHERE telegram_id = ?")
      .bind(leaderId)
      .all<{ node_id: number }>(),
  ]);

  const permSet = new Set((permsRes.results || []).map((p) => p.node_id));

  const inlineKeyboard = new InlineKeyboard();
  for (const dept of depts) {
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
