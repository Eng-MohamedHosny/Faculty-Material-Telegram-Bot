import { Bot } from "grammy";
import { Env, MaterialRow, SubmissionRow } from "../types";
import { getBackupChannelId } from "../db";

export async function backupSubmissionToChannel(
  bot: Bot,
  env: Env,
  sub: SubmissionRow,
  targetFolderTitle: string
): Promise<number | null> {
  const backupChannelId = getBackupChannelId(env);
  if (!backupChannelId) return null;

  const backupCaption =
    `📄 **مساهمة طلابية معتمدة:** ${sub.file_name}\n` +
    `📂 **المجلد:** ${targetFolderTitle}\n` +
    `👤 **الطالب:** ${sub.student_name || "طالب"} (\`${sub.student_id}\`)\n` +
    (sub.caption ? `📝 **الوصف:** ${sub.caption}` : "");

  try {
    let res: any = null;
    if (sub.file_type === "photo") {
      res = await bot.api.sendPhoto(backupChannelId, sub.telegram_file_id, {
        caption: backupCaption,
        parse_mode: "Markdown",
      });
    } else if (sub.file_type === "video") {
      res = await bot.api.sendVideo(backupChannelId, sub.telegram_file_id, {
        caption: backupCaption,
        parse_mode: "Markdown",
      });
    } else if (sub.file_type === "audio") {
      res = await bot.api.sendAudio(backupChannelId, sub.telegram_file_id, {
        caption: backupCaption,
        parse_mode: "Markdown",
      });
    } else {
      res = await bot.api.sendDocument(backupChannelId, sub.telegram_file_id, {
        caption: backupCaption,
        parse_mode: "Markdown",
      });
    }
    return res?.message_id || null;
  } catch (err) {
    console.error("Failed to backup submission to channel:", err);
    return null;
  }
}

export async function sendBatchMaterials(ctx: any, materials: MaterialRow[], env: Env): Promise<void> {
  // 1. Send text notes first
  const textMaterials = materials.filter((m) => m.file_type === "text");
  const mediaMaterials = materials.filter((m) => m.file_type !== "text");

  const backupChannelId = getBackupChannelId(env);

  for (const tm of textMaterials) {
    let sent = false;
    if (backupChannelId && tm.backup_message_id) {
      try {
        await ctx.api.copyMessage(ctx.chat.id, backupChannelId, tm.backup_message_id);
        sent = true;
      } catch (e) {
        sent = false;
      }
    }
    if (!sent) {
      try {
        await ctx.reply(tm.caption || tm.file_name);
      } catch (err) {}
    }
  }

  // 2. Send media files in chunks
  const chunkSize = 10;
  for (let i = 0; i < mediaMaterials.length; i += chunkSize) {
    const chunk = mediaMaterials.slice(i, i + chunkSize);

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
          if (m.file_type === "photo") {
            await ctx.replyWithPhoto(m.telegram_file_id, { caption: m.caption || m.file_name });
          } else if (m.file_type === "video") {
            await ctx.replyWithVideo(m.telegram_file_id, { caption: m.caption || m.file_name });
          } else if (m.file_type === "audio") {
            await ctx.replyWithAudio(m.telegram_file_id, { caption: m.caption || m.file_name });
          } else {
            await ctx.replyWithDocument(m.telegram_file_id, { caption: m.caption || m.file_name });
          }
        } catch (err) {}
      }
    }
  }
}
