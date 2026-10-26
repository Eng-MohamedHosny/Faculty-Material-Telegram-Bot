-- 1. Users, Leaders & Navigation State Table
CREATE TABLE IF NOT EXISTS users (
  telegram_id INTEGER PRIMARY KEY,
  full_name TEXT,
  role TEXT DEFAULT 'student', -- 'student' | 'leader' | 'super_admin'
  managed_node_id INTEGER DEFAULT NULL, -- Scope node ID for leader (NULL = full access)
  current_node_id INTEGER DEFAULT NULL, -- Current folder ID for accurate Back navigation
  bot_state TEXT DEFAULT 'browsing' -- 'browsing' | 'awaiting_folder' | 'uploading' | 'renaming'
);

-- 2. Dynamic Hierarchy Tree Table
CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER DEFAULT NULL, -- Parent folder ID (NULL for root)
  title TEXT NOT NULL, -- Button label
  sort_order INTEGER DEFAULT 0, -- Display order in keyboard
  created_by INTEGER,
  FOREIGN KEY (parent_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- 3. Academic Materials & Telegram File IDs Table
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id INTEGER NOT NULL, -- Parent section/folder ID
  file_name TEXT NOT NULL, -- Original filename
  telegram_file_id TEXT NOT NULL, -- Permanent file_id on Telegram servers
  file_type TEXT NOT NULL, -- 'document' | 'video' | 'photo' | 'audio' | 'link'
  caption TEXT DEFAULT NULL,
  uploaded_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  backup_message_id INTEGER DEFAULT NULL, -- Message ID in backup channel
  FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- 4. User Department Permissions Table
CREATE TABLE IF NOT EXISTS user_permissions (
  telegram_id INTEGER NOT NULL,
  node_id INTEGER NOT NULL,
  PRIMARY KEY (telegram_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_materials_node ON materials(node_id);

-- Initial 4th Year Seed: Root Departments
INSERT OR IGNORE INTO nodes (id, parent_id, title, sort_order) VALUES 
  (1, NULL, '💻 CS - علوم الحاسب', 1),
  (2, NULL, '📊 IS - نظم المعلومات', 2),
  (3, NULL, '🌐 IT - تكنولوجيا المعلومات', 3);

-- Semesters for CS
INSERT OR IGNORE INTO nodes (id, parent_id, title, sort_order) VALUES
  (10, 1, '1️⃣ الترم الأول', 1),
  (11, 1, '2️⃣ الترم الثاني', 2);

-- Semesters for IS
INSERT OR IGNORE INTO nodes (id, parent_id, title, sort_order) VALUES
  (20, 2, '1️⃣ الترم الأول', 1),
  (21, 2, '2️⃣ الترم الثاني', 2);

-- Semesters for IT
INSERT OR IGNORE INTO nodes (id, parent_id, title, sort_order) VALUES
  (30, 3, '1️⃣ الترم الأول', 1),
  (31, 3, '2️⃣ الترم الثاني', 2);
