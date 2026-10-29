-- 1. Upgrade users table for pending state tracking
ALTER TABLE users ADD COLUMN pending_target_id INTEGER DEFAULT NULL;

-- 2. Upgrade broadcast_jobs table for target_type
ALTER TABLE broadcast_jobs ADD COLUMN target_type TEXT NOT NULL DEFAULT 'department';

-- 3. Student Submissions Queue Table (Silent Moderation)
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_node_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  student_name TEXT,
  file_name TEXT NOT NULL,
  telegram_file_id TEXT NOT NULL,
  file_type TEXT NOT NULL,
  caption TEXT DEFAULT NULL,
  backup_message_id INTEGER DEFAULT NULL,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (course_node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- 4. Weekly Tasks & Deadlines Table
CREATE TABLE IF NOT EXISTS weekly_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dept_node_id INTEGER NOT NULL,
  course_title TEXT NOT NULL,
  task_title TEXT NOT NULL,
  due_date DATETIME NOT NULL,
  attachment_file_id TEXT DEFAULT NULL,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (dept_node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- 5. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_submissions_course ON submissions(course_node_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_dept_due ON weekly_tasks(dept_node_id, due_date);
