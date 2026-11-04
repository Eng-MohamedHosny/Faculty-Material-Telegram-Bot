import { Bot } from "grammy";
import { Env, MaterialRow, SubmissionRow } from "../types";
import { getBackupChannelId } from "../db";

export async function backupSubmissionToChannel(
  bot: Bot,
  env: Env,
  sub: SubmissionRow,
  targetFolderTitle: string
): Promise<number | null> {
  const backupChannelId = await getBackupChannelId(env);
  if (!backupChannelId) return null;

  try {
    // إذا كانت المساهمة عبارة عن رسالة نصية، نرسل النص الصافي (بعد تعديل المشرف إن وجد) إلى قناة الأرشيف
    // حتى يتم نسخه للطلاب كرسالة نصية نظيفة تماماً عند فتح المجلد
    if (sub.file_type === "text") {
      const cleanText = sub.caption || sub.file_name;
      const res = await bot.api.sendMessage(backupChannelId, cleanText);
      return res?.message_id || null;
    }

    const backupCaption =
      `📄 مساهمة طلابية معتمدة: ${sub.file_name}\n` +
      `📂 المجلد: ${targetFolderTitle}\n` +
      `👤 الطالب: ${sub.student_name || "طالب"} (${sub.student_id})\n` +
      (sub.caption ? `📝 الوصف: ${sub.caption}` : "");

    let res: any = null;
    if (sub.file_type === "photo") {
      res = await bot.api.sendPhoto(backupChannelId, sub.telegram_file_id, { caption: backupCaption });
    } else if (sub.file_type === "video") {
      res = await bot.api.sendVideo(backupChannelId, sub.telegram_file_id, { caption: backupCaption });
    } else if (sub.file_type === "audio") {
      res = await bot.api.sendAudio(backupChannelId, sub.telegram_file_id, { caption: backupCaption });
    } else {
      res = await bot.api.sendDocument(backupChannelId, sub.telegram_file_id, { caption: backupCaption });
    }
    return res?.message_id || null;
  } catch (err) {
    console.error("Failed to backup submission to channel:", err);
    return null;
  }
}

export async function sendBatchMaterials(ctx: any, materials: MaterialRow[], env: Env): Promise<void> {
  const backupChannelId = await getBackupChannelId(env);

  // إرسال العناصر بالترتيب الدقيق داخل الفولدر مع تجميع الملفات المتتالية المتوافقة فقط
  const sendSingleItem = async (m: MaterialRow) => {
    if (m.file_type === "text") {
      let sent = false;
      if (backupChannelId && m.backup_message_id) {
        try {
          await ctx.api.copyMessage(ctx.chat!.id, backupChannelId, m.backup_message_id);
          sent = true;
        } catch (_) {
          sent = false;
        }
      }
      if (!sent) {
        const actualText = m.caption || m.file_name;
        if (actualText && actualText !== "text_content") {
          await ctx.reply(actualText);
        }
      }
      return;
    }

    const cap = m.caption || m.file_name;
    try {
      if (m.file_type === "video") {
        await ctx.replyWithVideo(m.telegram_file_id, { caption: cap });
      } else if (m.file_type === "photo") {
        await ctx.replyWithPhoto(m.telegram_file_id, { caption: cap });
      } else if (m.file_type === "audio") {
        await ctx.replyWithAudio(m.telegram_file_id, { caption: cap });
      } else {
        await ctx.replyWithDocument(m.telegram_file_id, { caption: cap });
      }
    } catch (_) {
      try {
        await ctx.replyWithDocument(m.telegram_file_id, { caption: cap });
      } catch (_) {}
    }
  };

  // 1. إرسال الملاحظات النصية أولاً
  const textMaterials = materials.filter((m) => m.file_type === "text");
  for (const tm of textMaterials) {
    await sendSingleItem(tm);
  }

  // 2. تقسيم الملفات حسب النوع المتوافق في تليجرام (Documents، ثم Visual Media، ثم Audio)
  // لضمان نجاح replyWithMediaGroup من أول مرة وعدم تداخل ملفات الفولدرات
  const docMaterials = materials.filter((m) => m.file_type === "document" || m.file_type === "link");
  const visualMaterials = materials.filter((m) => m.file_type === "photo" || m.file_type === "video");
  const audioMaterials = materials.filter((m) => m.file_type === "audio");

  const sendCompatibleGroup = async (items: MaterialRow[]) => {
    const chunkSize = 10;
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      if (chunk.length === 1) {
        await sendSingleItem(chunk[0]);
        continue;
      }
      const mediaGroup = chunk.map((m) => ({
        type: (m.file_type === "video" || m.file_type === "photo" || m.file_type === "audio"
          ? m.file_type
          : "document") as "document" | "video" | "photo" | "audio",
        media: m.telegram_file_id,
        caption: m.caption || m.file_name,
      }));
      try {
        await ctx.replyWithMediaGroup(mediaGroup);
      } catch (_) {
        for (const m of chunk) {
          await sendSingleItem(m);
        }
      }
    }
  };

  await sendCompatibleGroup(docMaterials);
  await sendCompatibleGroup(visualMaterials);
  await sendCompatibleGroup(audioMaterials);
}
