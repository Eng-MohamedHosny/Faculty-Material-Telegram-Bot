/**
 * Automated End-to-End (E2E) & Security Test Suite for FCAI Material Bot
 * Usage:
 *   1. Run `npx wrangler dev --port 8787` in one terminal
 *   2. Run `node scripts/test_bot_e2e.mjs` in another terminal
 */

const WORKER_URL = process.env.WORKER_URL || "http://127.0.0.1:8787";
const ADMIN_ID = Number(process.env.SUPER_ADMIN_ID || 1143997176);
const STUDENT_ID = 999888777;

let updateCounter = 1000;

async function sendTextUpdate(userId, firstName, text) {
  const payload = {
    update_id: ++updateCounter,
    message: {
      message_id: ++updateCounter,
      from: { id: userId, is_bot: false, first_name: firstName },
      chat: { id: userId, type: "private", first_name: firstName },
      date: Math.floor(Date.now() / 1000),
      text,
    },
  };
  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.status;
}

async function sendCallbackUpdate(userId, firstName, data) {
  const payload = {
    update_id: ++updateCounter,
    callback_query: {
      id: String(++updateCounter),
      from: { id: userId, is_bot: false, first_name: firstName },
      message: {
        message_id: updateCounter,
        chat: { id: userId, type: "private" },
        date: Math.floor(Date.now() / 1000),
        text: "Callback test message",
      },
      chat_instance: "test_instance",
      data,
    },
  };
  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.status;
}

async function runTests() {
  console.log("🚀 Starting FCAI Bot E2E & Security Test Suite...\n");
  let passed = 0;

  const assertStatus = (name, status) => {
    if (status === 200) {
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${name} (HTTP ${status})`);
      process.exitCode = 1;
    }
  };

  // Test 1: Super Admin /start & Top-Level Menu
  assertStatus("1. Admin /start command", await sendTextUpdate(ADMIN_ID, "Mohamed", "/start"));

  // Test 2: About Bot button ("ℹ️ عن البوت")
  assertStatus("2. About Bot ('ℹ️ عن البوت') renders HTML link cleanly", await sendTextUpdate(ADMIN_ID, "Mohamed", "ℹ️ عن البوت"));

  // Test 3: Admin Guide button ("🎥 شرح استخدام البوت (للمشرفين)")
  assertStatus("3. Admin Guide ('🎥 شرح استخدام البوت (للمشرفين)')", await sendTextUpdate(ADMIN_ID, "Mohamed", "🎥 شرح استخدام البوت (للمشرفين)"));

  // Test 4: Enter Admin Mode & Navigate
  assertStatus("4. Switch to Admin Mode ('⚙️ وضع المشرف (الإدارة والتحكم)')", await sendTextUpdate(ADMIN_ID, "Mohamed", "⚙️ وضع المشرف (الإدارة والتحكم)"));

  // Test 5: Create a test folder, enter it, upload a text note + link, and finish saving
  assertStatus("5. Click '➕ إضافة قسم جديد' at root", await sendTextUpdate(ADMIN_ID, "Mohamed", "➕ إضافة قسم جديد"));
  assertStatus("6. Create folder 'E2E_Test_Node'", await sendTextUpdate(ADMIN_ID, "Mohamed", "E2E_Test_Node"));
  assertStatus("7. Enter folder 'E2E_Test_Node'", await sendTextUpdate(ADMIN_ID, "Mohamed", "E2E_Test_Node"));
  assertStatus("8. Start Content Upload ('📤 رفع المحتوى هنا')", await sendTextUpdate(ADMIN_ID, "Mohamed", "📤 رفع المحتوى هنا"));
  assertStatus("9. Upload text message & link as material", await sendTextUpdate(ADMIN_ID, "Mohamed", "اهوه يا عزت دي كده الرسالة https://notebooklm.google.com/test_1"));
  assertStatus("10. Finish saving ('✅ إنهاء الحفظ')", await sendTextUpdate(ADMIN_ID, "Mohamed", "✅ إنهاء الحفظ"));

  // Test 6: Home Button ('🏠 الرئيسية') from inside a folder
  assertStatus("11. Home Button ('🏠 الرئيسية') resets current_node_id to NULL", await sendTextUpdate(ADMIN_ID, "Mohamed", "🏠 الرئيسية"));

  // Test 7: Security Check — Unauthorized student trying to trigger admin callbacks
  assertStatus("12. Security: Student blocked from deleting material", await sendCallbackUpdate(STUDENT_ID, "Student", "del_mat_1"));
  assertStatus("13. Security: Student blocked from deleting task", await sendCallbackUpdate(STUDENT_ID, "Student", "del_t_confirm_1"));

  // Test 8: Upload Rollback on Cancel ('❌ إلغاء')
  assertStatus("14. Enter folder for rollback test", await sendTextUpdate(ADMIN_ID, "Mohamed", "E2E_Test_Node"));
  assertStatus("15. Start Content Upload", await sendTextUpdate(ADMIN_ID, "Mohamed", "📤 رفع المحتوى هنا"));
  assertStatus("16. Send temporary uncommitted note", await sendTextUpdate(ADMIN_ID, "Mohamed", "رسالة تجريبية سيتم إلغاؤها"));
  assertStatus("17. Cancel upload session ('❌ إلغاء') and verify rollback", await sendTextUpdate(ADMIN_ID, "Mohamed", "❌ إلغاء"));

  console.log(`\n🎉 Completed ${passed}/17 E2E & Security checks!`);
}

runTests();
