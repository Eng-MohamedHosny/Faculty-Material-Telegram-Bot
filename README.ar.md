<div align="center">

# 🎓 Faculty Material Telegram Bot (FCAI Bot)
**بوت تيليجرام متكامل لإدارة ومشاركة المحتوى الأكاديمي لكلية الحاسبات والمعلومات**  
مبني على معمارية سحابية مجانية فائقة السرعة (**Serverless Edge Architecture**) بدون أي استهلاك لموارد السيرفرات التقليدية، مع نظام صلاحيات دقيق (RBAC)، ولوحة تحكم تفاعلية للمشرفين والليدرز مباشرة من داخل شات تيليجرام.

<br/>

[![English Documentation](https://img.shields.io/badge/Language-English%20Version-blue?style=for-the-badge&logo=github)](./README.md)
[![PDF Guide](https://img.shields.io/badge/Documentation-PDF%20Guide-red?style=for-the-badge&logo=adobeacrobatreader)](./Faculty_Material_Telegram_Bot_Documentation.pdf)
[![Admin Guide](https://img.shields.io/badge/Commands-Admin%20Guide-green?style=for-the-badge&logo=telegram)](./ADMIN_COMMANDS.md)

</div>

---

## 🌟 أبرز مميزات البوت (Key Features)

### 1. معمارية سحابية مجانية 100% بدون خوادم (Zero Cost & Zero Cold-Start)
- **Cloudflare Workers:** يعمل بنظام Webhooks على الحافة (Edge) بزمن استجابة فوري (< 50ms) وبدون وضع خمول (No Sleep Mode).
- **Cloudflare D1 (SQLite):** قاعدة بيانات سريعة مدمجة على شبكة كلاودفلير السحابية تدعم استعلامات في أجزاء من الثانية.
- **تخزين لا نهائي للملفات:** استغلال سيرفرات تيليجرام الدائمة عبر `file_id` وقناة أرشيف احتياطية خاصة، مما يعني عدم تخزين أي ملف على الخادم (0MB Disk Space).

### 2. الشجرة الأكاديمية الديناميكية (Dynamic Academic Hierarchy)
- لا توجد أي مادة أو قسم مكتوب برمجياً بشكل ثابت (No Hardcoding).
- هيكل شجري مرن: **الأقسام (CS, IT, IS, Networks) ⬅️ الفصول الدراسية (الترم 1، الترم 2) ⬅️ المقررات الدراسية ⬅️ التصنيفات الأكاديمية الخمسة ⬅️ المحاضرات والسكاشن ⬅️ الملفات**.
- التصنيفات الأكاديمية القياسية الموحدة:
  - 📂 **المحاضرات** (صف عريض منفرد)
  - 📝 **السكاشن والعملي** | 📖 **الملخصات والمراجعات** (صف مزدوج)
  - 📅 **الميدتيرم والكويزات** | 📋 **امتحانات الفاينال** (صف مزدوج)

### 3. نظام الصلاحيات المخصص (Role-Based Access Control - RBAC)
- **المسؤول العام (Super Admin):** تحكم كامل في كل أقسام الكلية، قناة الأرشيف، وتعيين الليدرز.
- **الليدر (Leader):** يمنحه المسؤول العام صلاحية إدارة قسم أو أكثر (مثال: ليدر CS يدير CS فقط، أو ليدر يدير IS و IT معاً).
  - داخل الأقسام المخصصة له: يمتلك صلاحية رفع الملفات، إضافة المواد، تعديل الأسماء، وتخصيص العرض، والحذف.
  - داخل باقي الأقسام: يعامله البوت كـ **طالب عادي تماماً** دون إظهار أي أزرار إدارة.
- **الطالب (Student):** تصفح نظيف وسريع، وتحميل مباشر للملفات.

### 4. واجهة استخدام مزدوجة وسلسة (Dual View Mode)
- للمسؤولين: إمكانية التبديل بين **`🎓 وضع الطالب`** (لتجربة تصفح نظيفة تماماً) و**`⚙️ وضع المشرف`** (لإظهار أدوات الإدارة).
- **التسليم الذكي للملفات (Leaf Delivery):** عند وصول الطالب إلى محاضرة أو سكشن فرعي، يقوم البوت بإرسال الملفات فوراً دون نقله إلى شاشات فارغة، مع إبقاء أزرار المحاضرات متاحة للتنقل السريع.

### 5. أدوات الإدارة المتقدمة من تيليجرام مباشرة
- **الرفع الجماعي الصامت (Silent Batch Upload):** إرسال عدد غير محدود من ملفات PDF والصور والفيديوهات دفعة واحدة دون رسائل تشويش متكررة، مع أرشفة تلقائية فورية في القناة السرية.
- **الحذف المتعدد الفوري (Optimistic Multi-Delete):** حذف عدة ملفات متتالية دون إغلاق القائمة، مع حذف الملف تلقائياً من قناة الأرشيف ومن قاعدة البيانات في أجزاء من الثانية.
- **تخصيص العرض والصفوف:** تعديل أزرار القائمة محلياً (صف عريض 🔘 ↔️ صف مزدوج 👥) مع ميزة تعميم التنسيق على باقي مواد القسم أو كل مواد الكلية.
- **تجميع المحتوى بضغطة زر (Download All):** زر `📦 عرض وتحميل كل المحتوى` لتجميع وتحميل جميع محاضرات أو سكاشن المادة دفعة واحدة بنقرة واحدة.

### 6. نظام الإشعارات والتنبيهات المجدولة للأقسام (v2.0)
- **اشتراك الطالب في قسمه الأكاديمي:** زر دائم في شاشة البداية (`🔔 إعدادات الإشعارات واشتراك القسم` أو عبر الأمر `/notifications`) يتيح للطالب اختيار قسمه وتفعيل أو كتم التنبيهات بمرونة تامة.
- **طابور إرسال آمن ومجدول (Safe Chunked Broadcast Queue):** جدولة الإشعارات عبر جدول `broadcast_jobs` وتنفيذها في الخلفية بواسطة Cloudflare Cron Trigger (`* * * * *`) بدفعات سعة 35 طالباً كل دقيقة، مما يضمن الالتزام التام بالحد المجاني لكلاودفلير (50 Subrequest) وتفادي حظر معدل الإرسال في تيليجرام.
- **الكتم التلقائي للحسابات المحظورة (Auto-Mute on 403):** معالجة ذكية لأخطاء تيليجرام 403 عند قيام طالب بحظر البوت أو حذف الحساب، حيث يقوم النظام بكتم إشعاراته تلقائياً لعدم استهلاك رصيد الوركر.
- **إرسال تعميم يدوي لطلاب القسم:** زر `📢 إرسال إشعار للقسم` متاح للمشرفين والليدرز داخل أي مادة تابعة للقسم لإرسال تنبيهات هامة أو صور أو مستندات.
- **تنبيه بضغطة زر بعد رفع الملفات:** فور إنهاء حفظ الملفات المرفوعة (`[✅ إنهاء الحفظ]`)، يقدم البوت زراً فورياً `[🔔 إرسال تنبيه لطلاب القسم بالملفات الجديدة]` لإشعار طلاب القسم تلقائياً.

### 7. مساهمات الطلاب المراقبة بدون إحراج (Crowdsourced Notes) (v2.1)
- **مشاركة الطالب بملخص أو امتحان:** داخل أي مادة، يظهر للطالب زر `[📝 ساهم بملخص أو امتحان]` لرفع الملفات والملخصات، مع رسالة شكر فورية لطيفة (`❤️ شكراً لمساهمتك الجميلة!`).
- **لوحة مراجعة صامتة لليدر:** يصل الملف فوراً لشات ليدر المادة أو القسم ومعه زرّان: `[✅ قبول واختيار الفولدر]` و `[🗑️ تجاهل وحذف بصمت]`.
- **حفظ مشاعر الطلاب (Zero Embarrassment):** في حال الرفض والتجاهل، يُحذف الكارت بهدوء دون إشعار الطالب بأي رفض، وفي حال القبول يختار الليدر إدراجه في فولدر قائم أو إنشاء فولدر جديد بنقرة واحدة.

### 8. تاسكات وتسليمات الأسبوع وحذف المواعيد تلقائياً (v2.1)
- **لوحة متابعة الطالب:** زر رئيسي `[📅 تاسكات وتسليمات الأسبوع الحالي]` أو عبر الأمر `/tasks` يعرض كروت الشيتات والأسايمنتات المطلوبة خلال 7 أيام مرتبة بالأقرب موعداً.
- **تحميل الشيت بضغطة زر:** زر مرفق مع كل تاسك لتحميل ملف التكليف أو الشيت مباشرة.
- **التنظيف التلقائي الذكي:** بمجرد انقضاء موعد التسليم (`due_date < now`) يختفي التاسك تلقائياً دون الحاجة لحذفه يدوياً.
- **نشر سريع لليدرز:** زر `[📅 إضافة تاسك للأسبوع]` لإدخال التكليف، وموعد التسليم، وإرفاق ملف الشيت في ثوانٍ مع خيار تعميمه فوراً لطلاب القسم.

### 9. لوحة الإحصائيات المزدوجة (Dual Analytics Dashboard) (v2.1)
- **شاشة السوبر أدمن الشاملة:** عبر الأمر `/stats` أو لوحة التحكم، تعرض أعداد الطلاب ونسب اشتراكهم بكل قسم، ورصد تلقائي لـ **"المواد الفارغة"** التي لم يرفع فيها الليدرات ملفات حتى الآن لمتابعتها قبل الامتحانات.
- **شاشة الليدر المخصصة:** تعرض لليدر إحصائيات قسمه فقط: عدد المشتركين في الإشعارات، وتاسكات الأسبوع، وعدد المساهمات الطلابية المعلقة بانتظار المراجعة.

### 10. حماية كاملة ضد أخطاء تسمية وتكرار الأزرار (Safe State Guard) (v2.1)
- نظام حماية ثلاثي يمنع تحول اسم أي مادة إلى كلمات التنقل مثل "رجوع" أو "إلغاء"، مع كشف ومنع تكرار المجلدات في نفس المستوى.

---

## 🏗️ البنية التقنية (System Architecture)

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
            | Cloudflare D1        |     | Telegram Servers           |
            | (Edge SQLite)        |     | - Permanent File IDs       |
            | - users              |     | - Backup Archive Channel   |
            | - nodes              |     | - Media Groups Delivery    |
            | - materials          |     | - Safe copyMessage Queue   |
            | - user_permissions   |     | - Student Submissions      |
            | - broadcast_jobs     |     +----------------------------+
            | - submissions        |
            | - weekly_tasks       |
            | - settings           |
            +----------------------+
```

---

## 🗄️ نموذج قاعدة البيانات (Database Schema)

```sql
-- 1. المستخدمين والصلاحيات وحالة التصفح والإشعارات
CREATE TABLE users (
  telegram_id INTEGER PRIMARY KEY,
  full_name TEXT,
  role TEXT DEFAULT 'student',            -- 'student' | 'leader' | 'super_admin'
  managed_node_id INTEGER DEFAULT NULL,  
  current_node_id INTEGER DEFAULT NULL,  -- معرف المجلد الحالي للتنقل الدقيق
  bot_state TEXT DEFAULT 'browsing',     -- 'browsing' | 'awaiting_folder' | 'uploading' | 'renaming' | 'awaiting_leader_id' | 'awaiting_broadcast' | 'awaiting_admin_broadcast' | 'awaiting_submission' | 'awaiting_task_title'
  view_mode TEXT DEFAULT 'admin',        -- 'admin' | 'student'
  subscribed_dept_id INTEGER DEFAULT NULL,-- معرّف القسم المشترك به الطالب
  notifications_enabled INTEGER DEFAULT 1,-- 1: مفعلة | 0: مكتومة / محظورة
  pending_target_id INTEGER DEFAULT NULL  -- مؤشر مؤقت للعمليات متعددة الخطوات
);

-- 2. الشجرة الهرمية للأقسام والمواد (Hierarchy Tree)
CREATE TABLE nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER DEFAULT NULL,        -- معرف المجلد الأب (NULL للأقسام الرئيسية)
  title TEXT NOT NULL,                   -- نص الزر
  sort_order INTEGER DEFAULT 0,          -- ترتيب العرض
  created_by INTEGER,
  is_full_width INTEGER DEFAULT 0,       -- 1: صف كامل منفرد | 0: صف مزدوج
  FOREIGN KEY (parent_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- 3. الملفات والمحتوى الأكاديمي (Materials)
CREATE TABLE materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id INTEGER NOT NULL,              -- القسم التابع له
  file_name TEXT NOT NULL,               -- اسم الملف
  telegram_file_id TEXT NOT NULL,        -- معرّف تيليجرام الدائم
  file_type TEXT NOT NULL,               -- 'document' | 'video' | 'photo' | 'audio' | 'link'
  caption TEXT DEFAULT NULL,
  uploaded_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  backup_message_id INTEGER DEFAULT NULL,-- معرّف الرسالة بقناة الأرشيف للحذف التلقائي
  FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- 4. جدول تخصيص صلاحيات الأقسام لليدرز (RBAC)
CREATE TABLE user_permissions (
  telegram_id INTEGER NOT NULL,
  node_id INTEGER NOT NULL,              -- معرف القسم الممنوح (CS, IT, إلخ)
  PRIMARY KEY (telegram_id, node_id)
);

-- 5. طابور مهام الإشعارات المجدولة (Broadcast Queue)
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

-- 6. جدول مساهمات الطلاب المراقبة (Crowdsourced Notes)
CREATE TABLE submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_node_id INTEGER NOT NULL,        -- المادة التي ساهم فيها الطالب
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

-- 7. جدول تاسكات وتسليمات الأسبوع (Weekly Tasks)
CREATE TABLE weekly_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dept_node_id INTEGER NOT NULL,          -- معرف القسم الأكاديمي
  course_title TEXT NOT NULL,
  task_title TEXT NOT NULL,
  due_date DATETIME NOT NULL,             -- إخفاء تلقائي بعد انتهاء الموعد
  attachment_file_id TEXT DEFAULT NULL,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (dept_node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- 8. إعدادات النظام (Settings)
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

## 🚀 دليل التثبيت والنشر خطوة بخطوة (Step-by-Step Setup)

### المتطلبات الأساسية
- تثبيت [Node.js](https://nodejs.org/) (إصدار 18 أو أحدث).
- حساب مجاني على [Cloudflare](https://dash.cloudflare.com/).
- حساب تيليجرام لإنشاء البوت.

### الخطوة 1: تجهيز بوت تيليجرام وقناة الأرشيف
1. افتح تيليجرام وتحدث مع [@BotFather](https://t.me/BotFather).
2. أرسل الأمر `/newbot` واختر اسماً ومعرفاً للبوت، واحفظ **Bot Token**.
3. أنشئ قناة تيليجرام خاصة (Private Channel) باسم `أرشيف ملفات البوت`.
4. أضف البوت إلى القناة وقم بترقيته إلى **مشرف (Administrator)** بصلاحية نشر الرسائل وحذفها.
5. احصل على معرّف حسابك الشخصي (Telegram ID) عبر إرسال `/id` في البوت بعد تشغيله أو عبر [@userinfobot](https://t.me/userinfobot).

### الخطوة 2: إعداد المشروع محلياً
```bash
# تثبيت الحزم البرمجية
npm install

# تسجيل الدخول إلى Cloudflare عبر أداة Wrangler
npx wrangler login
```

### الخطوة 3: إنشاء قاعدة بيانات Cloudflare D1
```bash
# إنشاء قاعدة البيانات
npx wrangler d1 create college_bot_db
```
- انسخ `database_id` الناتج وضعه داخل ملف `wrangler.toml`:
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

### الخطوة 4: تنفيذ هيكل الجداول وملفات البداية (Seeds)
```bash
# إنشاء الجداول الأساسية
npx wrangler d1 execute college_bot_db --remote --file=./schema.sql

# زراعة الأقسام الرئيسية والمواد (Seeds)
npx wrangler d1 execute college_bot_db --remote --file=./seed_all_departments.sql
npx wrangler d1 execute college_bot_db --remote --file=./seed_cs_term1.sql
```

### الخطوة 5: حفظ التوكن ونشر البوت (Deploy)
```bash
# تعيين التوكن كمتغير سري آمن في كلاودفلير
npx wrangler secret put BOT_TOKEN

# نشر كود المشروع على سيرفرات Cloudflare Workers
npx wrangler deploy
```

### الخطوة 6: تفعيل الـ Webhook
بعد النشر ستحصل على رابط الـ Worker (مثال: `https://faculty-telegram-bot.yourname.workers.dev`).
قم بتفعيل الـ Webhook عن طريق فتح الرابط التالي في المتصفح مرة واحدة:
```text
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://faculty-telegram-bot.yourname.workers.dev
```

---

## 📋 دليل الأوامر (Bot Commands)

| الأمر | الوظيفة | الصلاحية |
| :--- | :--- | :--- |
| `/start` | 🏠 فتح القائمة الرئيسية واختيار وضع الدخول (طالب / مشرف) | متاح للجميع |
| `/tasks` | 📅 عرض تاسكات وتسليمات الأسبوع وتنزيل الشيتات | متاح للجميع |
| `/notifications` | 🔔 إعدادات الإشعارات وتحديد واشتراك القسم الأكاديمي | متاح للجميع |
| `/id` | 🆔 عرض ونسخ الـ Telegram ID الخاص بالمستخدم | متاح للجميع |
| `/admin` | 👑 فتح لوحة تحكم المسؤول العام (قناة الأرشيف، حالة النظام) | المسؤول العام فقط 🔒 |
| `/stats` | 📊 لوحة الإحصائيات الشاملة وتحليل المواد الفارغة | المسؤول العام والليدرز 🔒 |
| `/notify_admins` | 📢 مراسلة وتعميم فوري لكافة القادة والمشرفين بالكلية | المسؤول العام فقط 🔒 |
| `/leaders` | 👥 عرض قائمة الليدرز وتعديل أو سحب صلاحيات الأقسام | المسؤول العام فقط 🔒 |
| `/promote <ID>` | ➕ ترقية مستخدم إلى رتبة ليدر وتعيين أقسامه مباشرة | المسؤول العام فقط 🔒 |
| `/demote <ID>` | 🗑️ سحب رتبة الليدر والصلاحيات من مستخدم | المسؤول العام فقط 🔒 |

> **ملاحظة أمنية:** أوامر الإدارة لا تظهر عند كتابة `/` إلا للمسؤول العام فقط، بينما يرى الطلاب الأوامر العامة فقط بفضل تقنية Telegram Scoped Commands.

---

## 📂 هيكل ملفات المشروع (File Structure)

```
Faculty-Telegram-Bot/
├── src/
│   └── index.ts                 # الكود المصدري الرئيسي للوركر والبوت
├── scripts/
│   └── set_commands.js          # سكريبت تسجيل أوامر تيليجرام بترميز UTF-8
├── schema.sql                   # مخطط قاعدة البيانات الأساسي (D1 Schema)
├── seed_all_departments.sql     # زراعة الأقسام الرئيسية والمقررات لكل الأقسام
├── seed_cs_term1.sql            # زراعة تصنيفات قسم CS الترم الأول
├── ADMIN_COMMANDS.md            # الدليل المرجعي الكامل للمشرفين
├── README.md                    # التوثيق الإنجليزي الرئيسي
├── README.ar.md                 # التوثيق العربي الكامل
├── package.json                 # حزم المشروع والاعتماديات
├── tsconfig.json                # إعدادات TypeScript
└── wrangler.toml.example        # نموذج ملف ضبط Cloudflare Workers & D1
```

---

## 📄 الترخيص (License)
هذا المشروع مفتوح المصدر ومخصص لخدمة ودعم طلاب كليات الحاسبات والمعلومات.
