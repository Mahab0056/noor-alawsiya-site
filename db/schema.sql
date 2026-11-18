-- مخطط قاعدة بيانات منصة مدرسة نور الأوصياء (Postgres).
-- مسودة للمراجعة: لم تُنشأ أي قاعدة بيانات بعد. إنشاء خدمة Postgres على Railway ينتظر موافقة مهاب.
-- مبادئ: أقل بيانات شخصية ممكنة (الطلاب قد يكونون قاصرين)، وكلمات المرور مخزّنة كتجزئة argon2 فقط.

create type registration_status as enum ('pending', 'accepted', 'rejected');
create type course_status as enum ('open', 'done', 'unknown');
create type lesson_kind as enum ('video', 'text', 'pdf');
create type question_kind as enum ('single', 'multi', 'yes_no', 'text');
create type admin_role as enum ('owner', 'staff');

create table admins (
  id            bigint generated always as identity primary key,
  name          text not null,
  email         text not null unique,
  password_hash text not null,                 -- argon2id
  totp_secret   text,                          -- التحقق بخطوتين (مشفّر على مستوى التطبيق)
  role          admin_role not null default 'staff',
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

create table students (
  id                  bigint generated always as identity primary key,
  full_name           text not null,
  birth_year          smallint not null check (birth_year between 1930 and 2100), -- السنة فقط، لا التاريخ الكامل
  phone               text not null unique,    -- يُستعمل للدخول مع كلمة المرور
  password_hash       text not null,           -- argon2id
  guardian_name       text,                    -- مطلوب لمن هو دون 18
  guardian_phone      text,
  guardian_consent_at timestamptz,
  created_at          timestamptz not null default now()
);

create table courses (
  id          bigint generated always as identity primary key,
  name        text not null,
  kind        text,                            -- tajweed | tahqiq | nagham، أو null إذا لم يُذكر
  description text,
  teacher     text not null,
  place       text,
  started_on  text,                            -- كما في سجل المدرسة (بعضها سنة فقط)
  status      course_status not null default 'open',
  published   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- استبيان التسجيل: يحدد الأدمن أسئلته
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

create table registrations (
  id          bigint generated always as identity primary key,
  student_id  bigint not null references students(id) on delete cascade,
  course_id   bigint not null references courses(id),
  status      registration_status not null default 'pending',
  admin_note  text,
  reviewed_by bigint references admins(id),
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (student_id, course_id)
);

create table registration_answers (
  registration_id bigint not null references registrations(id) on delete cascade,
  question_id     bigint not null references form_questions(id),
  answer          jsonb not null,
  primary key (registration_id, question_id)
);

-- القبول ينشئ التحاقاً، وهو ما يفتح دروس الدورة للطالب
create table enrollments (
  student_id  bigint not null references students(id) on delete cascade,
  course_id   bigint not null references courses(id),
  enrolled_at timestamptz not null default now(),
  primary key (student_id, course_id)
);

create table lessons (
  id         bigint generated always as identity primary key,
  course_id  bigint not null references courses(id) on delete cascade,
  title      text not null,
  kind       lesson_kind not null,
  body       text,                             -- نص الشرح
  media_url  text,                             -- رابط الفيديو أو الملف
  position   integer not null,
  published  boolean not null default false,
  created_at timestamptz not null default now()
);

create table lesson_progress (
  student_id   bigint not null references students(id) on delete cascade,
  lesson_id    bigint not null references lessons(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (student_id, lesson_id)
);

create table questions (
  id        bigint generated always as identity primary key,
  course_id bigint not null references courses(id) on delete cascade,
  body      text not null,
  kind      question_kind not null,
  options   jsonb not null default '[]',
  correct   jsonb,                             -- null للأسئلة المقالية (تصحيح يدوي)
  points    integer not null default 1 check (points > 0)
);

create table exams (
  id               bigint generated always as identity primary key,
  course_id        bigint not null references courses(id) on delete cascade,
  title            text not null,
  duration_minutes integer not null check (duration_minutes > 0),
  opens_at         timestamptz,
  closes_at        timestamptz,
  max_attempts     integer not null default 1 check (max_attempts > 0),
  published        boolean not null default false
);

create table exam_questions (
  exam_id     bigint not null references exams(id) on delete cascade,
  question_id bigint not null references questions(id),
  position    integer not null,
  primary key (exam_id, question_id)
);

create table attempts (
  id           bigint generated always as identity primary key,
  exam_id      bigint not null references exams(id) on delete cascade,
  student_id   bigint not null references students(id) on delete cascade,
  started_at   timestamptz not null default now(),
  submitted_at timestamptz,
  auto_score   integer,
  manual_score integer
);

create table attempt_answers (
  attempt_id  bigint not null references attempts(id) on delete cascade,
  question_id bigint not null references questions(id),
  answer      jsonb,
  is_correct  boolean,
  primary key (attempt_id, question_id)
);

-- من فعل ماذا ومتى في لوحة الأدمن
create table audit_log (
  id         bigint generated always as identity primary key,
  admin_id   bigint references admins(id),
  action     text not null,
  target     text,
  detail     jsonb,
  created_at timestamptz not null default now()
);

create index registrations_status_idx on registrations (status, created_at desc);
create index lessons_course_idx on lessons (course_id, position);
create index attempts_exam_idx on attempts (exam_id, student_id);
