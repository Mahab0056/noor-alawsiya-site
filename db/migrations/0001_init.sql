-- 0001: المخطط الأساسي لمنصة مدرسة نور الأوصياء (Postgres).
-- يُطبَّق عبر lib/migrate.ts. في التطوير والاختبار يعمل على PGlite داخل العملية ببيانات مخترعة فقط.
--
-- مبادئ:
--   * أقل بيانات شخصية ممكنة (الطلاب قد يكونون قاصرين)، وكلمات المرور مخزّنة كتجزئة argon2id فقط.
--   * ما يفتح الدروس للطالب هو طلب تسجيل مقبول، لا جدول منفصل: رفض الطلب لاحقاً يسحب الوصول فوراً.
--   * حذف الطالب يحذف كل ما يخصه (on delete cascade). سجل العمليات لا يخزّن بيانات شخصية للطلاب.
--   * الفيديو روابط يوتيوب غير مدرجة تُعرض بتضمين youtube-nocookie (قرار مهاب 18/11/2026).

create type registration_status as enum ('pending', 'accepted', 'rejected');
create type course_status as enum ('open', 'done', 'unknown');
create type course_kind as enum ('tajweed', 'tahqiq', 'nagham');
create type lesson_kind as enum ('video', 'text', 'pdf');
create type question_kind as enum ('single', 'multi', 'yes_no', 'text');
create type admin_role as enum ('owner', 'staff');

