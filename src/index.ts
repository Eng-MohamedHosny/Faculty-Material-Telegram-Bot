import { Bot, webhookCallback, Keyboard, InlineKeyboard } from "grammy";
import {
  Env,
  UserRow,
  NodeRow,
  MaterialRow,
  WeeklyTaskRow,
  SubmissionRow,
  isReservedButton,
  computeEndOfDayDueDate,
  formatTaskDeadlineArabic,
} from "./types";
import {
  getBackupChannelId,
  getUser,
  updateUserState,
  canManage,
  canManageDept,
  isPrivileged,
  getNodeHierarchy,
  handleFolderCreateOrRename,
  getChildNodes,
  getNodeMaterials,
  getAllDescendantMaterialsGrouped,
} from "./db";
import { processBroadcastQueue } from "./services/broadcast";
import { backupSubmissionToChannel, sendBatchMaterials } from "./services/materials";
import {
  renderDepartmentOnboarding,
  renderNotificationToggleCard,
  renderFolderView,
  buildWidthCustomizationKeyboard,
  buildDeleteKeyboard,
  renderTopLevel,
} from "./views/navigation";
import {
  renderWeeklyTasks,
  renderTaskManagementList,
  renderSingleTaskEditor,
  renderSubmissionTreeBrowser,
} from "./views/tasksAndSubs";
import {
  renderAdminPanel,
  renderLeadersList,
  renderLeaderPermissions,
  renderStats,
} from "./views/admin";

export { Env } from "./types";

