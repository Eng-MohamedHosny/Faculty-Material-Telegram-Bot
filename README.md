<div align="center">

# 🎓 Faculty Material Telegram Bot (FCAI Bot)
**A high-performance, zero-cost, serverless Telegram bot for university academic content distribution.**  
Engineered on an **Edge Serverless Architecture** (Cloudflare Workers + D1 SQLite + grammY) with zero cold-starts, zero server disk usage, fine-grained Role-Based Access Control (RBAC), and full in-chat management capabilities for leaders and administrators.

<br/>

[![Arabic Documentation](https://img.shields.io/badge/Language-Arabic%20Version%20(النسخة%20العربية)-green?style=for-the-badge&logo=telegram)](./README.ar.md)
[![PDF Documentation](https://img.shields.io/badge/Documentation-PDF%20Guide-red?style=for-the-badge&logo=adobeacrobatreader)](./Faculty_Material_Telegram_Bot_Documentation.pdf)
[![Admin Commands](https://img.shields.io/badge/Commands-Admin%20Guide-blue?style=for-the-badge&logo=readme)](./ADMIN_COMMANDS.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](./LICENSE)

</div>

---

## 🌟 Key Features

### 1. 100% Free Serverless Edge Architecture (Zero Cold-Start)
- **Cloudflare Workers:** Event-driven Webhooks running at edge nodes worldwide with instantaneous startup time (0ms cold start) and no sleep mode.
- **Cloudflare D1 (Edge SQLite):** Sub-millisecond SQL queries with 5GB free storage, 5M reads/day, and 100k writes/day.
- **Infinite Cloud Storage via Telegram Servers:** All PDFs, photos, and videos reside on Telegram's cloud infrastructure via permanent `file_id` strings and an automated private backup archive channel, using **0MB of server disk space**.

### 2. Fully Dynamic Hierarchy Tree (No Hardcoding)
- Scalable database tree structure allowing unlimited nesting without touching code:  
  **Departments (CS, IT, IS, Networks) ➡️ Semesters (Term 1, Term 2) ➡️ Courses ➡️ 5 Standard Categories ➡️ Lectures & Labs ➡️ Files**.
- Standardized academic categories:
  - 📂 **Lectures** (Full-width row)
  - 📝 **Sections & Labs** | 📖 **Summaries & Revision** (Dual-column row)
  - 📅 **Midterms & Quizzes** | 📋 **Final Exams** (Dual-column row)

### 3. Fine-Grained Role-Based Access Control (RBAC)
- **Super Admin:** Global authority across all college departments, channel archiving, and interactive leader permission management.
- **Department Leaders:** Delegated by the Super Admin to specific departments (e.g., Leader A manages CS only; Leader B manages IS and IT):
  - Inside assigned departments: Full management toolbar (Batch Upload, Create Course/Folder, Rename, Layout Customization, Multi-Delete).
  - Outside assigned departments: Automatically treated as a **standard student** with zero management clutter.
- **Students:** Ultra-fast, clean browsing experience with zero admin buttons or notifications.

### 4. Dual View Mode (Student vs. Admin)
- Privileged users (Admins & Leaders) can toggle on-demand between **`🎓 Student Mode`** (to experience the clean view as students see it) and **`⚙️ Admin Mode`** (to reveal editing and management controls).
- **Smart Leaf Delivery:** When students click on a final lecture or lab node, the bot directly delivers all files in a media group without navigating into empty or blank sub-screens.

### 5. Advanced In-Telegram Management Tools
- **Silent Batch Uploading:** Forward or upload 10, 20, or 50 files/images at once without spammy bot confirmations. Files are quietly saved, backed up to the private channel, and summarized with one confirmation upon pressing `[✅ Finish Upload]`.
- **Ultra-Fast Optimistic Multi-Delete:** The delete keyboard remains open to delete multiple items consecutively. Buttons disappear in <50ms (in-memory optimistic update) while the database deletion and backup channel message deletion happen concurrently in the background.
- **Button Layout Customization:** Toggle any menu button between full width (🔘) and dual column (👥), with a one-click option to propagate the layout across the department or the whole college.
- **One-Click Material Downloader:** A `📦 Download All Content` button recursively aggregates and sends all course materials categorized by chapter.

### 6. Department Broadcast & Safe Notification System (v2.0)
- **Student Subscription Settings:** Dedicated root menu button (`🔔 إعدادات الإشعارات واشتراك القسم` or `/notifications`) allowing students to subscribe to their specific academic department (CS, IT, IS, Networks) and toggle notifications on/off.
- **Safe Chunked Background Broadcast Queue:** Outbound notifications are routed through the `broadcast_jobs` table and processed asynchronously via Cloudflare Workers Cron Trigger (`* * * * *`) at 35 students per minute/invocation. This strictly satisfies Cloudflare Free Tier subrequest limitations (maximum 50 subrequests) and Telegram's 30 msgs/sec rate limits.
- **Auto-Muting Blocked Accounts:** Gracefully catches Telegram 403 errors (when a user blocks the bot or deactivates their account) and immediately sets `notifications_enabled = 0`, eliminating wasted worker quota.
- **In-Chat Leader Broadcast:** Department leaders have a `📢 إرسال إشعار للقسم` button inside their assigned department folders to compose and blast announcements, texts, images, or PDFs to all enrolled students.
- **1-Click Post-Upload Notification:** Upon completing a batch upload session (`[✅ إنهاء الحفظ]`), leaders receive a 1-click prompt `[🔔 إرسال تنبيه لطلاب القسم بالملفات الجديدة]` to notify department students of the newly published materials.

### 7. Crowdsourced Student Notes with Silent Moderation (v2.1)
- **Student Contribution Flow:** Inside any course menu, students see a `[📝 ساهم بملخص أو امتحان]` button to submit PDFs, summaries, or past exams. Upon submission, the student receives instant gratitude (`❤️ شكراً لمساهمتك الجميلة!`).
- **Silent Leader Moderation:** The contribution is delivered directly to course leaders with moderation buttons: `[✅ قبول واختيار الفولدر]` and `[🗑️ تجاهل وحذف بصمت]`.
- **Zero-Embarrassment Rejection:** If ignored, the submission card disappears silently and the record is marked `ignored` without notifying the student.
- **Dynamic Placement or New Folder Creation:** Leaders can place approved notes into existing folders (e.g. Lectures, Summaries) or create a new custom folder on the fly.

### 8. Weekly Tasks & Automatic Deadlines Clearing (v2.1)
- **Student Dashboard:** Root menu button `[📅 تاسكات وتسليمات الأسبوع الحالي]` or `/tasks` presents a prioritized card list of upcoming sheets, assignments, and quizzes due within 7 days.
- **1-Click Sheet Downloader:** Each task includes an inline button to download the attached assignment sheet directly.
- **Automatic Expiration Cleaning:** Using SQLite `due_date >= datetime('now')`, completed deadlines automatically disappear without manual leader intervention.
- **Leader Task Publishing:** Leaders can create new tasks with title, deadline days, and optional PDF/photo attachment in seconds.

### 9. Dual Analytics Dashboard (Super Admin vs. Leader) (v2.1)
- **Super Admin Overview:** Command `/stats` or button in `/admin` displays college-wide user metrics, notification adoption rates, per-department student and material counts, and an automatic gap detector highlighting empty courses that have zero materials.
- **Scoped Leader Stats:** Leaders view department-specific metrics: subscribed student count, active tasks, and count of pending student submissions awaiting review.

### 10. Robust Input Validation & State Machine Guards (v2.1)
- 3-tier defense preventing accidental folder renaming to navigation keywords (e.g., "رجوع") and preventing sibling name duplication at the same tree level.

---

## 🏗️ System Architecture

```
                     +---------------------------------------+
                     |         Telegram Messenger            |
                     |  Students / Leaders / Super Admin     |
                     +-------------------+-------------------+
                                         |  HTTPS Webhook & Cron (* * * * *)
                                         v
                     +---------------------------------------+
                     |       Cloudflare Workers (Edge)       |
                     |       Framework: grammY (TS)          |
                     |  - Routing & Navigation State Machine |
                     |  - Role-Based Access Control (RBAC)   |
                     |  - Instant Optimistic UI Handlers     |
                     |  - Scheduled Broadcast Queue Worker   |
                     |  - Crowdsource Moderation Flow        |
                     |  - Tasks Deadlines Auto-Cleaner       |
                     +---------+-------------------+---------+
                               |                   |
            Fast SQL Queries   |                   | Telegram API Calls
                               v                   v
            +----------------------+     +----------------------------+
            | Cloudflare D1        |     | Telegram Cloud Servers     |
            | (Edge SQLite)        |     | - Permanent File IDs       |
            | - users              |     | - Backup Archive Channel   |
            | - nodes              |     | - Batch Media Grouping     |
            | - materials          |     | - Safe copyMessage Queue   |
            | - user_permissions   |     | - Student Submissions      |
            | - broadcast_jobs     |     +----------------------------+
            | - submissions        |
            | - weekly_tasks       |
            | - settings           |
            +----------------------+
```

---

## 🗄️ Database Schema (SQLite / D1)

```sql
-- 1. Users, Navigation State, View Modes & Notifications
CREATE TABLE users (
  telegram_id INTEGER PRIMARY KEY,
  full_name TEXT,
  role TEXT DEFAULT 'student',            -- 'student' | 'leader' | 'super_admin'
  managed_node_id INTEGER DEFAULT NULL,
  current_node_id INTEGER DEFAULT NULL,  -- Current folder ID for accurate Back navigation
  bot_state TEXT DEFAULT 'browsing',     -- 'browsing' | 'uploading' | 'renaming' | 'awaiting_folder' | 'awaiting_leader_id' | 'awaiting_broadcast' | 'awaiting_admin_broadcast' | 'awaiting_submission' | 'awaiting_task_title'
  view_mode TEXT DEFAULT 'admin',        -- 'admin' | 'student'
  subscribed_dept_id INTEGER DEFAULT NULL,-- Subscribed root department ID for notifications
  notifications_enabled INTEGER DEFAULT 1,-- 1: Active | 0: Muted / blocked
  pending_target_id INTEGER DEFAULT NULL  -- Temporary node/job pointer
);

-- 2. Dynamic Hierarchy Tree (Departments, Semesters, Courses, Sections)
CREATE TABLE nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER DEFAULT NULL,        -- Parent folder ID (NULL for root departments)
  title TEXT NOT NULL,                   -- Button label shown to users
  sort_order INTEGER DEFAULT 0,          -- Display order in keyboard
  created_by INTEGER,
  is_full_width INTEGER DEFAULT 0,       -- 1: Full-width row | 0: Dual-column row
  FOREIGN KEY (parent_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- 3. Uploaded Academic Materials & Telegram Permanent File IDs
CREATE TABLE materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id INTEGER NOT NULL,              -- Parent section/folder ID
  file_name TEXT NOT NULL,               -- Original file name
  telegram_file_id TEXT NOT NULL,        -- Telegram permanent file_id
  file_type TEXT NOT NULL,               -- 'document' | 'video' | 'photo' | 'audio'
  caption TEXT DEFAULT NULL,
  uploaded_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  backup_message_id INTEGER DEFAULT NULL,-- Message ID in backup channel for auto-deletion
  FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- 4. Leader Department Permissions (RBAC)
CREATE TABLE user_permissions (
  telegram_id INTEGER NOT NULL,
  node_id INTEGER NOT NULL,              -- Department node ID granted
  PRIMARY KEY (telegram_id, node_id)
);

-- 5. Broadcast Jobs Queue (Cloudflare Cron Triggers)
CREATE TABLE broadcast_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL DEFAULT 'department', -- 'department' | 'all_admins'
  dept_node_id INTEGER DEFAULT NULL,
  dept_title TEXT NOT NULL,
  sender_id INTEGER NOT NULL,
  from_chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  last_user_id INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',          -- 'pending' | 'processing' | 'completed' | 'cancelled'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. Student Submissions Queue Table (Silent Moderation)
CREATE TABLE submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_node_id INTEGER NOT NULL,        -- Course node ID where student contributed
  student_id INTEGER NOT NULL,
  student_name TEXT,
  file_name TEXT NOT NULL,
  telegram_file_id TEXT NOT NULL,
  file_type TEXT NOT NULL,                -- 'document' | 'photo' | 'video'
  caption TEXT DEFAULT NULL,
  backup_message_id INTEGER DEFAULT NULL,
  status TEXT DEFAULT 'pending',          -- 'pending' | 'approved' | 'ignored'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (course_node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- 7. Weekly Tasks & Deadlines Table
CREATE TABLE weekly_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dept_node_id INTEGER NOT NULL,          -- Department ID (CS, IT, IS, Networks)
  course_title TEXT NOT NULL,
  task_title TEXT NOT NULL,
  due_date DATETIME NOT NULL,             -- Auto-hides once current time passes due_date
  attachment_file_id TEXT DEFAULT NULL,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (dept_node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- 8. System Settings & Archive Channel
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX idx_nodes_parent_order ON nodes(parent_id, sort_order);
CREATE INDEX idx_materials_node ON materials(node_id);
CREATE INDEX idx_users_sub ON users(subscribed_dept_id, notifications_enabled, telegram_id);
CREATE INDEX idx_broadcast_status ON broadcast_jobs(status, id);
CREATE INDEX idx_submissions_course ON submissions(course_node_id, status);
CREATE INDEX idx_tasks_dept_due ON weekly_tasks(dept_node_id, due_date);
```

---

## 🚀 Step-by-Step Setup & Deployment Guide

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or later).
- A free [Cloudflare Account](https://dash.cloudflare.com/).
- A Telegram account to create the bot.

### Step 1: Create the Telegram Bot & Backup Channel
1. Open Telegram and search for [@BotFather](https://t.me/BotFather).
2. Send `/newbot`, choose a name and username, and copy your **Bot Token**.
3. Create a **Private Telegram Channel** named `Bot Files Archive`.
4. Add your bot as an **Administrator** in the channel with permissions to *Post* and *Delete* messages.
5. Retrieve your numeric Telegram ID by typing `/id` in the bot after deployment, or via [@userinfobot](https://t.me/userinfobot).

### Step 2: Clone & Install Dependencies
```bash
git clone https://github.com/Eng-MohamedHosny/Faculty-Material-Telegram-Bot.git
cd Faculty-Material-Telegram-Bot
npm install
npx wrangler login
```

### Step 3: Create Cloudflare D1 Database
```bash
npx wrangler d1 create college_bot_db
```
- Copy the generated `database_id` into your `wrangler.toml` file:
```toml
name = "faculty-telegram-bot"
main = "src/index.ts"
compatibility_date = "2024-10-01"
compatibility_flags = ["nodejs_compat"]

[vars]
SUPER_ADMIN_ID = "YOUR_TELEGRAM_ID"
BACKUP_CHANNEL_ID = "-100XXXXXXXXXX"

[[d1_databases]]
binding = "DB"
database_name = "college_bot_db"
database_id = "YOUR_DATABASE_ID"
```

### Step 4: Execute Database Schema & Seed Data
```bash
# Initialize database tables
npx wrangler d1 execute college_bot_db --remote --file=./schema.sql

# Seed 4th year departments & CS Semester 1 courses
npx wrangler d1 execute college_bot_db --remote --file=./seed_all_departments.sql
npx wrangler d1 execute college_bot_db --remote --file=./seed_cs_term1.sql
```

### Step 5: Configure Secret & Deploy
```bash
# Securely store your bot token in Cloudflare Secrets
npx wrangler secret put BOT_TOKEN

# Deploy the worker to the Cloudflare Edge network
npx wrangler deploy
```

### Step 6: Activate Webhook
Upon deployment, copy your Worker URL (e.g., `https://faculty-telegram-bot.yourname.workers.dev`) and register it with Telegram by visiting:
```text
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://faculty-telegram-bot.yourname.workers.dev
```

### Step 7: Register Telegram Commands Menu
Run the local script to register localized commands with custom scopes:
```bash
BOT_TOKEN="your_token" SUPER_ADMIN_ID="your_id" node scripts/set_commands.js
```

---

## 📋 Command Reference

| Command | Description | Access Scope |
| :--- | :--- | :--- |
| `/start` | 🏠 Open main menu and toggle Student/Admin mode | Public (All users) |
| `/tasks` | 📅 View weekly tasks, assignment sheets & deadlines | Public (All users) |
| `/notifications` | 🔔 Student department subscription and alert settings | Public (All users) |
| `/id` | 🆔 Display and tap-to-copy your numeric Telegram ID | Public (All users) |
| `/admin` | 👑 Open Super Admin Dashboard (channel status, leader list) | Super Admin Only 🔒 |
| `/stats` | 📊 Comprehensive Dual Analytics (Overview & Empty Courses) | Super Admin & Leaders 🔒 |
| `/notify_admins` | 📢 Instant broadcast to all leaders and admins | Super Admin Only 🔒 |
| `/leaders` | 👥 Manage assigned department scopes per leader | Super Admin Only 🔒 |
| `/promote <ID>` | ➕ Promote user to Leader and assign department scopes | Super Admin Only 🔒 |
| `/demote <ID>` | 🗑️ Revoke leadership and delete all assigned permissions | Super Admin Only 🔒 |

> **Security Note:** Thanks to Telegram's Scoped Commands API, administrative commands (`/admin`, `/leaders`, `/promote`, `/demote`) are visible exclusively to the Super Admin when typing `/`.

---

## 📂 Project Structure

```
Faculty-Material-Telegram-Bot/
├── src/
│   └── index.ts                 # Main bot routing, state machine, and edge handlers
├── scripts/
│   ├── set_commands.js          # Telegram Scoped Commands registration script (UTF-8)
│   └── sync_gdrive.mjs          # Google Drive material syncing utility
├── docs/
│   └── faculty_bot_guide.html   # Source HTML for the documentation PDF
├── schema.sql                   # Database schema definition (Cloudflare D1 SQLite)
├── seed_all_departments.sql     # Seed script for 4 college departments & terms
├── seed_cs_term1.sql            # Seed script for CS 1st semester courses & categories
├── ADMIN_COMMANDS.md            # Arabic administrative operations guide
├── README.md                    # Primary English documentation
├── README.ar.md                 # Full Arabic documentation
├── Faculty_Material_Telegram_Bot_Documentation.pdf # Architecture & setup PDF manual
├── package.json                 # Node dependencies and project scripts
├── tsconfig.json                # TypeScript compiler configuration
└── wrangler.toml.example        # Configuration template for Cloudflare Workers & D1
```

---

## 📄 License
This project is open-source under the MIT License. Developed to serve and empower university computer science and artificial intelligence students.
