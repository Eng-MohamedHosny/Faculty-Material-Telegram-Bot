import { Bot } from "grammy";
import { Env, BroadcastJobRow } from "../types";

async function finishBroadcastJob(
  bot: Bot,
  env: Env,
  job: BroadcastJobRow,
  finalSent: number,
  finalFailed: number
) {
  await env.DB.prepare("UPDATE broadcast_jobs SET status = 'completed' WHERE id = ?")
    .bind(job.id)
    .run();

  try {
    await bot.api.sendMessage(
      job.sender_id,
      `📢 **تقرير إرسال الإشعار:**\n\n` +
        `• الوجهة: **${job.dept_title}**\n` +
        `• تم الإرسال بنجاح: **${finalSent}** ✅\n` +
        `• تعذر الإرسال (أو حظر البوت): **${finalFailed}** ⚠️\n\n` +
        `✅ اكتمل إرسال الإشعار لجميع المستهدفين بنجاح.`,
      { parse_mode: "Markdown" }
    );
  } catch (_) {}

  // Check if there is another pending or processing job
  const nextJob = await env.DB.prepare(
    "SELECT 1 FROM broadcast_jobs WHERE status IN ('pending', 'processing') LIMIT 1"
  ).first();
  if (nextJob) {
    await processBroadcastQueue(env);
  }
}

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

  // استخراج مصفوفة الرسائل التابعة لهذا الإشعار (ترسل كلها معاً وراء بعضها لكل طالب)
  let messageIds: number[] = [job.message_id];
  if (job.message_ids) {
    try {
      const parsed = JSON.parse(job.message_ids);
      if (Array.isArray(parsed) && parsed.length > 0) {
        messageIds = parsed.map((id) => Number(id)).filter(Boolean);
      }
    } catch (_) {}
  }

  // حساب حجم الدفعة بما لا يتجاوز سقف Cloudflare Subrequests (حوالي 35 طلب API في الدفعة)
  const batchLimit = Math.max(3, Math.floor(35 / messageIds.length));

  let students: { telegram_id: number }[] = [];

  if (job.target_type === "all_admins") {
    const { results } = await env.DB.prepare(
      `SELECT telegram_id FROM users 
       WHERE role IN ('leader', 'super_admin') AND telegram_id > ? 
       ORDER BY telegram_id ASC LIMIT ?`
    )
      .bind(job.last_user_id || 0, batchLimit)
      .all<{ telegram_id: number }>();
    students = results || [];
  } else {
    const { results } = await env.DB.prepare(
      `SELECT telegram_id FROM users 
       WHERE subscribed_dept_id = ? AND notifications_enabled = 1 AND telegram_id > ? 
       ORDER BY telegram_id ASC LIMIT ?`
    )
      .bind(job.dept_node_id, job.last_user_id || 0, batchLimit)
      .all<{ telegram_id: number }>();
    students = results || [];
  }

  if (students.length === 0) {
    await finishBroadcastJob(bot, env, job, job.sent_count, job.failed_count);
    return;
  }

  let sent = 0;
  let failed = 0;
  let maxUserId = job.last_user_id || 0;

  for (const student of students) {
    maxUserId = Math.max(maxUserId, student.telegram_id);
    let studentSuccess = true;

    // إرسال جميع رسائل الإشعار بالترتيب وراء بعضها في نفس اللحظة لهذا الطالب
    for (const msgId of messageIds) {
      try {
        await bot.api.copyMessage(student.telegram_id, job.from_chat_id, msgId);
      } catch (err: any) {
        studentSuccess = false;
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
          } catch (_) {}
        }
        break; // إذا حظر الطالب البوت نتوقف عن إرسال باقي رسائل الدفعة له
      }
    }

    if (studentSuccess) {
      sent++;
    } else {
      failed++;
    }
  }

  const updatedSent = (job.sent_count || 0) + sent;
  const updatedFailed = (job.failed_count || 0) + failed;

  await env.DB.prepare(
    `UPDATE broadcast_jobs 
     SET sent_count = ?, failed_count = ?, last_user_id = ? 
     WHERE id = ?`
  )
    .bind(updatedSent, updatedFailed, maxUserId, job.id)
    .run();

  // إذا كان عدد الطلاب في هذه الدفعة أقل من batchLimit، فهذا يعني أن جميع الطلاب استلموا الإشعار بالكامل الآن!
  // ننهي المهمة ونرسل التقرير النهائي الواحد فوراً بدون انتظار دقيقة الـ Cron القادمة!
  if (students.length < batchLimit) {
    await finishBroadcastJob(bot, env, job, updatedSent, updatedFailed);
  }
}
