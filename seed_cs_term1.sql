-- Insert CS 4th Year Semester 1 Courses (under parent_id = 10)
INSERT INTO nodes (id, parent_id, title, sort_order) VALUES
  (101, 10, '🛠 Compiler', 1),
  (102, 10, '🎬 Computer Animation', 2),
  (103, 10, '⚙️ Advanced OS', 3),
  (104, 10, '🌐 إدارة شبكات الحاسب', 4),
  (105, 10, '🛡️ التحقق من البرمجيات', 5);

-- Categories for Compiler (parent_id = 101)
INSERT INTO nodes (parent_id, title, sort_order) VALUES
  (101, '📂 المحاضرات (Lectures)', 1),
  (101, '📝 السكاشن والعملي (Labs)', 2),
  (101, '📅 الميدتيرم والكويزات (Quizzes)', 3),
  (101, '📋 امتحانات الفاينال (Finals)', 4),
  (101, '📖 الملخصات والمراجعات (Summaries)', 5);

-- Categories for Computer Animation (parent_id = 102)
INSERT INTO nodes (parent_id, title, sort_order) VALUES
  (102, '📂 المحاضرات (Lectures)', 1),
  (102, '📝 السكاشن والعملي (Labs)', 2),
  (102, '📅 الميدتيرم والكويزات (Quizzes)', 3),
  (102, '📋 امتحانات الفاينال (Finals)', 4),
  (102, '📖 الملخصات والمراجعات (Summaries)', 5);

-- Categories for Advanced OS (parent_id = 103)
INSERT INTO nodes (parent_id, title, sort_order) VALUES
  (103, '📂 المحاضرات (Lectures)', 1),
  (103, '📝 السكاشن والعملي (Labs)', 2),
  (103, '📅 الميدتيرم والكويزات (Quizzes)', 3),
  (103, '📋 امتحانات الفاينال (Finals)', 4),
  (103, '📖 الملخصات والمراجعات (Summaries)', 5);

-- Categories for Network Management (parent_id = 104)
INSERT INTO nodes (parent_id, title, sort_order) VALUES
  (104, '📂 المحاضرات (Lectures)', 1),
  (104, '📝 السكاشن والعملي (Labs)', 2),
  (104, '📅 الميدتيرم والكويزات (Quizzes)', 3),
  (104, '📋 امتحانات الفاينال (Finals)', 4),
  (104, '📖 الملخصات والمراجعات (Summaries)', 5);

-- Categories for Software Verification (parent_id = 105)
INSERT INTO nodes (parent_id, title, sort_order) VALUES
  (105, '📂 المحاضرات (Lectures)', 1),
  (105, '📝 السكاشن والعملي (Labs)', 2),
  (105, '📅 الميدتيرم والكويزات (Quizzes)', 3),
  (105, '📋 امتحانات الفاينال (Finals)', 4),
  (105, '📖 الملخصات والمراجعات (Summaries)', 5);
