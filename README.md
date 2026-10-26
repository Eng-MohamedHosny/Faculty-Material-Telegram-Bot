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

---

## 🏗️ System Architecture

```
                     +---------------------------------------+
                     |         Telegram Messenger            |
                     |  Students / Leaders / Super Admin     |
                     +-------------------+-------------------+
                                         |  HTTPS Webhook
                                         v
                     +---------------------------------------+
                     |       Cloudflare Workers (Edge)       |
                     |       Framework: grammY (TS)          |
                     |  - Routing & Navigation State Machine |
                     |  - Role-Based Access Control (RBAC)   |
                     |  - Instant Optimistic UI Handlers     |
                     +---------+-------------------+---------+
                               |                   |
            Fast SQL Queries   |                   | Telegram API Calls
                               v                   v
            +----------------------+     +----------------------------+
            | Cloudflare D1        |     | Telegram Cloud Servers     |
            | (Edge SQLite)        |     | - Permanent File IDs       |
            | - users              |     | - Backup Archive Channel   |
            | - nodes              |     | - Batch Media Grouping     |
            | - materials          |     +----------------------------+
            | - user_permissions   |
            | - settings           |
            +----------------------+
```

---

## 🗄️ Database Schema (SQLite / D1)

```sql
-- 1. Users, Navigation State & View Modes
CREATE TABLE users (
  telegram_id INTEGER PRIMARY KEY,
  full_name TEXT,
  role TEXT DEFAULT 'student',            -- 'student' | 'leader' | 'super_admin'
  managed_node_id INTEGER DEFAULT NULL,
  current_node_id INTEGER DEFAULT NULL,  -- Current folder ID for accurate Back navigation
  bot_state TEXT DEFAULT 'browsing',     -- 'browsing' | 'uploading' | 'renaming' | 'awaiting_folder' | 'awaiting_leader_id'
  view_mode TEXT DEFAULT 'admin'         -- 'admin' | 'student'
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

-- 5. System Settings & Archive Channel
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX idx_nodes_parent ON nodes(parent_id);
CREATE INDEX idx_materials_node ON materials(node_id);
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
| `/id` | 🆔 Display and tap-to-copy your numeric Telegram ID | Public (All users) |
| `/admin` | 👑 Open Super Admin Dashboard (channel status, leader list) | Super Admin Only 🔒 |
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
