const https = require("https");

const token = process.env.BOT_TOKEN || "YOUR_BOT_TOKEN_HERE";
const superAdminId = parseInt(process.env.SUPER_ADMIN_ID || "0", 10);

function sendPost(payload) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(payload), "utf8");
    const req = https.request({
      hostname: "api.telegram.org",
      port: 443,
      path: `/bot${token}/setMyCommands`,
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": data.length,
      },
    }, (res) => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => resolve(JSON.parse(body)));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  // 1. Default commands for students
  const resDefault = await sendPost({
    commands: [
      { command: "start", description: "🏠 القائمة الرئيسية وتصفح المواد" },
      { command: "notifications", description: "🔔 إعدادات الإشعارات واشتراك القسم" },
      { command: "id", description: "🆔 معرفة Telegram ID الخاص بك" },
    ],
    scope: { type: "default" },
  });
  console.log("Default:", resDefault);

  // 2. Exclusive admin commands for Super Admin chat
  const resAdmin = await sendPost({
    commands: [
      { command: "start", description: "🏠 القائمة الرئيسية وتبديل الوضع" },
      { command: "admin", description: "👑 لوحة تحكم المسؤول العام" },
      { command: "leaders", description: "👥 إدارة الليدرز وتحديد الأقسام" },
      { command: "promote", description: "➕ ترقية ليدر وتعيين أقسامه" },
      { command: "demote", description: "🗑️ سحب رتبة الليدر والصلاحيات" },
      { command: "id", description: "🆔 معرفة Telegram ID الخاص بك" },
    ],
    scope: { type: "chat", chat_id: superAdminId },
  });
  console.log("Admin:", resAdmin);

  // 3. Verify
  https.get(`https://api.telegram.org/bot${token}/getMyCommands?scope=${encodeURIComponent(JSON.stringify({ type: "chat", chat_id: superAdminId }))}`, (res) => {
    let d = "";
    res.on("data", chunk => d += chunk);
    res.on("end", () => console.log("Verified Commands in Telegram:", JSON.parse(d)));
  });
}

main().catch(console.error);
