CREATE TABLE broadcast_jobs_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL DEFAULT 'department',
  dept_node_id INTEGER DEFAULT NULL,
  dept_title TEXT NOT NULL,
  sender_id INTEGER NOT NULL,
  from_chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  last_user_id INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO broadcast_jobs_new (id, target_type, dept_node_id, dept_title, sender_id, from_chat_id, message_id, last_user_id, sent_count, failed_count, status, created_at)
SELECT id, target_type, dept_node_id, dept_title, sender_id, from_chat_id, message_id, last_user_id, sent_count, failed_count, status, created_at FROM broadcast_jobs;

DROP TABLE broadcast_jobs;
ALTER TABLE broadcast_jobs_new RENAME TO broadcast_jobs;

CREATE INDEX idx_broadcast_status ON broadcast_jobs(status, id);
