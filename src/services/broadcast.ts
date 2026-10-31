import { Bot } from "grammy";
import { Env, BroadcastJobRow } from "../types";

export async function processBroadcastQueue(env: Env): Promise<void> {
  const bot = new Bot(env.BOT_TOKEN);

  const job = await env.DB.prepare(
    "SELECT * FROM broadcast_jobs WHERE status IN ('pending', 'processing') ORDER BY id ASC LIMIT 1"
  ).first<BroadcastJobRow>();

  if (!job) return;

  if (job.status === "pending") {
    await env.DB.prepare("UPDATE broadcast_jobs SET status = 'processing' WHERE id = ?")
      .bind(job.id)
      .run();
  }

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
    await env.DB.prepare("UPDATE broadcast_jobs SET status = 'completed' WHERE id = ?")
      .bind(job.id)
      .run();

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

  await env.DB.prepare(
    `UPDATE broadcast_jobs 
     SET sent_count = sent_count + ?, failed_count = failed_count + ?, last_user_id = ? 
     WHERE id = ?`
  )
    .bind(sent, failed, maxUserId, job.id)
    .run();
}
