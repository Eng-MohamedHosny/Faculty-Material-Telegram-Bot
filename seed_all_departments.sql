-- 1. Update Network Department (id = 32)
UPDATE nodes SET title = '📡 شبكات - Networks', is_full_width = 1 WHERE id = 32;

-- Semesters for Network Department (parent_id = 32)
INSERT OR IGNORE INTO nodes (id, parent_id, title, sort_order, is_full_width) VALUES
  (40, 32, '1️⃣ الترم الأول', 1, 0),
  (41, 32, '2️⃣ الترم الثاني', 2, 0);

-- 2. Update CS 1st Semester Courses (Arabic + English & Full Width)
UPDATE nodes SET title = '🛠 Compiler | نظرية المترجمات', is_full_width = 1 WHERE id = 101;
UPDATE nodes SET title = '🎬 Computer Animation | الحركة بالحاسب', is_full_width = 1 WHERE id = 102;
UPDATE nodes SET title = '⚙️ Advanced OS | نظم تشغيل متقدم', is_full_width = 1 WHERE id = 103;
UPDATE nodes SET title = '🌐 Network Management | إدارة شبكات الحاسب', is_full_width = 1 WHERE id = 104;
UPDATE nodes SET title = '🛡️ Software Verification | التحقق من البرمجيات', is_full_width = 1 WHERE id = 105;

-- 3. Insert IS 1st Semester Courses (parent_id = 20)
INSERT OR IGNORE INTO nodes (id, parent_id, title, sort_order, is_full_width) VALUES
  (201, 20, '🗄️ Distributed Databases | قواعد البيانات الموزعة', 1, 1),
  (202, 20, '📐 Information Engineering | هندسة المعلومات', 2, 1),
  (203, 20, '🛡️ Software Verification | التحقق من البرمجيات', 3, 1),
  (204, 20, '⛏️ Data Mining | التنقيب عن البيانات', 4, 1),
  (205, 20, '🌐 Network Information Systems | نظم المعلومات الشبكية', 5, 1);

-- Categories for IS Courses
-- 201: Distributed Databases
INSERT INTO nodes (parent_id, title, sort_order) VALUES
  (201, '📂 المحاضرات (Lectures)', 1),
  (201, '📝 السكاشن والعملي (Labs)', 2),
  (201, '📅 الميدتيرم والكويزات (Quizzes)', 3),
  (201, '📋 امتحانات الفاينال (Finals)', 4),
  (201, '📖 الملخصات والمراجعات (Summaries)', 5);

-- 202: Information Engineering
INSERT INTO nodes (parent_id, title, sort_order) VALUES
  (202, '📂 المحاضرات (Lectures)', 1),
  (202, '📝 السكاشن والعملي (Labs)', 2),
  (202, '📅 الميدتيرم والكويزات (Quizzes)', 3),
  (202, '📋 امتحانات الفاينال (Finals)', 4),
  (202, '📖 الملخصات والمراجعات (Summaries)', 5);

-- 203: Software Verification (IS)
INSERT INTO nodes (parent_id, title, sort_order) VALUES
  (203, '📂 المحاضرات (Lectures)', 1),
  (203, '📝 السكاشن والعملي (Labs)', 2),
  (203, '📅 الميدتيرم والكويزات (Quizzes)', 3),
  (203, '📋 امتحانات الفاينال (Finals)', 4),
  (203, '📖 الملخصات والمراجعات (Summaries)', 5);

-- 204: Data Mining (IS)
INSERT INTO nodes (parent_id, title, sort_order) VALUES
  (204, '📂 المحاضرات (Lectures)', 1),
  (204, '📝 السكاشن والعملي (Labs)', 2),
  (204, '📅 الميدتيرم والكويزات (Quizzes)', 3),
  (204, '📋 امتحانات الفاينال (Finals)', 4),
  (204, '📖 الملخصات والمراجعات (Summaries)', 5);

-- 205: Network Information Systems
INSERT INTO nodes (parent_id, title, sort_order) VALUES
  (205, '📂 المحاضرات (Lectures)', 1),
  (205, '📝 السكاشن والعملي (Labs)', 2),
  (205, '📅 الميدتيرم والكويزات (Quizzes)', 3),
  (205, '📋 امتحانات الفاينال (Finals)', 4),
  (205, '📖 الملخصات والمراجعات (Summaries)', 5);

-- 4. Insert IT 1st Semester Courses (parent_id = 30)
INSERT OR IGNORE INTO nodes (id, parent_id, title, sort_order, is_full_width) VALUES
  (301, 30, '🎨 Multimedia Systems | نظم الوسائط المتعددة', 1, 1),
  (302, 30, '🔄 Network Analysis & Design | تحليل وتصميم الشبكات', 2, 1),
  (303, 30, '🌐 Network Management | إدارة شبكات الحاسب', 3, 1),
  (304, 30, '⛏️ Data Mining | التنقيب عن البيانات', 4, 1),
  (305, 30, '🛒 E-Commerce | التجارة الإلكترونية', 5, 1);

