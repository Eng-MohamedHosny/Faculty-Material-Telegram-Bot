-- 1. Users, Leaders & Navigation State Table
CREATE TABLE IF NOT EXISTS users (
  telegram_id INTEGER PRIMARY KEY,
  full_name TEXT,
  role TEXT DEFAULT 'student',             -- 'student' | 'leader' | 'super_admin'
  managed_node_id INTEGER DEFAULT NULL,   -- Scope node ID for leader (NULL = full access)
  current_node_id INTEGER DEFAULT NULL,   -- Current folder ID for accurate Back navigation
  bot_state TEXT DEFAULT 'browsing',      -- 'browsing' | 'awaiting_folder' | 'uploading' | 'renaming' | 'awaiting_leader_id' | 'awaiting_broadcast' | 'awaiting_admin_broadcast' | 'awaiting_task_title' | 'awaiting_task_due' | 'awaiting_task_attachment' | 'awaiting_submission_folder'
  view_mode TEXT DEFAULT 'admin',         -- 'admin' | 'student'
  subscribed_dept_id INTEGER DEFAULT NULL,-- Subscribed department node_id (e.g. 1=CS, 2=IS, 3=IT, 4=Networks)
  notifications_enabled INTEGER DEFAULT 1,-- 1 = Subscribed, 0 = Muted
  pending_target_id INTEGER DEFAULT NULL  -- Temporary node/job pointer for multi-step prompts
);

-- 2. Dynamic Hierarchy Tree Table
CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER DEFAULT NULL,         -- Parent folder ID (NULL for root departments)
  title TEXT NOT NULL,                    -- Button label
  sort_order INTEGER DEFAULT 0,           -- Display order in keyboard
  created_by INTEGER,
  is_full_width INTEGER DEFAULT 0,        -- 1 = Full-width row, 0 = Dual-column row
  FOREIGN KEY (parent_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- 3. Academic Materials & Telegram File IDs Table
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id INTEGER NOT NULL,               -- Parent section/folder ID
  file_name TEXT NOT NULL,                -- Original filename
  telegram_file_id TEXT NOT NULL,         -- Permanent file_id on Telegram servers
  file_type TEXT NOT NULL,                -- 'document' | 'video' | 'photo' | 'audio' | 'link'
  caption TEXT DEFAULT NULL,
  uploaded_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  backup_message_id INTEGER DEFAULT NULL, -- Message ID in backup channel for auto-deletion
  FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- 4. User Department Permissions Table (RBAC)
CREATE TABLE IF NOT EXISTS user_permissions (
  telegram_id INTEGER NOT NULL,
  node_id INTEGER NOT NULL,
  PRIMARY KEY (telegram_id, node_id)
);

-- 5. Broadcast Jobs Queue for Department & Admin Notifications
CREATE TABLE IF NOT EXISTS broadcast_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL DEFAULT 'department', -- 'department' | 'all_admins'
  dept_node_id INTEGER DEFAULT NULL,      -- Target department node_id (NULL for all_admins)
  dept_title TEXT NOT NULL,                -- Department name / broadcast title for reporting
  sender_id INTEGER NOT NULL,              -- Admin/Leader telegram_id
  from_chat_id INTEGER NOT NULL,           -- Chat ID where the broadcast message originated
  message_id INTEGER NOT NULL,             -- Message ID to copy via copyMessage (supports text, PDF, video, photo)
  last_user_id INTEGER DEFAULT 0,          -- Cursor tracking last student telegram_id reached
  sent_count INTEGER DEFAULT 0,            -- Total successful deliveries
  failed_count INTEGER DEFAULT 0,          -- Blocked/deactivated accounts skipped
  status TEXT DEFAULT 'pending',           -- 'pending' | 'processing' | 'completed' | 'cancelled'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. Student Submissions Queue Table (Silent Moderation)
CREATE TABLE IF NOT EXISTS submissions (
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
CREATE TABLE IF NOT EXISTS weekly_tasks (
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

-- 8. System Settings
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- 9. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_nodes_parent_order ON nodes(parent_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_materials_node ON materials(node_id);
CREATE INDEX IF NOT EXISTS idx_users_sub ON users(subscribed_dept_id, notifications_enabled, telegram_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_status ON broadcast_jobs(status, id);
CREATE INDEX IF NOT EXISTS idx_submissions_course ON submissions(course_node_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_dept_due ON weekly_tasks(dept_node_id, due_date);
