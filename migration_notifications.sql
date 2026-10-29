-- 1. Add department subscription columns to existing users table
ALTER TABLE users ADD COLUMN subscribed_dept_id INTEGER DEFAULT NULL;
ALTER TABLE users ADD COLUMN notifications_enabled INTEGER DEFAULT 1;

-- 2. Create Broadcast Queue table for safe chunked delivery
CREATE TABLE IF NOT EXISTS broadcast_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dept_node_id INTEGER NOT NULL,          -- Target department node_id
  dept_title TEXT NOT NULL,                -- Department name for reporting
  sender_id INTEGER NOT NULL,              -- Admin/Leader telegram_id
  from_chat_id INTEGER NOT NULL,           -- Chat ID where the broadcast message originated
  message_id INTEGER NOT NULL,             -- Message ID to copy via copyMessage (supports text, PDF, video, photo)
  last_user_id INTEGER DEFAULT 0,          -- Cursor tracking last student telegram_id reached
  sent_count INTEGER DEFAULT 0,            -- Total successful deliveries
  failed_count INTEGER DEFAULT 0,          -- Blocked/deactivated accounts skipped
  status TEXT DEFAULT 'pending',           -- 'pending' | 'completed' | 'cancelled'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (dept_node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- 3. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_nodes_parent_order ON nodes(parent_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_materials_node ON materials(node_id);
CREATE INDEX IF NOT EXISTS idx_users_sub ON users(subscribed_dept_id, notifications_enabled, telegram_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_status ON broadcast_jobs(status, id);
