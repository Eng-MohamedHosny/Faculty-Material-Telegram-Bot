export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  SUPER_ADMIN_ID?: string;
  BACKUP_CHANNEL_ID?: string;
}

export interface UserRow {
  telegram_id: number;
  full_name: string | null;
  role: "student" | "leader" | "super_admin";
  view_mode: "admin" | "student";
  managed_node_id: number | null;
  current_node_id: number | null;
  bot_state:
    | "browsing"
    | "awaiting_folder"
    | "uploading"
    | "renaming"
    | "deleting"
    | "awaiting_leader_id"
    | "awaiting_broadcast"
    | "awaiting_admin_broadcast"
    | "awaiting_submission"
    | "awaiting_submission_folder"
    | "awaiting_task_title"
    | "awaiting_task_days"
    | "awaiting_task_attachment"
    | "awaiting_edit_task_title"
    | "awaiting_edit_task_days"
    | "awaiting_edit_task_file";
  subscribed_dept_id: number | null;
  notifications_enabled: number;
  pending_target_id: number | null;
}

export interface NodeRow {
  id: number;
  parent_id: number | null;
  title: string;
  sort_order: number;
  created_by: number | null;
  is_full_width: number;
}

export interface MaterialRow {
  id: number;
  node_id: number;
  file_name: string;
  telegram_file_id: string;
  file_type: "document" | "video" | "photo" | "audio" | "link" | "text";
  caption: string | null;
  uploaded_by: number | null;
  created_at: string;
  backup_message_id?: number | null;
}

export interface FolderWithMaterials {
  folderPath: string;
  materials: MaterialRow[];
}

export interface BroadcastJobRow {
  id: number;
  target_type: "department" | "all_admins";
  dept_node_id: number | null;
  dept_title: string;
  sender_id: number;
  from_chat_id: number;
  message_id: number;
  last_user_id: number;
  sent_count: number;
  failed_count: number;
  status: "pending" | "processing" | "completed" | "cancelled";
  created_at: string;
}

export interface SubmissionRow {
  id: number;
  course_node_id: number;
  student_id: number;
  student_name: string | null;
  file_name: string;
  telegram_file_id: string;
  file_type: "document" | "photo" | "video" | "audio";
  caption: string | null;
  backup_message_id: number | null;
  status: "pending" | "approved" | "ignored";
  created_at: string;
}

export interface WeeklyTaskRow {
  id: number;
  dept_node_id: number;
  course_title: string;
  task_title: string;
  due_date: string;
  attachment_file_id: string | null;
  attachment_type?: "document" | "photo" | "video" | "audio" | null;
  created_by: number | null;
  created_at: string;
}

// ================= INPUT VALIDATION & SAFE STATE GUARD =================

export const RESERVED_PATTERNS = [
  "Back", "Cancel", "رجوع", "إلغاء", "تم",
  "إضافة", "رفع", "تعديل", "حذف",
  "تخصيص", "تحميل", "عرض وتحميل",
  "الرئيسية", "القائمة", "وضع", "إعدادات", "الإشعارات",
  "تاسكات", "ساهم", "إرسال", "اشتراك", "تخطي", "تغيير القسم"
];

export function isReservedButton(text: string): boolean {
  const clean = text.trim();
  if (!clean || clean.startsWith("/")) return true;
  return RESERVED_PATTERNS.some((pattern) => clean.includes(pattern));
}

export const KEYCAP_NUMS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

export const ARABIC_DAYS = [
  "الأحد",
  "الاثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
];

/**
 * Stores task deadline at the end of the target day in Egypt Time (UTC+2)
 */
export function computeEndOfDayDueDate(daysFromNow: number): string {
  const egyptNowMs = Date.now() + 2 * 60 * 60 * 1000;
  const targetMs = egyptNowMs + daysFromNow * 24 * 60 * 60 * 1000;
  const targetDate = new Date(targetMs);
  const yyyy = targetDate.getUTCFullYear();
  const mm = String(targetDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(targetDate.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} 23:59:59`;
}

/**
 * Formats due_date as: "الثلاثاء 2026-11-03 (الثلاثاء القادم — متبقي 3 أيام)" without hours/seconds
 */
export function formatTaskDeadlineArabic(dueDateStr: string): string {
  const datePart = dueDateStr.trim().split(" ")[0];
  const [yStr, mStr, dStr] = datePart.split("-");
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  const day = parseInt(dStr, 10);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return datePart;

  const dueUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const dayName = ARABIC_DAYS[dueUtc.getUTCDay()];

  const egyptNow = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const todayUtc = new Date(
    Date.UTC(egyptNow.getUTCFullYear(), egyptNow.getUTCMonth(), egyptNow.getUTCDate(), 12, 0, 0)
  );

  const diffDays = Math.round((dueUtc.getTime() - todayUtc.getTime()) / (1000 * 60 * 60 * 24));

  let badge = "";
  if (diffDays <= 0) {
    badge = "اليوم ⚠️ — آخر موعد للتسليم!";
  } else if (diffDays === 1) {
    badge = `غداً ${dayName} ⚠️`;
  } else if (diffDays === 2) {
    badge = `بعد غد ${dayName} 🔔`;
  } else if (diffDays <= 7) {
    badge = `${dayName} القادم — متبقي ${diffDays} أيام`;
  } else if (diffDays <= 10) {
    badge = `متبقي ${diffDays} أيام`;
  } else {
    badge = `متبقي ${diffDays} يوماً`;
  }

  return `${dayName} ${datePart} (${badge})`;
}
