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
  bot_state: "browsing" | "awaiting_folder" | "uploading" | "renaming" | "deleting" | "awaiting_leader_id";
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

export default {
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
          "INSERT INTO users (telegram_id, full_name, role, current_node_id, bot_state, view_mode) VALUES (?, ?, ?, NULL, 'browsing', 'admin')"
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

      return user;
    }

    async function updateUserState(
      telegramId: number,
      state: UserRow["bot_state"],
      currentNodeId?: number | null,
      managedNodeId?: number | null
    ) {
      if (currentNodeId !== undefined && managedNodeId !== undefined) {
        await env.DB.prepare("UPDATE users SET bot_state = ?, current_node_id = ?, managed_node_id = ? WHERE telegram_id = ?")
          .bind(state, currentNodeId, managedNodeId, telegramId)
          .run();
      } else if (currentNodeId !== undefined) {
        await env.DB.prepare("UPDATE users SET bot_state = ?, current_node_id = ? WHERE telegram_id = ?")
          .bind(state, currentNodeId, telegramId)
          .run();
      } else if (managedNodeId !== undefined) {
        await env.DB.prepare("UPDATE users SET bot_state = ?, managed_node_id = ? WHERE telegram_id = ?")
          .bind(state, managedNodeId, telegramId)
          .run();
      } else {
        await env.DB.prepare("UPDATE users SET bot_state = ? WHERE telegram_id = ?")
          .bind(state, telegramId)
          .run();
      }
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

    async function renderFolderView(ctx: any, user: UserRow, nodeId: number | null) {
      const children = await getChildNodes(nodeId);
      const materials = nodeId ? await getNodeMaterials(nodeId) : [];
      const isManager = await canManage(user, nodeId);
      const privileged = isPrivileged(user);

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
          .row();
      } else if (isManager && nodeId === null) {
        keyboard
          .text("➕ إضافة قسم جديد")
          .text("📐 تخصيص العرض والصفوف")
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
      await updateUserState(user.telegram_id, "browsing", null);
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
        .text("➕ تعيين ليدر جديد", "admin_add_leader")
        .row()
        .text("❌ إغلاق", "close_admin");

      const messageText =
        `👑 **لوحة تحكم المسؤول العام (Super Admin):**\n\n` +
        `• يمكنك تعيين ليدرز وتحديد الأقسام المسموح لكل ليدر بإدارتها.\n` +
        `• ليدر قسم معين يمكنه إضافة وحذف وتعديل محتوى هذا القسم فقط دون التأثير على باقي الأقسام.\n\n` +
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
        await env.DB.prepare("INSERT INTO users (telegram_id, full_name, role, bot_state, view_mode) VALUES (?, ?, 'leader', 'browsing', 'admin')")
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
        if (text === "❌ إلغاء" || text === "⬅️ رجوع" || text === "🏠 الرئيسية" || text === "إلغاء") {
          await updateUserState(user.telegram_id, "browsing");
          user.bot_state = "browsing";
          await ctx.reply("تم إلغاء التعيين.");
          await renderFolderView(ctx, user, user.current_node_id);
          return;
        }

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
          await env.DB.prepare("INSERT INTO users (telegram_id, full_name, role, bot_state, view_mode) VALUES (?, ?, 'leader', 'browsing', 'admin')")
            .bind(targetId, targetName || `User ${targetId}`)
            .run();
        } else {
          await env.DB.prepare("UPDATE users SET role = 'leader', full_name = COALESCE(?, full_name) WHERE telegram_id = ?")
            .bind(targetName, targetId)
            .run();
        }

        await updateUserState(user.telegram_id, "browsing");
        user.bot_state = "browsing";

        await ctx.reply(`✅ تم تعيين المستخدم (${targetId}) كليدر بنجاح.\nحدد الآن الأقسام المسموح له بإدارتها 👇`);
        await renderLeaderPermissions(ctx, targetId);
        return;
      }

      // State: UPLOADING (Batch File Upload)
      if (user.bot_state === "uploading") {
        if (text === "✅ إنهاء الحفظ" || text === "إنهاء الحفظ") {
          await updateUserState(user.telegram_id, "browsing");
          user.bot_state = "browsing";
          await ctx.reply("✅ تم حفظ كافة الملفات بنجاح.");
          await renderFolderView(ctx, user, user.current_node_id);
          return;
        }

        let fileId: string | null = null;
        let fileName: string = "Unnamed File";
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
          // Auto backup to private channel
          let backupMsgId: number | null = null;
          const backupChannelId = await getBackupChannelId();
          if (backupChannelId) {
            try {
              const res = await ctx.api.copyMessage(backupChannelId, ctx.chat.id, ctx.message.message_id, {
                caption: `📄 الملف: ${fileName}`,
              });
              if (res?.message_id) {
                backupMsgId = res.message_id;
              }
            } catch (e) {
              try {
                const res = await ctx.forwardMessage(backupChannelId);
                if (res?.message_id) {
                  backupMsgId = res.message_id;
                }
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
        if (text === "❌ إلغاء" || text === "⬅️ رجوع" || text === "🏠 الرئيسية" || text === "إلغاء") {
          await updateUserState(user.telegram_id, "browsing", user.current_node_id, null);
          user.bot_state = "browsing";
          await ctx.reply("تم إلغاء التعديل والاحتفاظ بالاسم السابق.");
          await renderFolderView(ctx, user, user.current_node_id);
          return;
        }

        if (text && user.managed_node_id) {
          const targetNode: NodeRow | null = await env.DB.prepare("SELECT * FROM nodes WHERE id = ?")
            .bind(user.managed_node_id)
            .first<NodeRow>();
          const oldTitle = targetNode?.title || "";

          await env.DB.prepare("UPDATE nodes SET title = ? WHERE id = ?")
            .bind(text, user.managed_node_id)
            .run();

          await updateUserState(user.telegram_id, "browsing", user.current_node_id, null);
          user.bot_state = "browsing";
          await ctx.reply(`✅ تم تعديل الاسم بنجاح:\nمن: **${oldTitle}**\nإلى: **${text}**`, { parse_mode: "Markdown" });
          await renderFolderView(ctx, user, user.current_node_id);
          return;
        }
      }

      // State: AWAITING FOLDER NAME
      if (user.bot_state === "awaiting_folder") {
        if (text === "❌ إلغاء" || text === "⬅️ رجوع" || text === "🏠 الرئيسية" || text === "إلغاء") {
          await updateUserState(user.telegram_id, "browsing");
          user.bot_state = "browsing";
          await ctx.reply("تم إلغاء الإضافة.");
          await renderFolderView(ctx, user, user.current_node_id);
          return;
        }

        if (text) {
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
            .bind(user.current_node_id, text, user.telegram_id, isFull, nextSortOrder)
            .run();

          await updateUserState(user.telegram_id, "browsing");
          user.bot_state = "browsing";
          await ctx.reply(`✅ تم إنشاء الخانة الجديدة: **${text}**`, { parse_mode: "Markdown" });
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
        await updateUserState(user.telegram_id, "browsing", parentId);
        user.current_node_id = parentId;
        user.bot_state = "browsing";
        if (parentId === null && isPrivileged(user)) {
          await renderTopLevel(ctx, user);
        } else {
          await renderFolderView(ctx, user, parentId);
        }
        return;
      }

      // Feature: Download / Show All Content Recursively
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

      // Admin Actions
      if (text === "📤 رفع ملفات هنا" && (await canManage(user, user.current_node_id))) {
        if (!user.current_node_id) {
          return ctx.reply("❌ لا يمكن رفع ملفات في الصفحة الرئيسية، يرجى الدخول لمادة أو خانة أولاً.");
        }
        await updateUserState(user.telegram_id, "uploading");
        const uploadKeyboard = new Keyboard().text("✅ إنهاء الحفظ").resized();
        await ctx.reply(
          `📤 **وضع الرفع نشط الآن:**\n\nقم بإرسال أو تحويل (Forward) كل ملفات الـ PDF أو الفيديوهات أو الصور هنا دفعة واحدة.\n\nوعند الانتهاء اضغط زر **[✅ إنهاء الحفظ]**.`,
          { parse_mode: "Markdown", reply_markup: uploadKeyboard }
        );
        return;
      }

      if ((text === "➕ إضافة خانة/مادة" || text === "➕ إضافة قسم جديد") && (await canManage(user, user.current_node_id))) {
        await updateUserState(user.telegram_id, "awaiting_folder");
        const cancelKeyboard = new Keyboard().text("❌ إلغاء").resized();
        await ctx.reply("✍️ أرسل الآن اسم المادة أو الخانة الجديدة:", {
          reply_markup: cancelKeyboard,
        });
        return;
      }

      if (text === "📐 تخصيص العرض والصفوف" && (await canManage(user, user.current_node_id))) {
        const children = await getChildNodes(user.current_node_id);
        if (children.length === 0) {
          return ctx.reply("لا توجد أزرار لتخصيص عرضها في هذا المجلد.");
        }

        const inlineKeyboard = buildWidthCustomizationKeyboard(children, user.current_node_id !== null);
        await ctx.reply(
          `📐 **تخصيص العرض والصفوف للأزرار:**\n\n` +
            `اضغط على أي زر لتغيير نمط عرضه محلياً بين (صف كامل ↔️ صف مزدوج).\n\n` +
            `أو اضغط خيارات التعميم لنقل التنسيق لباقي المواد.`,
          { parse_mode: "Markdown", reply_markup: inlineKeyboard }
        );
        return;
      }

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

      if (text?.startsWith("📥 إرسال الملفات") && user.current_node_id) {
        const materials = await getNodeMaterials(user.current_node_id);
        if (materials.length > 0) {
          await sendBatchMaterials(ctx, materials);
        } else {
          await ctx.reply("لا توجد ملفات في هذه الخانة بعد.");
        }
        return;
      }

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
          await updateUserState(user.telegram_id, "browsing", childNode.id);
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

      if (data === "close_admin" || data === "close_customization" || data === "close_rename") {
        await ctx.deleteMessage();
        return;
      }

      if (data === "close_delete") {
        await ctx.deleteMessage();
        await renderFolderView(ctx, user, user.current_node_id);
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
        await updateUserState(user.telegram_id, "awaiting_leader_id");
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

        await updateUserState(user.telegram_id, "renaming", user.current_node_id, nodeId);
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