-- Categories for IT Courses
-- 301: Multimedia
INSERT INTO nodes (parent_id, title, sort_order) VALUES
  (301, '📂 المحاضرات (Lectures)', 1),
  (301, '📝 السكاشن والعملي (Labs)', 2),
  (301, '📅 الميدتيرم والكويزات (Quizzes)', 3),
  (301, '📋 امتحانات الفاينال (Finals)', 4),
  (301, '📖 الملخصات والمراجعات (Summaries)', 5);

-- 302: Network Analysis & Design
INSERT INTO nodes (parent_id, title, sort_order) VALUES
  (302, '📂 المحاضرات (Lectures)', 1),
  (302, '📝 السكاشن والعملي (Labs)', 2),
  (302, '📅 الميدتيرم والكويزات (Quizzes)', 3),
  (302, '📋 امتحانات الفاينال (Finals)', 4),
  (302, '📖 الملخصات والمراجعات (Summaries)', 5);

-- 303: Network Management (IT)
INSERT INTO nodes (parent_id, title, sort_order) VALUES
  (303, '📂 المحاضرات (Lectures)', 1),
  (303, '📝 السكاشن والعملي (Labs)', 2),
  (303, '📅 الميدتيرم والكويزات (Quizzes)', 3),
  (303, '📋 امتحانات الفاينال (Finals)', 4),
  (303, '📖 الملخصات والمراجعات (Summaries)', 5);

-- 304: Data Mining (IT)
INSERT INTO nodes (parent_id, title, sort_order) VALUES
  (304, '📂 المحاضرات (Lectures)', 1),
  (304, '📝 السكاشن والعملي (Labs)', 2),
  (304, '📅 الميدتيرم والكويزات (Quizzes)', 3),
  (304, '📋 امتحانات الفاينال (Finals)', 4),
  (304, '📖 الملخصات والمراجعات (Summaries)', 5);

-- 305: E-Commerce (IT)
INSERT INTO nodes (parent_id, title, sort_order) VALUES
  (305, '📂 المحاضرات (Lectures)', 1),
  (305, '📝 السكاشن والعملي (Labs)', 2),
  (305, '📅 الميدتيرم والكويزات (Quizzes)', 3),
  (305, '📋 امتحانات الفاينال (Finals)', 4),
  (305, '📖 الملخصات والمراجعات (Summaries)', 5);

-- 5. Insert Network Department 1st Semester Courses (parent_id = 40)
INSERT OR IGNORE INTO nodes (id, parent_id, title, sort_order, is_full_width) VALUES
  (401, 40, '🎨 Multimedia Systems | نظم الوسائط المتعددة', 1, 1),
  (402, 40, '🖥️ System Administration | إدارة النظام', 2, 1),
  (403, 40, '🔀 Routing & Switching | مقدمة للتوجيه والتبديل', 3, 1),
  (404, 40, '🐧 Linux Administration | إدارة نظام لينكس', 4, 1),
  (405, 40, '🛒 E-Commerce | التجارة الإلكترونية', 5, 1);

-- Categories for Network Department Courses
-- 401: Multimedia (Network)
INSERT INTO nodes (parent_id, title, sort_order) VALUES
  (401, '📂 المحاضرات (Lectures)', 1),
  (401, '📝 السكاشن والعملي (Labs)', 2),
  (401, '📅 الميدتيرم والكويزات (Quizzes)', 3),
  (401, '📋 امتحانات الفاينال (Finals)', 4),
  (401, '📖 الملخصات والمراجعات (Summaries)', 5);

-- 402: System Admin
INSERT INTO nodes (parent_id, title, sort_order) VALUES
  (402, '📂 المحاضرات (Lectures)', 1),
  (402, '📝 السكاشن والعملي (Labs)', 2),
  (402, '📅 الميدتيرم والكويزات (Quizzes)', 3),
  (402, '📋 امتحانات الفاينال (Finals)', 4),
  (402, '📖 الملخصات والمراجعات (Summaries)', 5);

-- 403: Routing & Switching
INSERT INTO nodes (parent_id, title, sort_order) VALUES
  (403, '📂 المحاضرات (Lectures)', 1),
  (403, '📝 السكاشن والعملي (Labs)', 2),
  (403, '📅 الميدتيرم والكويزات (Quizzes)', 3),
  (403, '📋 امتحانات الفاينال (Finals)', 4),
  (403, '📖 الملخصات والمراجعات (Summaries)', 5);

-- 404: Linux Admin
INSERT INTO nodes (parent_id, title, sort_order) VALUES
  (404, '📂 المحاضرات (Lectures)', 1),
  (404, '📝 السكاشن والعملي (Labs)', 2),
  (404, '📅 الميدتيرم والكويزات (Quizzes)', 3),
  (404, '📋 امتحانات الفاينال (Finals)', 4),
  (404, '📖 الملخصات والمراجعات (Summaries)', 5);

-- 405: E-Commerce (Network)
INSERT INTO nodes (parent_id, title, sort_order) VALUES
  (405, '📂 المحاضرات (Lectures)', 1),
  (405, '📝 السكاشن والعملي (Labs)', 2),
  (405, '📅 الميدتيرم والكويزات (Quizzes)', 3),
  (405, '📋 امتحانات الفاينال (Finals)', 4),
  (405, '📖 الملخصات والمراجعات (Summaries)', 5);