create table admins (
  id            bigint generated always as identity primary key,
  name          text not null,
  email         text not null,
  password_hash text not null,                 -- argon2id
  totp_secret   text,                          -- التحقق بخطوتين (مشفّر على مستوى التطبيق)
  role          admin_role not null default 'staff',
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index admins_email_key on admins (lower(email));

-- الدخول برقم الهاتف وكلمة المرور (قرار مهاب 17/11/2026).
-- القاصر يسجَّل برقم ولي الأمر، فقد يشترك أخوان في رقم واحد: الرقم ليس فريداً وحده، بل الرقم مع الاسم،
-- وعند الدخول برقم عليه أكثر من حساب يختار الطالب اسمه.
create table students (
  id                  bigint generated always as identity primary key,
  full_name           text not null,
  birth_year          smallint not null check (birth_year between 1930 and 2100), -- السنة فقط، لا التاريخ الكامل
  phone               text not null,
  password_hash       text not null,           -- argon2id
  guardian_name       text,
  guardian_phone      text,
  guardian_consent_at timestamptz,
  consent_version     text,                    -- نسخة نص الموافقة التي وافق عليها ولي الأمر
  created_at          timestamptz not null default now(),
  unique (phone, full_name),
  -- من كان دون 18 عند التسجيل لا يُقبل بلا اسم ولي الأمر ورقمه وموافقته
  constraint minors_need_guardian check (
    extract(year from created_at) - birth_year > 18
    or (guardian_name is not null and guardian_phone is not null and guardian_consent_at is not null)
  )
);
create index students_phone_idx on students (phone);

create table courses (
  id          bigint generated always as identity primary key,
  name        text not null,
  kind        course_kind,                     -- null إذا لم يُذكر في سجل المدرسة
  description text,
  teacher     text not null,
  place       text,
  started_on  text,                            -- كما في سجل المدرسة (بعضها سنة فقط)
  status      course_status not null default 'open',
  published   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- استبيان التسجيل: يحدد الأدمن أسئلته. السؤال لا يُحذف إذا عليه إجابات، بل يُعطَّل (active = false).
create table form_questions (
  id       bigint generated always as identity primary key,
  label    text not null,
  kind     question_kind not null,
  options  jsonb not null default '[]',
  required boolean not null default false,
  position integer not null,
  show_if  jsonb,                              -- {question_id, equals} لإظهار السؤال بشرط
  active   boolean not null default true
);

-- الدورة التي عليها طلبات لا تُحذف (restrict): تُغلق أو تُخفى بدل ذلك.
create table registrations (
  id          bigint generated always as identity primary key,
  student_id  bigint not null references students(id) on delete cascade,
  course_id   bigint not null references courses(id) on delete restrict,
  status      registration_status not null default 'pending',
  admin_note  text,
  reviewed_by bigint references admins(id) on delete set null,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (student_id, course_id)
);
create index registrations_status_idx on registrations (status, created_at desc);
create index registrations_course_idx on registrations (course_id);

create table registration_answers (
  registration_id bigint not null references registrations(id) on delete cascade,
  question_id     bigint not null references form_questions(id) on delete restrict,
  answer          jsonb not null,
  primary key (registration_id, question_id)
);

-- الالتحاق مشتق من الطلبات المقبولة: لا يمكن أن يبقى طالب ملتحقاً بعد رفض طلبه.
create view enrollments as
  select student_id, course_id, reviewed_at as enrolled_at
  from registrations
  where status = 'accepted';

create table lessons (
  id         bigint generated always as identity primary key,
  course_id  bigint not null references courses(id) on delete cascade,
  title      text not null,
  kind       lesson_kind not null,
  body       text,                             -- نص الشرح
  media_url  text,                             -- رابط يوتيوب غير مدرج، أو رابط ملف PDF
  position   integer not null,
  published  boolean not null default false,
  created_at timestamptz not null default now(),
  unique (course_id, position)
);

create table lesson_progress (
  student_id   bigint not null references students(id) on delete cascade,
  lesson_id    bigint not null references lessons(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (student_id, lesson_id)
);
create index lesson_progress_lesson_idx on lesson_progress (lesson_id);

create table questions (
  id        bigint generated always as identity primary key,
  course_id bigint not null references courses(id) on delete cascade,
  body      text not null,
  kind      question_kind not null,
  options   jsonb not null default '[]',
  correct   jsonb,                             -- null للأسئلة المقالية (تصحيح يدوي)
  points    integer not null default 1 check (points > 0),
  unique (id, course_id)                       -- ليُربط سؤال الامتحان بدورة الامتحان نفسها
);
create index questions_course_idx on questions (course_id);

create table exams (
  id               bigint generated always as identity primary key,
  course_id        bigint not null references courses(id) on delete cascade,
  title            text not null,
  duration_minutes integer not null check (duration_minutes > 0),
  opens_at         timestamptz,
  closes_at        timestamptz,
  max_attempts     integer not null default 1 check (max_attempts > 0),
  published        boolean not null default false,
  unique (id, course_id),
  check (closes_at is null or opens_at is null or closes_at > opens_at)
);
create index exams_course_idx on exams (course_id);

-- سؤال الامتحان يجب أن يكون من بنك أسئلة دورة الامتحان نفسها (مفتاحان مركّبان).
create table exam_questions (
  exam_id     bigint not null,
  question_id bigint not null,
  course_id   bigint not null,
  position    integer not null,
  primary key (exam_id, question_id),
  unique (exam_id, position),
  foreign key (exam_id, course_id) references exams (id, course_id) on delete cascade,
  foreign key (question_id, course_id) references questions (id, course_id) on delete restrict
);

-- حد المحاولات والوقت: التطبيق ينشئ المحاولة برقمها ووقت انتهائها، وقاعدة البيانات تمنع
-- محاولتين مفتوحتين معاً وتكرار رقم المحاولة. التحقق من attempt_no <= max_attempts ومن expires_at في الخادم.
create table attempts (
  id           bigint generated always as identity primary key,
  exam_id      bigint not null references exams(id) on delete cascade,
  student_id   bigint not null references students(id) on delete cascade,
  attempt_no   integer not null check (attempt_no > 0),
  started_at   timestamptz not null default now(),
  expires_at   timestamptz not null,           -- started_at + مدة الامتحان، ولا يتجاوز closes_at
  submitted_at timestamptz,
  auto_score   integer,
  manual_score integer,
  unique (exam_id, student_id, attempt_no),
  unique (id, exam_id),
  check (expires_at > started_at)
);
create unique index attempts_one_open_idx on attempts (exam_id, student_id) where submitted_at is null;
create index attempts_student_idx on attempts (student_id);

-- الإجابة لا تُقبل إلا على سؤال من أسئلة امتحان المحاولة نفسها.
create table attempt_answers (
  attempt_id     bigint not null,
  exam_id        bigint not null,
  question_id    bigint not null,
  answer         jsonb,
  is_correct     boolean,
  points_awarded integer,
  primary key (attempt_id, question_id),
  foreign key (attempt_id, exam_id) references attempts (id, exam_id) on delete cascade,
  foreign key (exam_id, question_id) references exam_questions (exam_id, question_id) on delete restrict
);

-- من فعل ماذا ومتى في لوحة الأدمن. target مرجع (مثل registration:142)، و detail لا يحوي
-- أسماء أو أرقام هواتف الطلاب، حتى لا تبقى بياناتهم هنا بعد طلب الحذف.
create table audit_log (
  id         bigint generated always as identity primary key,
  admin_id   bigint references admins(id) on delete set null,
  action     text not null,
  target     text,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on audit_log (created_at desc);