export default {
  async scheduled(event: ScheduledEvent, env: Env, executionCtx: ExecutionContext): Promise<void> {
    executionCtx.waitUntil(processBroadcastQueue(env));
  },

  async fetch(request: Request, env: Env, executionCtx: ExecutionContext): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("FCAI Telegram Bot Worker v3.1 is running smoothly 🚀", { status: 200 });
    }

    const bot = new Bot(env.BOT_TOKEN);

    bot.catch((err) => {
      console.error("Unhandled bot error:", err);
    });

    bot.on("channel_post", async (ctx) => {
      const channelId = ctx.chat.id.toString();
      await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_channel_id', ?)")
        .bind(channelId)
        .run();
    });

    // ================= COMMANDS =================

    bot.command("start", async (ctx) => {
      const user = await getUser(env, ctx.from!.id, ctx.from!.first_name);
      await updateUserState(env, user.telegram_id, "browsing", null, null, null);
      user.bot_state = "browsing";
      user.current_node_id = null;
      user.managed_node_id = null;
      user.pending_target_id = null;
      await renderTopLevel(ctx, user, env);
    });

    bot.command("cleanup_test", async (ctx) => {
      const user = await getUser(env, ctx.from!.id, ctx.from!.first_name);
      if (!isPrivileged(user)) {
        return ctx.reply("❌ هذا الأمر للمسؤولين فقط.");
      }

      const delFolderRes = await env.DB.prepare("DELETE FROM nodes WHERE title = 'مممم'").run();
      const delMatRes = await env.DB.prepare(
        `DELETE FROM materials 
         WHERE file_name = 'sql_server_indexes_practice_exam.pdf'
            OR node_id IN (SELECT DISTINCT parent_id FROM nodes WHERE parent_id IS NOT NULL)`
      ).run();

      await ctx.reply(
        `🧹 **تم تنظيف المجلدات والملفات التجريبية الخاطئة بنجاح!**\n\n` +
          `• تم حذف مجلدات تجريبية (مممم): **${delFolderRes.meta?.changes || 0}**\n` +
          `• تم حذف ملفات موضوعة بالخطأ في مجلدات رئيسية: **${delMatRes.meta?.changes || 0}**\n\n` +
          `✅ اختفى الآن زر [📥 إرسال الملفات] الزائد من مجلد المحاضرات وعادت القوائم نظيفة تماماً!`,
        { parse_mode: "Markdown" }
      );
      await renderFolderView(ctx, user, user.current_node_id, env);
    });

    bot.command(["notifications", "notify"], async (ctx) => {
      const user = await getUser(env, ctx.from!.id, ctx.from!.first_name);
      await renderNotificationToggleCard(ctx, user, env);
    });

    bot.command(["tasks", "deadlines", "task"], async (ctx) => {
      const user = await getUser(env, ctx.from!.id, ctx.from!.first_name);
      await renderWeeklyTasks(ctx, user, env);
    });

    bot.command(["stats", "status", "stat"], async (ctx) => {
      const user = await getUser(env, ctx.from!.id, ctx.from!.first_name);
      await renderStats(ctx, user, env);
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

    bot.command("admin", async (ctx) => {
      const user = await getUser(env, ctx.from!.id);
      if (user.role !== "super_admin") {
        return ctx.reply("❌ هذا الأمر مخصص للمسؤول العام (Super Admin) فقط.");
      }
      await renderAdminPanel(ctx, env);
    });

    bot.command("leaders", async (ctx) => {
      const user = await getUser(env, ctx.from!.id);
      if (user.role !== "super_admin") {
        return ctx.reply("❌ هذا الأمر مخصص للمسؤول العام (Super Admin) فقط.");
      }
      await renderLeadersList(ctx, env);
    });

    bot.command("notify_admins", async (ctx) => {
      const user = await getUser(env, ctx.from!.id);
      if (user.role !== "super_admin") {
        return ctx.reply("❌ هذا الأمر مخصص للمسؤول العام فقط.");
      }
      await updateUserState(env, user.telegram_id, "awaiting_admin_broadcast");
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
      const admin = await getUser(env, ctx.from!.id);
      if (admin.role !== "super_admin") return;

      const parts = ctx.message!.text.split(" ");
      if (parts.length < 2) {
        return ctx.reply("يرجى كتابة: /promote <telegram_id>");
      }
      const targetId = parseInt(parts[1], 10);
      if (isNaN(targetId)) return ctx.reply("معرف غير صالح.");

      const existing = await env.DB.prepare("SELECT * FROM users WHERE telegram_id = ?").bind(targetId).first<UserRow>();
      if (!existing) {
        await env.DB.prepare(
          "INSERT INTO users (telegram_id, full_name, role, bot_state, view_mode, notifications_enabled) VALUES (?, ?, 'leader', 'browsing', 'admin', 1)"
        )
          .bind(targetId, `User ${targetId}`)
          .run();
      } else {
        await env.DB.prepare("UPDATE users SET role = 'leader' WHERE telegram_id = ?").bind(targetId).run();
      }

      await ctx.reply(`✅ تم ترقية المستخدم (${targetId}) إلى رتبة Leader بنجاح.`);
      await renderLeaderPermissions(ctx, targetId, env);
    });

    bot.command("demote", async (ctx) => {
      const admin = await getUser(env, ctx.from!.id);
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
      const user = await getUser(env, ctx.from!.id, ctx.from!.first_name);
      const text = ctx.message.text?.trim();

      // Priority 1: Navigation & Cancellation Guard
      let isNavCancel = false;
      if (user.bot_state === "uploading") {
        isNavCancel =
          text === "❌ إلغاء" ||
          text === "إلغاء" ||
          (!!text && text.startsWith("/") && !text.startsWith("/promote") && !text.startsWith("/demote"));
      } else {
        isNavCancel =
          !!text &&
          (text.includes("إلغاء") ||
            text.includes("رجوع") ||
            text.includes("الرئيسية") ||
            text.includes("تبديل الوضع") ||
            (text.startsWith("/") && !text.startsWith("/promote") && !text.startsWith("/demote")));
      }

      if (isNavCancel && user.bot_state !== "browsing") {
        await updateUserState(env, user.telegram_id, "browsing", user.current_node_id, null, null);
        user.bot_state = "browsing";
        user.managed_node_id = null;
        user.pending_target_id = null;
        if (!text || !text.startsWith("/")) {
          await ctx.reply("تم الإلغاء والعودة إلى وضع التصفح.");
          await renderFolderView(ctx, user, user.current_node_id, env);
          return;
        }
      }

      if (text === "🔄 تغيير القسم") {
        await renderDepartmentOnboarding(ctx, true, env);
        return;
      }

      if (text?.startsWith("🔔 الإشعارات:") || text === "🔔 إعدادات الإشعارات واشتراك القسم") {
        await renderNotificationToggleCard(ctx, user, env);
        return;
      }

      if (text === "📅 تاسكات وتسليمات الأسبوع الحالي") {
        await renderWeeklyTasks(ctx, user, env);
        return;
      }

      if (text?.startsWith("🎓 وضع الطالب") && isPrivileged(user)) {
        await env.DB.prepare("UPDATE users SET view_mode = 'student', current_node_id = NULL WHERE telegram_id = ?")
          .bind(user.telegram_id)
          .run();
        user.view_mode = "student";
        user.current_node_id = null;
        await ctx.reply("✅ تم التبديل إلى وضع الطالب (العرض المركز لقسمك).");
        await renderFolderView(ctx, user, null, env);
        return;
      }

      if (text?.startsWith("⚙️ وضع المشرف") && isPrivileged(user)) {
        await env.DB.prepare("UPDATE users SET view_mode = 'admin', current_node_id = NULL WHERE telegram_id = ?")
          .bind(user.telegram_id)
          .run();
        user.view_mode = "admin";
        user.current_node_id = null;
        await ctx.reply("✅ تم التبديل إلى وضع المشرف.");
        await renderFolderView(ctx, user, null, env);
        return;
      }

      if (text === "🏠 تبديل الوضع" && isPrivileged(user)) {
        const newMode = user.view_mode === "admin" ? "student" : "admin";
        await env.DB.prepare("UPDATE users SET view_mode = ?, current_node_id = NULL WHERE telegram_id = ?")
          .bind(newMode, user.telegram_id)
          .run();
        user.view_mode = newMode;
        user.current_node_id = null;
        await ctx.reply(`✅ تم التبديل إلى وضع: ${newMode === "admin" ? "⚙️ المشرف" : "🎓 الطالب"}`);
        await renderFolderView(ctx, user, null, env);
        return;
      }

      // State: AWAITING BROADCAST (Leader to Department)
      if (user.bot_state === "awaiting_broadcast") {
        const deptId = user.managed_node_id;
        if (!deptId || !(await canManage(env, user, deptId))) {
          await updateUserState(env, user.telegram_id, "browsing", user.current_node_id, null, null);
          user.bot_state = "browsing";
          return ctx.reply("❌ تم إلغاء الإشعار: صلاحية غير متوفرة أو معرف القسم غير محدد.");
        }

        const deptNode = await env.DB.prepare("SELECT title FROM nodes WHERE id = ?").bind(deptId).first<NodeRow>();
        const deptTitle = deptNode?.title || "القسم";

        const chatId = ctx.chat?.id || ctx.from?.id;
        const messageId = ctx.message?.message_id;

        if (!chatId || !messageId) {
          return ctx.reply("⚠️ لم يتم استلام الرسالة بشكل صحيح.");
        }

        await env.DB.prepare(
          `INSERT INTO broadcast_jobs (target_type, dept_node_id, dept_title, sender_id, from_chat_id, message_id, status)
           VALUES ('department', ?, ?, ?, ?, ?, 'pending')`
        )
          .bind(deptId, deptTitle, user.telegram_id, chatId, messageId)
          .run();

        const subCount = await env.DB.prepare(
          "SELECT COUNT(*) as count FROM users WHERE subscribed_dept_id = ? AND notifications_enabled = 1"
        )
          .bind(deptId)
          .first<{ count: number }>();

        await updateUserState(env, user.telegram_id, "browsing", user.current_node_id, null, null);
        user.bot_state = "browsing";

        await ctx.reply(
          `✅ **تم جدولة الإشعار لطلاب قسم [${deptTitle}] بنجاح!**\n\n` +
            `• عدد الطلاب المشتركين: **${subCount?.count || 0}** طالب\n` +
            `• يجري الإرسال في الخلفية تدريجياً لضمان عدم توقف البوت...\n` +
            `• ستصلك رسالة تأكيد فور اكتمال الإرسال للجميع! 🚀`,
          { parse_mode: "Markdown" }
        );

        executionCtx.waitUntil(processBroadcastQueue(env));
        await renderFolderView(ctx, user, user.current_node_id, env);
        return;
      }

      // State: AWAITING ADMIN BROADCAST (Super Admin to All Leaders)
      if (user.bot_state === "awaiting_admin_broadcast") {
        if (user.role !== "super_admin") {
          await updateUserState(env, user.telegram_id, "browsing", user.current_node_id, null, null);
          user.bot_state = "browsing";
          return ctx.reply("❌ غير مصرح لك بإرسال هذا الإشعار.");
        }

        const chatId = ctx.chat?.id || ctx.from?.id;
        const messageId = ctx.message?.message_id;

        if (!chatId || !messageId) {
          return ctx.reply("⚠️ لم يتم استلام الرسالة.");
        }

        await env.DB.prepare(
          `INSERT INTO broadcast_jobs (target_type, dept_node_id, dept_title, sender_id, from_chat_id, message_id, status)
           VALUES ('all_admins', NULL, 'كافة القادة والمشرفين', ?, ?, ?, 'pending')`
        )
          .bind(user.telegram_id, chatId, messageId)
          .run();

        const leaderCount = await env.DB.prepare(
          "SELECT COUNT(*) as count FROM users WHERE role IN ('leader', 'super_admin')"
        ).first<{ count: number }>();

        await updateUserState(env, user.telegram_id, "browsing", user.current_node_id, null, null);
        user.bot_state = "browsing";

        await ctx.reply(
          `✅ **تمت جدولة التعميم لكافة القادة والمشرفين!**\n\n` +
            `• عدد القادة والمشرفين: **${leaderCount?.count || 0}**\n` +
            `• يجري الإرسال في الخلفية...\n` +
            `• ستصلك رسالة تأكيد فور الانتهاء.`,
          { parse_mode: "Markdown" }
        );

        executionCtx.waitUntil(processBroadcastQueue(env));
        await renderFolderView(ctx, user, user.current_node_id, env);
        return;
      }

      // State: AWAITING SUBMISSION (Student Crowdsourcing)
      if (user.bot_state === "awaiting_submission") {
        const courseId = user.pending_target_id;
        if (!courseId) {
          await updateUserState(env, user.telegram_id, "browsing", user.current_node_id, null, null);
          user.bot_state = "browsing";
          return ctx.reply("حدث خطأ.");
        }

        let fileId: string | null = null;
        let fileName = "Unnamed File";
        let fileType: SubmissionRow["file_type"] = "document";
        const caption = ctx.message.caption || ctx.message.text || null;

        if (ctx.message.document) {
          fileId = ctx.message.document.file_id;
          fileName = ctx.message.document.file_name || "Document.pdf";
          fileType = "document";
        } else if (ctx.message.photo) {
          const highestPhoto = ctx.message.photo[ctx.message.photo.length - 1];
          fileId = highestPhoto.file_id;
          fileName = "Photo.jpg";
          fileType = "photo";
        } else if (ctx.message.video) {
          fileId = ctx.message.video.file_id;
          fileName = ctx.message.video.file_name || "Video.mp4";
          fileType = "video";
        } else if (ctx.message.audio) {
          fileId = ctx.message.audio.file_id;
          fileName = ctx.message.audio.file_name || "Audio.mp3";
          fileType = "audio";
        }

        if (!fileId) {
          return ctx.reply("⚠️ يرجى إرسال ملف PDF، صورة، أو فيديو صالح، أو اضغط زر [❌ إلغاء].");
        }

        const courseNode = await env.DB.prepare("SELECT title FROM nodes WHERE id = ?")
          .bind(courseId)
          .first<{ title: string }>();

        const subRes = await env.DB.prepare(
          `INSERT INTO submissions (course_node_id, student_id, student_name, file_name, telegram_file_id, file_type, caption, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending') RETURNING id`
        )
          .bind(courseId, user.telegram_id, user.full_name || "طالب", fileName, fileId, fileType, caption)
          .first<{ id: number }>();

        const subId = subRes?.id;

        await updateUserState(env, user.telegram_id, "browsing", user.current_node_id, null, null);
        user.bot_state = "browsing";
        user.pending_target_id = null;

        await ctx.reply(
          `❤️ **شكراً لمساهمتك الجميلة يا ${user.full_name || "بطل"}!**\n\n` +
            `تم استلام الملف بنجاح لمراجعته واعتماده في مادة **${courseNode?.title || "المقرر"}**.\n` +
            `سيظهر لجميع زملائك فور اعتماده من ليدر المادة! 🚀`,
          { parse_mode: "Markdown" }
        );

        // Notify leaders of this course
        if (subId) {
          const { rootDept } = await getNodeHierarchy(env, courseId);
          if (rootDept) {
            const { results: leaders } = await env.DB.prepare(
              `SELECT u.telegram_id FROM users u
               JOIN user_permissions p ON u.telegram_id = p.telegram_id
               WHERE p.node_id = ?`
            )
              .bind(rootDept.id)
              .all<{ telegram_id: number }>();

            const leaderIds = new Set((leaders || []).map((l) => l.telegram_id));
            if (env.SUPER_ADMIN_ID) leaderIds.add(parseInt(env.SUPER_ADMIN_ID, 10));

            const actionKb = new InlineKeyboard().text("🧭 اختيار مجلد النشر وتحديد مساره", `sub_pick_folder:${subId}`).row();

            const promptMsg =
              `📩 **مساهمة طلابية جديدة بانتظار المراجعة:**\n\n` +
              `• المادة: **${courseNode?.title}**\n` +
              `• الطالب: **${user.full_name || "طالب"}** (\`${user.telegram_id}\`)\n` +
              `• الملف: \`${fileName}\`\n` +
              (caption ? `• الوصف: ${caption}\n\n` : "\n") +
              `اختر الإجراء المناسب 👇`;

            for (const lId of leaderIds) {
              try {
                if (fileType === "photo") {
                  await bot.api.sendPhoto(lId, fileId, { caption: promptMsg, parse_mode: "Markdown", reply_markup: actionKb });
                } else if (fileType === "video") {
                  await bot.api.sendVideo(lId, fileId, { caption: promptMsg, parse_mode: "Markdown", reply_markup: actionKb });
                } else if (fileType === "audio") {
                  await bot.api.sendAudio(lId, fileId, { caption: promptMsg, parse_mode: "Markdown", reply_markup: actionKb });
                } else {
                  await bot.api.sendDocument(lId, fileId, { caption: promptMsg, parse_mode: "Markdown", reply_markup: actionKb });
                }
              } catch (e) {}
            }
          }
        }

        await renderFolderView(ctx, user, user.current_node_id, env);
        return;
      }

      // State: AWAITING SUBMISSION FOLDER
      if (user.bot_state === "awaiting_submission_folder") {
        const subId = user.pending_target_id;
        const targetParentId = user.managed_node_id;

        if (!subId || !targetParentId || !text || isReservedButton(text)) {
          return ctx.reply("⚠️ يرجى إرسال اسم واضح وصالح للمجلد الجديد، أو اضغط [❌ إلغاء].");
        }

        const check = await handleFolderCreateOrRename(env, user, text, false, null, targetParentId);
        if (!check.ok) {
          await ctx.reply(check.errorMsg || "⚠️ اسم غير صالح.");
          return;
        }

        const sub = await env.DB.prepare("SELECT * FROM submissions WHERE id = ?").bind(subId).first<SubmissionRow>();
        if (!sub) {
          await updateUserState(env, user.telegram_id, "browsing", user.current_node_id, null, null);
          user.bot_state = "browsing";
          return ctx.reply("المساهمة لم تعد موجودة.");
        }

        const newFolder = await env.DB.prepare(
          "INSERT INTO nodes (parent_id, title, sort_order, created_by, is_full_width) VALUES (?, ?, 10, ?, 1) RETURNING id"
        )
          .bind(targetParentId, check.cleanTitle, user.telegram_id)
          .first<{ id: number }>();

        let insertedMatId = 0;
        if (newFolder?.id) {
          const backupMsgId = await backupSubmissionToChannel(bot, env, sub, check.cleanTitle!);

          const matInsert = await env.DB.prepare(
            `INSERT INTO materials (node_id, file_name, telegram_file_id, file_type, caption, uploaded_by, backup_message_id)
             VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
          )
            .bind(newFolder.id, sub.file_name, sub.telegram_file_id, sub.file_type, sub.caption, sub.student_id, backupMsgId)
            .first<{ id: number }>();
          insertedMatId = matInsert?.id || 0;

          await env.DB.prepare("UPDATE submissions SET status = 'approved' WHERE id = ?").bind(subId).run();
        }

        await updateUserState(env, user.telegram_id, "browsing", targetParentId, null, null);
        user.bot_state = "browsing";
        user.managed_node_id = null;
        user.pending_target_id = null;

        const undoKb = new InlineKeyboard()
          .text("↩️ تراجع وسحب الملف", `sub_undo:${subId}:${insertedMatId}:${newFolder?.id || 0}`)
          .row()
          .text("🗑️ حذف هذا الملف والمجلد", `sub_delete_published:${subId}:${insertedMatId}:${newFolder?.id || 0}`);

        await ctx.reply(
          `✅ **تم إنشاء مجلد [${check.cleanTitle}] ونشر ملف الطالب بداخله بنجاح!**\n\n_(إذا أردت التراجع عن هذه الخطوة، اضغط الزر بالأسفل)_`,
          { parse_mode: "Markdown", reply_markup: undoKb }
        );

        try {
          await bot.api.sendMessage(
            sub.student_id,
            `🎉 **بشرى سارة يا بطل!**\n\nتم اعتماد ونشر مساهمتك (\`${sub.file_name}\`) بمجلد جديد **${check.cleanTitle}**.\n\nشكراً لمساعدة زملائك ودعمك للدفعة! ❤️`
          );
        } catch (e) {}

        await renderFolderView(ctx, user, targetParentId, env);
        return;
      }

      // State: AWAITING TASK TITLE
      if (user.bot_state === "awaiting_task_title") {
        if (!text || isReservedButton(text)) {
          return ctx.reply("⚠️ يرجى إرسال عنوان واضح وصالح للتاسك المطلوب، أو اضغط [❌ إلغاء].");
        }

        const deptId = user.managed_node_id;
        const courseId = user.pending_target_id;
        const courseNode = courseId
          ? await env.DB.prepare("SELECT title FROM nodes WHERE id = ?").bind(courseId).first<{ title: string }>()
          : null;

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

        await updateUserState(env, user.telegram_id, "awaiting_task_days", user.current_node_id, deptId, courseId);
        user.bot_state = "awaiting_task_days";

        await ctx.reply(
          `⏰ **كم يوماً متبقياً للتسليم من الآن؟**\n\n` +
            `أرسل رقماً فقط (مثال: "3" لـ 3 أيام، أو "7" لأسبوع كامل):\n` +
            `(أو اضغط [❌ إلغاء] للتراجع)`,
          { parse_mode: "Markdown" }
        );
        return;
      }

      // State: AWAITING TASK DAYS (Uses computeEndOfDayDueDate)
      if (user.bot_state === "awaiting_task_days") {
        const days = text ? parseInt(text, 10) : NaN;
        if (isNaN(days) || days <= 0 || days > 60) {
          return ctx.reply("⚠️ يرجى إرسال عدد الأيام كرقم صحيح (بين 1 و 60 يوماً).");
        }

        const draftRow = await env.DB.prepare("SELECT value FROM settings WHERE key = ?")
          .bind(`task_draft_${user.telegram_id}`)
          .first<{ value: string }>();

        if (!draftRow?.value) {
          await updateUserState(env, user.telegram_id, "browsing", user.current_node_id, null, null);
          user.bot_state = "browsing";
          return ctx.reply("حدث خطأ.");
        }

        const draft = JSON.parse(draftRow.value);
        const dueDateStr = computeEndOfDayDueDate(days);

        draft.due_date = dueDateStr;
        draft.days = days;
        await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
          .bind(`task_draft_${user.telegram_id}`, JSON.stringify(draft))
          .run();

        await updateUserState(env, user.telegram_id, "awaiting_task_attachment", user.current_node_id, draft.dept_id, null);
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
          await updateUserState(env, user.telegram_id, "browsing", user.current_node_id, null, null);
          user.bot_state = "browsing";
          return ctx.reply("حدث خطأ.");
        }

        const draft = JSON.parse(draftRow.value);
        let attachmentId: string | null = null;
        let attachmentType: "document" | "photo" | "video" | null = null;

        if (ctx.message.document) {
          attachmentId = ctx.message.document.file_id;
          attachmentType = "document";
        } else if (ctx.message.photo) {
          const highestPhoto = ctx.message.photo[ctx.message.photo.length - 1];
          attachmentId = highestPhoto.file_id;
          attachmentType = "photo";
        } else if (ctx.message.video) {
          attachmentId = ctx.message.video.file_id;
          attachmentType = "video";
        }

        const taskInsert = await env.DB.prepare(
          `INSERT INTO weekly_tasks (dept_node_id, course_title, task_title, due_date, attachment_file_id, attachment_type, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
        )
          .bind(draft.dept_id, draft.course_title, draft.task_title, draft.due_date, attachmentId, attachmentType, user.telegram_id)
          .first<{ id: number }>();

        await env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(`task_draft_${user.telegram_id}`).run();
        await updateUserState(env, user.telegram_id, "browsing", user.current_node_id, null, null);
        user.bot_state = "browsing";

        const notifyKb = new InlineKeyboard().text(
          "🔔 إرسال تنبيه لطلاب القسم بهذا التاسك",
          `notify_new_task_${taskInsert?.id}_${draft.dept_id}`
        );

        await ctx.reply(
          `✅ **تم حفظ ونشر تاسك الأسبوع بنجاح!**\n\n` +
            `• المادة: **${draft.course_title}**\n` +
            `• التكليف: **${draft.task_title}**\n` +
            `• الموعد النهائي: **${formatTaskDeadlineArabic(draft.due_date)}**\n\n` +
            `أصبح التاسك ظاهراً الآن في قائمة [📅 تاسكات الأسبوع]. هل تريد إشعار طلاب القسم به؟`,
          { parse_mode: "Markdown", reply_markup: notifyKb }
        );

        await renderFolderView(ctx, user, user.current_node_id, env);
        return;
      }

      // State: AWAITING EDIT TASK TITLE
      if (user.bot_state === "awaiting_edit_task_title") {
        const taskId = user.pending_target_id;
        if (!taskId || !text || isReservedButton(text)) {
          return ctx.reply("⚠️ يرجى إرسال عنوان واضح وصالح للتاسك، أو اضغط [❌ إلغاء].");
        }

        await env.DB.prepare("UPDATE weekly_tasks SET task_title = ? WHERE id = ?")
          .bind(text, taskId)
          .run();

        await updateUserState(env, user.telegram_id, "browsing", user.current_node_id, null, null);
        user.bot_state = "browsing";
        user.pending_target_id = null;

        await ctx.reply(`✅ تم تعديل عنوان التاسك بنجاح إلى:\n**${text}**`, { parse_mode: "Markdown" });
        await renderSingleTaskEditor(ctx, taskId, user, env);
        return;
      }

      // State: AWAITING EDIT TASK DAYS (Uses computeEndOfDayDueDate)
      if (user.bot_state === "awaiting_edit_task_days") {
        const taskId = user.pending_target_id;
        const days = text ? parseInt(text, 10) : NaN;
        if (!taskId || isNaN(days) || days <= 0 || days > 60) {
          return ctx.reply("⚠️ يرجى إرسال عدد الأيام المتبقية للتسليم كرقم صحيح (بين 1 و 60 يوماً)، أو اضغط [❌ إلغاء].");
        }

        const dueDateStr = computeEndOfDayDueDate(days);

        await env.DB.prepare("UPDATE weekly_tasks SET due_date = ? WHERE id = ?")
          .bind(dueDateStr, taskId)
          .run();

        await updateUserState(env, user.telegram_id, "browsing", user.current_node_id, null, null);
        user.bot_state = "browsing";
        user.pending_target_id = null;

        await ctx.reply(`✅ تم تعديل موعد التسليم النهائي بنجاح ليصبح:\n**${formatTaskDeadlineArabic(dueDateStr)}**`, { parse_mode: "Markdown" });
        await renderSingleTaskEditor(ctx, taskId, user, env);
        return;
      }

      // State: AWAITING EDIT TASK FILE
      if (user.bot_state === "awaiting_edit_task_file") {
        const taskId = user.pending_target_id;
        let attachmentId: string | null = null;
        let attachmentType: "document" | "photo" | "video" | null = null;

        if (ctx.message.document) {
          attachmentId = ctx.message.document.file_id;
          attachmentType = "document";
        } else if (ctx.message.photo) {
          const highestPhoto = ctx.message.photo[ctx.message.photo.length - 1];
          attachmentId = highestPhoto.file_id;
          attachmentType = "photo";
        } else if (ctx.message.video) {
          attachmentId = ctx.message.video.file_id;
          attachmentType = "video";
        }

        if (!taskId || !attachmentId) {
          return ctx.reply("⚠️ يرجى إرسال ملف PDF أو صورة لتحديث ملف التكليف، أو اضغط [❌ إلغاء].");
        }

        await env.DB.prepare("UPDATE weekly_tasks SET attachment_file_id = ?, attachment_type = ? WHERE id = ?")
          .bind(attachmentId, attachmentType, taskId)
          .run();

        await updateUserState(env, user.telegram_id, "browsing", user.current_node_id, null, null);
        user.bot_state = "browsing";
        user.pending_target_id = null;

        await ctx.reply("✅ تم تحديث ملف التكليف بنجاح!", { parse_mode: "Markdown" });
        await renderSingleTaskEditor(ctx, taskId, user, env);
        return;
      }

      // State: UPLOADING (Supports Text Notes + Files)
      if (user.bot_state === "uploading") {
        if (text === "✅ إنهاء الحفظ" || text === "إنهاء الحفظ") {
          const folderNode = user.current_node_id
            ? await env.DB.prepare("SELECT * FROM nodes WHERE id = ?").bind(user.current_node_id).first<NodeRow>()
            : null;
          const folderTitle = folderNode?.title || "المقرر";

          const { rootDept } = user.current_node_id ? await getNodeHierarchy(env, user.current_node_id) : { rootDept: null };

          await updateUserState(env, user.telegram_id, "browsing", user.current_node_id, null, null);
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

          await renderFolderView(ctx, user, user.current_node_id, env);
          return;
        }

        let fileId: string | null = null;
        let fileName = "Unnamed File";
        let fileType: MaterialRow["file_type"] = "document";
        let caption = ctx.message.caption || null;

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
        } else if (ctx.message.text) {
          fileId = "text_content";
          fileType = "text";
          caption = ctx.message.text;
          const firstLine = ctx.message.text.split("\n")[0].trim();
          fileName = `📝 ${firstLine.substring(0, 40) || "ملاحظة نصية"}`;
        }

        if (fileId && user.current_node_id) {
          let backupMsgId: number | null = null;
          const backupChannelId = getBackupChannelId(env);
          if (backupChannelId) {
            try {
              let res: any;
              if (fileType === "text") {
                res = await ctx.api.copyMessage(backupChannelId, ctx.chat.id, ctx.message.message_id);
              } else {
                res = await ctx.api.copyMessage(backupChannelId, ctx.chat.id, ctx.message.message_id, {
                  caption: caption ? `${caption}\n\n📄 الملف: ${fileName}` : `📄 الملف: ${fileName}`,
                });
              }
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

      // State: RENAMING
      if (user.bot_state === "renaming") {
        if (text && user.managed_node_id) {
          const check = await handleFolderCreateOrRename(env, user, text, true, user.managed_node_id);
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

          await updateUserState(env, user.telegram_id, "browsing", user.current_node_id, null, null);
          user.bot_state = "browsing";
          user.managed_node_id = null;

          await ctx.reply(`✅ تم تعديل الاسم بنجاح من:\n**${oldTitle}** ⬅️ **${cleanTitle}**`, {
            parse_mode: "Markdown",
          });
          await renderFolderView(ctx, user, user.current_node_id, env);
          return;
        }
      }

      // State: AWAITING FOLDER (Adding Node)
      if (user.bot_state === "awaiting_folder") {
        if (text) {
          const check = await handleFolderCreateOrRename(env, user, text, false, null);
          if (!check.ok) {
            await ctx.reply(check.errorMsg || "⚠️ اسم غير صالح.");
            return;
          }
          const cleanTitle = check.cleanTitle!;

          const maxSortRow = await env.DB.prepare(
            "SELECT MAX(sort_order) as max_sort FROM nodes WHERE parent_id IS ? OR parent_id = ?"
          )
            .bind(user.current_node_id, user.current_node_id)
            .first<{ max_sort: number | null }>();
          const nextSort = (maxSortRow?.max_sort || 0) + 1;

          await env.DB.prepare(
            "INSERT INTO nodes (parent_id, title, sort_order, created_by, is_full_width) VALUES (?, ?, ?, ?, 0)"
          )
            .bind(user.current_node_id, cleanTitle, nextSort, user.telegram_id)
            .run();

          await updateUserState(env, user.telegram_id, "browsing", user.current_node_id, null, null);
          user.bot_state = "browsing";

          await ctx.reply(`✅ تمت إضافة الخانة/المادة **[${cleanTitle}]** بنجاح.`, {
            parse_mode: "Markdown",
          });
          await renderFolderView(ctx, user, user.current_node_id, env);
          return;
        }
      }

      // State: AWAITING LEADER ID
      if (user.bot_state === "awaiting_leader_id") {
        let targetId: number | null = null;
        let targetName = "User";

        if (ctx.message.forward_origin) {
          if (ctx.message.forward_origin.type === "user") {
            targetId = ctx.message.forward_origin.sender_user.id;
            targetName = ctx.message.forward_origin.sender_user.first_name || "User";
          }
        } else if (text) {
          const parsed = parseInt(text, 10);
          if (!isNaN(parsed) && parsed > 0) {
            targetId = parsed;
          }
        }

        if (!targetId) {
          return ctx.reply("⚠️ يرجى إرسال Telegram ID صالح كرقم، أو عمل تحويل (Forward) لرسالة من المستخدم مباشرة.");
        }

        const existing = await env.DB.prepare("SELECT * FROM users WHERE telegram_id = ?").bind(targetId).first<UserRow>();
        if (!existing) {
          await env.DB.prepare(
            "INSERT INTO users (telegram_id, full_name, role, bot_state, view_mode, notifications_enabled) VALUES (?, ?, 'leader', 'browsing', 'admin', 1)"
          )
            .bind(targetId, targetName)
            .run();
        } else {
          await env.DB.prepare("UPDATE users SET role = 'leader' WHERE telegram_id = ?").bind(targetId).run();
        }

        await updateUserState(env, user.telegram_id, "browsing", user.current_node_id, null, null);
        user.bot_state = "browsing";

        await ctx.reply(`✅ تم بنجاح تعيين المستخدم (${targetId}) كرتبة Leader!`);
        await renderLeaderPermissions(ctx, targetId, env);
        return;
      }

      // ================= ACTIONS & NAVIGATION =================

      if (text === "⬅️ رجوع" && user.current_node_id !== null) {
        const currentNode: NodeRow | null = await env.DB.prepare("SELECT * FROM nodes WHERE id = ?")
          .bind(user.current_node_id)
          .first<NodeRow>();

        const parentId = currentNode ? currentNode.parent_id : null;
        await updateUserState(env, user.telegram_id, "browsing", parentId, null, null);
        user.current_node_id = parentId;
        user.bot_state = "browsing";
        if (parentId === null && isPrivileged(user)) {
          await renderTopLevel(ctx, user, env);
        } else {
          await renderFolderView(ctx, user, parentId, env);
        }
        return;
      }

      // Feature: Download All Content Recursively
      if (text === "📦 عرض وتحميل كل المحتوى" && user.current_node_id) {
        const groups = await getAllDescendantMaterialsGrouped(env, user.current_node_id);
        if (groups.length === 0) {
          return ctx.reply("لا توجد ملفات مرفوعة في أي من المحاضرات أو السكاشن هنا بعد.");
        }

        for (const g of groups) {
          await ctx.reply(`📂 **[ ${g.folderPath} ]**`, { parse_mode: "Markdown" });
          await sendBatchMaterials(ctx, g.materials, env);
        }
        return;
      }

      // Student Action: Crowdsource note contribution
      if (text === "📝 ساهم بملخص أو امتحان" && user.current_node_id) {
        const { courseNode } = await getNodeHierarchy(env, user.current_node_id);
        if (!courseNode) {
          return ctx.reply("⚠️ يرجى الدخول لمادة دراسية أولاً للمساهمة فيها.");
        }

        await updateUserState(env, user.telegram_id, "awaiting_submission", user.current_node_id, null, courseNode.id);
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
      if (text === "📅 إضافة تاسك للأسبوع" && (await canManage(env, user, user.current_node_id)) && user.current_node_id !== null) {
        const { rootDept, courseNode } = await getNodeHierarchy(env, user.current_node_id);

        if (!rootDept) {
          return ctx.reply("⚠️ لا يمكن تحديد القسم التابع له هذا المجلد.");
        }

        if (!courseNode) {
          const children = await getChildNodes(env, user.current_node_id);
          if (children.length > 0) {
            const kb = new InlineKeyboard();
            for (const c of children) {
              kb.text(c.title, `pick_task_course:${c.id}`).row();
            }
            kb.text("❌ إلغاء", "close_tasks");
            await ctx.reply("📚 **اختر المادة المراد إضافة تاسك لها:**", {
              parse_mode: "Markdown",
              reply_markup: kb,
            });
            return;
          }
        }

        const effectiveCourseId = courseNode ? courseNode.id : user.current_node_id;
        const effectiveCourseTitle = courseNode ? courseNode.title : "المقرر";

        await updateUserState(env, user.telegram_id, "awaiting_task_title", user.current_node_id, rootDept.id, effectiveCourseId);
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
      if (text === "📢 إرسال إشعار للقسم" && (await canManage(env, user, user.current_node_id)) && user.current_node_id !== null) {
        const { rootDept } = await getNodeHierarchy(env, user.current_node_id);
        if (!rootDept) {
          return ctx.reply("⚠️ لا يمكن تحديد القسم التابع له هذا المجلد.");
        }

        await updateUserState(env, user.telegram_id, "awaiting_broadcast", user.current_node_id, rootDept.id, null);
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

      // Admin Action: Upload Files (Bug 2 Fixed: row with ❌ إلغاء added)
      if (text === "📤 رفع ملفات هنا" && (await canManage(env, user, user.current_node_id))) {
        if (!user.current_node_id) {
          return ctx.reply("❌ لا يمكن رفع ملفات في الصفحة الرئيسية، يرجى الدخول لمادة أو خانة أولاً.");
        }
        await updateUserState(env, user.telegram_id, "uploading", user.current_node_id, null, null);
        user.bot_state = "uploading";
        const uploadKeyboard = new Keyboard()
          .text("✅ إنهاء الحفظ")
          .row()
          .text("❌ إلغاء")
          .resized();
        await ctx.reply(
          `📤 **وضع الرفع نشط الآن:**\n\nقم بإرسال أو تحويل (Forward) كل ملفات الـ PDF أو الفيديوهات أو الصور أو الرسائل النصية هنا دفعة واحدة.\n\nوعند الانتهاء اضغط زر **[✅ إنهاء الحفظ]** أو **[❌ إلغاء]**.`,
          { parse_mode: "Markdown", reply_markup: uploadKeyboard }
        );
        return;
      }

      // Admin Action: Add Node
      if ((text === "➕ إضافة خانة/مادة" || text === "➕ إضافة قسم جديد") && (await canManage(env, user, user.current_node_id))) {
        await updateUserState(env, user.telegram_id, "awaiting_folder", user.current_node_id, null, null);
        user.bot_state = "awaiting_folder";
        const cancelKeyboard = new Keyboard().text("❌ إلغاء").resized();
        await ctx.reply("✍️ أرسل الآن اسم المادة أو الخانة الجديدة:", {
          reply_markup: cancelKeyboard,
        });
        return;
      }

      // Admin Action: Rename Node
      if (text === "✏️ تعديل الاسم" && (await canManage(env, user, user.current_node_id)) && user.current_node_id) {
        const children = await getChildNodes(env, user.current_node_id);
        const currentNode: NodeRow | null = await env.DB.prepare("SELECT * FROM nodes WHERE id = ?")
          .bind(user.current_node_id)
          .first<NodeRow>();

        const inlineKeyboard = new InlineKeyboard();
        if (currentNode) {
          inlineKeyboard.text(`✏️ تعديل اسم هذا المجلد الحالي [${currentNode.title}]`, `rename_${currentNode.id}`).row();
        }
        for (const child of children) {
          inlineKeyboard.text(`✏️ تعديل: ${child.title}`, `rename_${child.id}`).row();
        }
        inlineKeyboard.text("❌ إغلاق", "close_rename");

        await ctx.reply("اختر الخانة أو المجلد المراد تعديل اسمه 👇", {
          reply_markup: inlineKeyboard,
        });
        return;
      }

      // Admin Action: Customize Layout
      if (text === "📐 تخصيص العرض والصفوف" && (await canManage(env, user, user.current_node_id))) {
        const children = await getChildNodes(env, user.current_node_id);
        if (children.length === 0) {
          return ctx.reply("⚠️ لا توجد خانات لتخصيص عرضها في هذا المجلد.");
        }
        const inlineKeyboard = buildWidthCustomizationKeyboard(children, user.current_node_id !== null);
        await ctx.reply(
          `📐 **لوحة تخصيص شكل وترتيب الأزرار:**\n\n` +
            `• يمكنك جعل أي زر **مزدوجاً (صف ثنائي)** أو **عريضاً (صف كامل)** لتحسين شكل القوائم للطلاب.\n` +
            `• يمكنك تعميم التنسيق على باقي مواد القسم أو كل مواد الكلية بضغطة واحدة 👇`,
          { reply_markup: inlineKeyboard }
        );
        return;
      }

      // Admin Action: Send Files in Node
      if (text === "📥 إرسال الملفات" && user.current_node_id) {
        const materials = await getNodeMaterials(env, user.current_node_id);
        if (materials.length > 0) {
          await sendBatchMaterials(ctx, materials, env);
        } else {
          await ctx.reply("لا توجد ملفات في هذا المجلد بعد.");
        }
        return;
      }

      // Admin Action: Delete node or material
      if (text === "🗑️ حذف خانة أو ملف" && (await canManage(env, user, user.current_node_id)) && user.current_node_id) {
        const [children, materials] = await Promise.all([
          getChildNodes(env, user.current_node_id),
          getNodeMaterials(env, user.current_node_id),
        ]);

        if (children.length === 0 && materials.length === 0) {
          await ctx.reply("لا توجد خانات أو ملفات متاحة في هذا المجلد.");
          return;
        }

        const deleteKeyboard = await buildDeleteKeyboard(env, user.current_node_id);
        await ctx.reply("اضغط على العنصر المراد حذفه نهائياً 👇", {
          reply_markup: deleteKeyboard,
        });
        return;
      }

      // Dynamic Node Navigation
      if (text) {
        const childNode: NodeRow | null = await env.DB.prepare(
          "SELECT * FROM nodes WHERE (parent_id IS ? OR parent_id = ?) AND title = ?"
        )
          .bind(user.current_node_id, user.current_node_id, text)
          .first<NodeRow>();

        if (childNode) {
          const grandChildren = await getChildNodes(env, childNode.id);
          if (grandChildren.length === 0) {
            const mats = await getNodeMaterials(env, childNode.id);
            if (mats.length > 0) {
              await sendBatchMaterials(ctx, mats, env);
            } else {
              await ctx.reply(`لا توجد ملفات في ${childNode.title} بعد.`);
            }
            return;
          }

          await updateUserState(env, user.telegram_id, "browsing", childNode.id, null, null);
          user.current_node_id = childNode.id;
          await renderFolderView(ctx, user, childNode.id, env);
          return;
        }
      }

      await renderFolderView(ctx, user, user.current_node_id, env);
    });

    // ================= INLINE CALLBACKS =================

    bot.on("callback_query:data", async (ctx) => {
      const user = await getUser(env, ctx.from.id);
      const data = ctx.callbackQuery.data;

      if (
        data === "close_admin" ||
        data === "close_customization" ||
        data === "close_rename" ||
        data === "close_tasks" ||
        data === "close_sub_pick" ||
        data === "close_notifications"
      ) {
        await ctx.deleteMessage().catch(() => {});
        return;
      }

      if (data === "close_delete") {
        await ctx.deleteMessage().catch(() => {});
        await renderFolderView(ctx, user, user.current_node_id, env);
        return;
      }

      if (data === "open_change_dept") {
        await renderDepartmentOnboarding(ctx, true, env);
        return;
      }

      // Quick Admin Cleanup button from Admin Panel
      if (data === "admin_cleanup_test") {
        if (!isPrivileged(user)) {
          await ctx.answerCallbackQuery({ text: "❌ للمسؤولين فقط", show_alert: true });
          return;
        }
        const delFolderRes = await env.DB.prepare("DELETE FROM nodes WHERE title = 'مممم'").run();
        const delMatRes = await env.DB.prepare(
          `DELETE FROM materials 
           WHERE file_name = 'sql_server_indexes_practice_exam.pdf'
              OR node_id IN (SELECT DISTINCT parent_id FROM nodes WHERE parent_id IS NOT NULL)`
        ).run();

        await ctx.answerCallbackQuery({
          text: `🧹 تم تنظيف (${delFolderRes.meta?.changes || 0}) مجلد و (${delMatRes.meta?.changes || 0}) ملف خاطئ!`,
          show_alert: true,
        });
        return;
      }

      // First-time or Change Department Selection
      if (data.startsWith("pick_initial_dept_")) {
        const deptId = parseInt(data.replace("pick_initial_dept_", ""), 10);
        await env.DB.prepare(
          "UPDATE users SET subscribed_dept_id = ?, notifications_enabled = 1, current_node_id = NULL, bot_state = 'browsing' WHERE telegram_id = ?"
        )
          .bind(deptId, user.telegram_id)
          .run();

        user.subscribed_dept_id = deptId;
        user.notifications_enabled = 1;
        user.current_node_id = null;
        user.bot_state = "browsing";

        await ctx.answerCallbackQuery({ text: "✅ تم حفظ قسمك وتفعيل الإشعارات بنجاح!" });
        await ctx.deleteMessage().catch(() => {});
        await renderFolderView(ctx, user, null, env);
        return;
      }

      // Pick Course for adding Weekly Task
      if (data.startsWith("pick_task_course:")) {
        const courseId = parseInt(data.replace("pick_task_course:", ""), 10);
        const course = await env.DB.prepare("SELECT * FROM nodes WHERE id = ?").bind(courseId).first<NodeRow>();
        if (!course) {
          await ctx.answerCallbackQuery({ text: "المادة غير موجودة", show_alert: true }).catch(() => {});
          return;
        }

        const { rootDept } = await getNodeHierarchy(env, course.id);
        if (!rootDept || !(await canManageDept(env, user, rootDept.id))) {
          await ctx.answerCallbackQuery({ text: "❌ لا تملك الصلاحية لإضافة تاسك لهذه المادة", show_alert: true }).catch(() => {});
          return;
        }

        await ctx.answerCallbackQuery().catch(() => {});
        await ctx.deleteMessage().catch(() => {});

        await updateUserState(env, user.telegram_id, "awaiting_task_title", course.id, rootDept.id, course.id);
        user.bot_state = "awaiting_task_title";
        user.managed_node_id = rootDept.id;
        user.pending_target_id = course.id;

        const cancelKeyboard = new Keyboard().text("❌ إلغاء").resized();
        await ctx.reply(
          `📅 **إضافة تاسك/تكليف للأسبوع — [${course.title}]:**\n\n` +
            `✍️ أرسل الآن عنوان التاسك أو التكليف المطلوب:\n` +
            `(مثال: "تسليم الشيت الثالث — مسائل الـ Syntax Analysis")\n\n` +
            `اضغط [❌ إلغاء] للتراجع.`,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard }
        );
        return;
      }

      // Download task attachment (Bug 3 Fixed: plain text caption without parse_mode prevents underscore crash)
      if (data.startsWith("dl_task_")) {
        const taskId = parseInt(data.replace("dl_task_", ""), 10);
        const task = await env.DB.prepare("SELECT * FROM weekly_tasks WHERE id = ?").bind(taskId).first<WeeklyTaskRow>();
        if (!task || !task.attachment_file_id) {
          await ctx.answerCallbackQuery({ text: "لا يوجد ملف مرفق لهذا التاسك", show_alert: true }).catch(() => {});
          return;
        }

        await ctx.answerCallbackQuery().catch(() => {});
        const caption = `📎 ملف التكليف: ${task.task_title}\n📚 المادة: ${task.course_title}`;
        const type = task.attachment_type || "document";

        try {
          if (type === "photo") {
            await ctx.replyWithPhoto(task.attachment_file_id, { caption });
          } else if (type === "video") {
            await ctx.replyWithVideo(task.attachment_file_id, { caption });
          } else {
            await ctx.replyWithDocument(task.attachment_file_id, { caption });
          }
        } catch (e) {
          try {
            await ctx.replyWithPhoto(task.attachment_file_id, { caption });
          } catch {
            try {
              await ctx.replyWithDocument(task.attachment_file_id, { caption });
            } catch (err) {
              await ctx.reply(`⚠️ تعذر إرسال المرفق: ${(err as any)?.message || "خطأ غير متوقع"}`);
            }
          }
        }
        return;
      }

      // Manage Weekly Tasks list for Department (Bug 5 Fixed: no outer answerCallbackQuery)
      if (data.startsWith("manage_tasks_")) {
        const deptId = parseInt(data.replace("manage_tasks_", ""), 10);
        await renderTaskManagementList(ctx, deptId, user, env);
        return;
      }

      // Back to Weekly Tasks list
      if (data.startsWith("back_to_tasks_")) {
        const deptId = parseInt(data.replace("back_to_tasks_", ""), 10);
        await ctx.answerCallbackQuery();
        await renderWeeklyTasks(ctx, user, env, deptId);
        return;
      }

      // Single Task Management Menu (Bug 5 Fixed: no outer answerCallbackQuery)
      if (data.startsWith("task_menu_")) {
        const taskId = parseInt(data.replace("task_menu_", ""), 10);
        await renderSingleTaskEditor(ctx, taskId, user, env);
        return;
      }

      // Edit Task Title Prompt
      if (data.startsWith("edit_t_title_")) {
        const taskId = parseInt(data.replace("edit_t_title_", ""), 10);
        await updateUserState(env, user.telegram_id, "awaiting_edit_task_title", user.current_node_id, null, taskId);
        user.bot_state = "awaiting_edit_task_title";
        user.pending_target_id = taskId;
        await ctx.deleteMessage().catch(() => {});
        const cancelKeyboard = new Keyboard().text("❌ إلغاء").resized();
        await ctx.reply("✍️ **أرسل الآن العنوان الجديد للتاسك/التكليف:**\n(أو اضغط [❌ إلغاء])", {
          parse_mode: "Markdown",
          reply_markup: cancelKeyboard,
        });
        return;
      }

      // Edit Task Days Prompt
      if (data.startsWith("edit_t_days_")) {
        const taskId = parseInt(data.replace("edit_t_days_", ""), 10);
        await updateUserState(env, user.telegram_id, "awaiting_edit_task_days", user.current_node_id, null, taskId);
        user.bot_state = "awaiting_edit_task_days";
        user.pending_target_id = taskId;
        await ctx.deleteMessage().catch(() => {});
        const cancelKeyboard = new Keyboard().text("❌ إلغاء").resized();
        await ctx.reply(
          `⏰ **كم يوماً متبقياً للتسليم من الآن؟**\n\nأرسل رقماً صحيحاً (مثال: "3" لـ 3 أيام، أو "7" لأسبوع):\n(أو اضغط [❌ إلغاء])`,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard }
        );
        return;
      }

      // Edit Task File Prompt
      if (data.startsWith("edit_t_file_")) {
        const taskId = parseInt(data.replace("edit_t_file_", ""), 10);
        await updateUserState(env, user.telegram_id, "awaiting_edit_task_file", user.current_node_id, null, taskId);
        user.bot_state = "awaiting_edit_task_file";
        user.pending_target_id = taskId;
        await ctx.deleteMessage().catch(() => {});
        const cancelKeyboard = new Keyboard().text("❌ إلغاء").resized();
        await ctx.reply("📎 **أرسل الآن ملف الـ PDF أو الصورة الجديدة الخاصة بالتكليف:**\n(أو اضغط [❌ إلغاء])", {
          parse_mode: "Markdown",
          reply_markup: cancelKeyboard,
        });
        return;
      }

      // Remove Task File Attachment
      if (data.startsWith("remove_t_file_")) {
        const taskId = parseInt(data.replace("remove_t_file_", ""), 10);
        await env.DB.prepare("UPDATE weekly_tasks SET attachment_file_id = NULL WHERE id = ?").bind(taskId).run();
        await ctx.answerCallbackQuery({ text: "✅ تم حذف الملف المرفق من التاسك." });
        await renderSingleTaskEditor(ctx, taskId, user, env);
        return;
      }

      // Delete Task Prompt Confirmation
      if (data.startsWith("del_t_prompt_")) {
        const taskId = parseInt(data.replace("del_t_prompt_", ""), 10);
        const task = await env.DB.prepare("SELECT * FROM weekly_tasks WHERE id = ?").bind(taskId).first<WeeklyTaskRow>();
        if (!task) {
          await ctx.answerCallbackQuery({ text: "التاسك غير موجود", show_alert: true });
          return;
        }

        const kb = new InlineKeyboard()
          .text("🗑️ نعم، تأكيد الحذف نهائياً", `del_t_confirm_${taskId}`)
          .row()
          .text("❌ تراجع وإلغاء", `task_menu_${taskId}`);

        await ctx.editMessageText(
          `⚠️ **هل أنت متأكد من حذف هذا التاسك نهائياً؟**\n\n` +
            `• المادة: **${task.course_title}**\n` +
            `• التكليف: **${task.task_title}**\n\n` +
            `لا يمكن التراجع عن الحذف بعد التأكيد.`,
          { parse_mode: "Markdown", reply_markup: kb }
        );
        return;
      }

      // Delete Task Confirmed
      if (data.startsWith("del_t_confirm_")) {
        const taskId = parseInt(data.replace("del_t_confirm_", ""), 10);
        const task = await env.DB.prepare("SELECT dept_node_id FROM weekly_tasks WHERE id = ?").bind(taskId).first<{ dept_node_id: number }>();
        await env.DB.prepare("DELETE FROM weekly_tasks WHERE id = ?").bind(taskId).run();
        await ctx.answerCallbackQuery({ text: "🗑️ تم حذف التاسك بنجاح!" });
        if (task) {
          await renderTaskManagementList(ctx, task.dept_node_id, user, env);
        } else {
          await ctx.deleteMessage().catch(() => {});
        }
        return;
      }

      // Simplified Notification On/Off Toggle
      if (data === "mute_notifications") {
        await env.DB.prepare("UPDATE users SET notifications_enabled = 0 WHERE telegram_id = ?")
          .bind(user.telegram_id)
          .run();
        user.notifications_enabled = 0;
        await ctx.answerCallbackQuery({ text: "🔕 تم إيقاف الإشعارات مؤقتاً." });
        await renderNotificationToggleCard(ctx, user, env);
        if (user.current_node_id === null && !(await canManage(env, user, null))) {
          await renderFolderView(ctx, user, null, env);
        }
        return;
      }

      if (data === "unmute_notifications") {
        await env.DB.prepare("UPDATE users SET notifications_enabled = 1 WHERE telegram_id = ?")
          .bind(user.telegram_id)
          .run();
        user.notifications_enabled = 1;
        await ctx.answerCallbackQuery({ text: "🔔 تم تشغيل الإشعارات بنجاح!" });
        await renderNotificationToggleCard(ctx, user, env);
        if (user.current_node_id === null && !(await canManage(env, user, null))) {
          await renderFolderView(ctx, user, null, env);
        }
        return;
      }

      // Silent moderation: Ignore submission
      if (data.startsWith("sub_ignore:")) {
        const subId = parseInt(data.replace("sub_ignore:", ""), 10);
        await env.DB.prepare("UPDATE submissions SET status = 'ignored' WHERE id = ?").bind(subId).run();
        await ctx.deleteMessage().catch(() => {});
        await ctx.answerCallbackQuery({ text: "🗑️ تم التجاهل والحذف بصمت." });
        return;
      }

      // Recursive Tree Browser for Submissions
      if (data.startsWith("sub_pick_folder:") || data.startsWith("sub_browse:")) {
        let subId = 0;
        let targetNodeId = 0;

        if (data.startsWith("sub_pick_folder:")) {
          subId = parseInt(data.replace("sub_pick_folder:", ""), 10);
          const sub = await env.DB.prepare("SELECT course_node_id FROM submissions WHERE id = ?").bind(subId).first<{ course_node_id: number }>();
          targetNodeId = sub?.course_node_id || 0;
        } else {
          const parts = data.replace("sub_browse:", "").split(":");
          subId = parseInt(parts[0], 10);
          targetNodeId = parseInt(parts[1], 10);
        }

        if (!subId || !targetNodeId) {
          await ctx.answerCallbackQuery({ text: "المساهمة غير موجودة", show_alert: true });
          return;
        }

        await ctx.answerCallbackQuery();
        await renderSubmissionTreeBrowser(ctx, subId, targetNodeId, env);
        return;
      }

      // Moderation: Place approved submission in folder
      if (data.startsWith("sub_place:")) {
        const parts = data.replace("sub_place:", "").split(":");
        const subId = parseInt(parts[0], 10);
        const targetFolderId = parseInt(parts[1], 10);

        const sub = await env.DB.prepare("SELECT * FROM submissions WHERE id = ?").bind(subId).first<SubmissionRow>();
        if (!sub) {
          await ctx.answerCallbackQuery({ text: "المساهمة غير موجودة" });
          return;
        }

        const { breadcrumb } = await getNodeHierarchy(env, targetFolderId);
        const targetNode = await env.DB.prepare("SELECT title FROM nodes WHERE id = ?").bind(targetFolderId).first<{ title: string }>();
        const backupMsgId = await backupSubmissionToChannel(bot, env, sub, targetNode?.title || "مجلد");

        const matInsert = await env.DB.prepare(
          `INSERT INTO materials (node_id, file_name, telegram_file_id, file_type, caption, uploaded_by, backup_message_id)
           VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
        )
          .bind(targetFolderId, sub.file_name, sub.telegram_file_id, sub.file_type, sub.caption, sub.student_id, backupMsgId)
          .first<{ id: number }>();

        const insertedMatId = matInsert?.id || 0;
        await env.DB.prepare("UPDATE submissions SET status = 'approved' WHERE id = ?").bind(subId).run();

        const undoKb = new InlineKeyboard()
          .text("↩️ خطأ في المكان؟ سحب الملف وإعادة اختيار الفولدر", `sub_undo:${subId}:${insertedMatId}:0`)
          .row()
          .text("🗑️ حذف هذا الملف نهائياً", `sub_delete_published:${subId}:${insertedMatId}:0`);

        const successText =
          `✅ **تم اعتماد المساهمة ونشر الملف بنجاح!**\n\n` +
          `📍 **المسار المحفوظ فيه:**\n\`${breadcrumb}\`\n\n` +
          `_(إذا أردت تغيير مكانه أو كنت تجرب فقط، اضغط زر التراجع بالأسفل)_`;

        try {
          await ctx.editMessageCaption({ caption: successText, parse_mode: "Markdown", reply_markup: undoKb });
        } catch {
          await ctx.editMessageText(successText, { parse_mode: "Markdown", reply_markup: undoKb });
        }
        await ctx.answerCallbackQuery({ text: "✅ تم النشر بنجاح!" });
        return;
      }

      // Undo published submission
      if (data.startsWith("sub_undo:")) {
        const parts = data.replace("sub_undo:", "").split(":");
        const subId = parseInt(parts[0], 10);
        const matId = parseInt(parts[1], 10);
        const createdFolderId = parseInt(parts[2], 10);

        if (matId > 0) {
          const deleted = await env.DB.prepare("DELETE FROM materials WHERE id = ? RETURNING backup_message_id").bind(matId).first<{ backup_message_id: number | null }>();
          const backupChannelId = getBackupChannelId(env);
          if (backupChannelId && deleted?.backup_message_id) {
            await bot.api.deleteMessage(backupChannelId, deleted.backup_message_id).catch(() => {});
          }
        }
        if (createdFolderId > 0) {
          await env.DB.prepare("DELETE FROM nodes WHERE id = ?").bind(createdFolderId).run();
        }

        await env.DB.prepare("UPDATE submissions SET status = 'pending' WHERE id = ?").bind(subId).run();
        const sub = await env.DB.prepare("SELECT * FROM submissions WHERE id = ?").bind(subId).first<SubmissionRow>();

        await ctx.answerCallbackQuery({ text: "↩️ تم سحب الملف وإلغاء الخطوة! اختر المسار الجديد الآن." });
        if (sub) {
          await renderSubmissionTreeBrowser(ctx, sub.id, sub.course_node_id, env);
        }
        return;
      }

      // Delete published submission & folder permanently
      if (data.startsWith("sub_delete_published:")) {
        const parts = data.replace("sub_delete_published:", "").split(":");
        const subId = parseInt(parts[0], 10);
        const matId = parseInt(parts[1], 10);
        const createdFolderId = parseInt(parts[2], 10);

        if (matId > 0) {
          const deleted = await env.DB.prepare("DELETE FROM materials WHERE id = ? RETURNING backup_message_id").bind(matId).first<{ backup_message_id: number | null }>();
          const backupChannelId = getBackupChannelId(env);
          if (backupChannelId && deleted?.backup_message_id) {
            await bot.api.deleteMessage(backupChannelId, deleted.backup_message_id).catch(() => {});
          }
        }
        if (createdFolderId > 0) {
          await env.DB.prepare("DELETE FROM nodes WHERE id = ?").bind(createdFolderId).run();
        }
        await env.DB.prepare("UPDATE submissions SET status = 'ignored' WHERE id = ?").bind(subId).run();

        await ctx.deleteMessage().catch(() => {});
        await ctx.answerCallbackQuery({ text: "🗑️ تم حذف الملف والفولدر نهائياً." });
        return;
      }

      // Moderation: Create folder inside current path
      if (data.startsWith("sub_new_folder:")) {
        const parts = data.replace("sub_new_folder:", "").split(":");
        const subId = parseInt(parts[0], 10);
        const targetParentId = parseInt(parts[1], 10);

        const { breadcrumb } = await getNodeHierarchy(env, targetParentId);

        await updateUserState(env, user.telegram_id, "awaiting_submission_folder", user.current_node_id, targetParentId, subId);
        user.bot_state = "awaiting_submission_folder";
        user.managed_node_id = targetParentId;
        user.pending_target_id = subId;

        await ctx.deleteMessage().catch(() => {});
        const cancelKeyboard = new Keyboard().text("❌ إلغاء").resized();
        await ctx.reply(
          `📁 **إنشاء قسم/مجلد جديد للمساهمة:**\n\n` +
            `📍 **سيتم إنشاء المجلد الجديد داخل المسار:**\n\`${breadcrumb}\`\n\n` +
            `✍️ أرسل الآن اسم المجلد الجديد لإنشائه ووضع الملف بداخله فوراً (أو اضغط [❌ إلغاء]):`,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard }
        );
        return;
      }

      // Batch upload broadcast prompt callback
      if (data.startsWith("notify_new_materials_")) {
        const parts = data.replace("notify_new_materials_", "").split("_");
        const folderId = parseInt(parts[0], 10);
        const deptId = parseInt(parts[1], 10);

        if (!(await canManage(env, user, folderId))) {
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

      // New weekly task broadcast prompt callback (Uses formatTaskDeadlineArabic)
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

        const formattedDeadline = formatTaskDeadlineArabic(task.due_date);
        const taskAnnounceMsg = await ctx.reply(
          `📅 **تاسك وتكليف جديد — [${deptTitle}]**\n\n` +
            `📌 مادة: **${task.course_title}**\n` +
            `📝 **${task.task_title}**\n` +
            `⏰ الموعد النهائي: **${formattedDeadline}**\n\n` +
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
        await renderAdminPanel(ctx, env);
        return;
      }

      if (data === "admin_stats") {
        if (user.role !== "super_admin") {
          await ctx.answerCallbackQuery({ text: "❌ مخصص للمسؤول العام فقط", show_alert: true });
          return;
        }
        await renderStats(ctx, user, env);
        return;
      }

      if (data === "admin_notify_all_leaders") {
        if (user.role !== "super_admin") {
          await ctx.answerCallbackQuery({ text: "❌ مخصص للمسؤول العام فقط", show_alert: true });
          return;
        }
        await updateUserState(env, user.telegram_id, "awaiting_admin_broadcast", user.current_node_id, null, null);
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
        await renderLeadersList(ctx, env);
        return;
      }

      if (data === "admin_add_leader") {
        if (user.role !== "super_admin") {
          await ctx.answerCallbackQuery({ text: "❌ مخصص للمسؤول العام فقط", show_alert: true });
          return;
        }
        await updateUserState(env, user.telegram_id, "awaiting_leader_id", user.current_node_id, null, null);
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
        await renderLeaderPermissions(ctx, leaderId, env);
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

        await renderLeaderPermissions(ctx, leaderId, env);
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
        await renderLeadersList(ctx, env);
        return;
      }

      if (!(await canManage(env, user, user.current_node_id))) {
        await ctx.answerCallbackQuery({ text: "❌ لا تملك الصلاحية في هذا القسم", show_alert: true });
        return;
      }

      // Toggle width
      if (data.startsWith("toggle_width_")) {
        const nodeId = parseInt(data.replace("toggle_width_", ""), 10);
        if (!(await canManage(env, user, nodeId))) {
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

          const children = await getChildNodes(env, user.current_node_id);
          const updatedInlineKeyboard = buildWidthCustomizationKeyboard(children, user.current_node_id !== null);
          await ctx.editMessageReplyMarkup({ reply_markup: updatedInlineKeyboard });

          await renderFolderView(ctx, user, user.current_node_id, env);
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

        const templateChildren = await getChildNodes(env, user.current_node_id);
        const { results: siblingSubjects } = await env.DB.prepare("SELECT id FROM nodes WHERE parent_id = ? AND id != ?")
          .bind(currentNode.parent_id, currentNode.id)
          .all<{ id: number }>();

        if (siblingSubjects && siblingSubjects.length > 0 && templateChildren.length > 0) {
          const stmts: D1PreparedStatement[] = [];
          for (const sub of siblingSubjects) {
            for (const tc of templateChildren) {
              stmts.push(
                env.DB.prepare("UPDATE nodes SET is_full_width = ?, sort_order = ? WHERE parent_id = ? AND title = ?")
                  .bind(tc.is_full_width, tc.sort_order, sub.id, tc.title)
              );
            }
          }
          if (stmts.length > 0) {
            await env.DB.batch(stmts);
          }
        }

        await ctx.answerCallbackQuery({ text: "✅ تم بنجاح تعميم هذا التنسيق على جميع مواد هذا القسم!", show_alert: true });
        return;
      }

      // Propagate layout across the entire college
      if (data === "apply_layout_all") {
        if (user.role !== "super_admin") {
          await ctx.answerCallbackQuery({ text: "⚠️ تعميم التنسيق على كل أقسام الكلية متاح للمسؤول العام فقط.", show_alert: true });
          return;
        }
        const templateChildren = await getChildNodes(env, user.current_node_id);
        if (templateChildren.length > 0) {
          const stmts = templateChildren.map((tc) =>
            env.DB.prepare("UPDATE nodes SET is_full_width = ?, sort_order = ? WHERE title = ?")
              .bind(tc.is_full_width, tc.sort_order, tc.title)
          );
          await env.DB.batch(stmts);
        }

        await ctx.answerCallbackQuery({ text: "✅ تم بنجاح تعميم هذا التنسيق على كل مواد الكلية!", show_alert: true });
        return;
      }

      // Rename prompt
      if (data.startsWith("rename_")) {
        const nodeId = parseInt(data.replace("rename_", ""), 10);
        if (!(await canManage(env, user, nodeId))) {
          await ctx.answerCallbackQuery({ text: "❌ لا تملك الصلاحية", show_alert: true });
          return;
        }
        const targetNode: NodeRow | null = await env.DB.prepare("SELECT * FROM nodes WHERE id = ?")
          .bind(nodeId)
          .first<NodeRow>();

        await updateUserState(env, user.telegram_id, "renaming", user.current_node_id, nodeId, null);
        user.bot_state = "renaming";
        user.managed_node_id = nodeId;
        await ctx.deleteMessage().catch(() => {});

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
        if (!(await canManage(env, user, nodeId))) {
          await ctx.answerCallbackQuery({ text: "❌ لا تملك الصلاحية", show_alert: true });
          return;
        }

        const existingKeyboard = ctx.callbackQuery.message?.reply_markup?.inline_keyboard || [];
        const updatedKeyboard = existingKeyboard
          .map((row: any[]) => row.filter((btn: any) => btn.callback_data !== data))
          .filter((row: any[]) => row.length > 0);

        const onlyCloseLeft =
          updatedKeyboard.length === 0 ||
          (updatedKeyboard.length === 1 && updatedKeyboard[0][0]?.callback_data === "close_delete");

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

        const dbPromise = (async () => {
          try {
            const backupChannelId = getBackupChannelId(env);
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
        if (!(await canManage(env, user, user.current_node_id))) {
          await ctx.answerCallbackQuery({ text: "❌ لا تملك الصلاحية", show_alert: true });
          return;
        }

        const existingKeyboard = ctx.callbackQuery.message?.reply_markup?.inline_keyboard || [];
        const updatedKeyboard = existingKeyboard
          .map((row: any[]) => row.filter((btn: any) => btn.callback_data !== data))
          .filter((row: any[]) => row.length > 0);

        const onlyCloseLeft =
          updatedKeyboard.length === 0 ||
          (updatedKeyboard.length === 1 && updatedKeyboard[0][0]?.callback_data === "close_delete");

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

        const dbPromise = (async () => {
          try {
            const deleted = await env.DB.prepare(
              "DELETE FROM materials WHERE id = ? RETURNING backup_message_id"
            )
              .bind(matId)
              .first<{ backup_message_id: number | null }>();

            const backupChannelId = getBackupChannelId(env);
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
