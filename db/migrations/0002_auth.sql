-- 0002: الجلسات وحدّ محاولات الدخول.
-- الكوكي يحمل رمزاً عشوائياً، والجدول يخزّن تجزئته فقط (sha256): تسريب الجدول لا يعطي جلسات صالحة.

create type session_kind as enum ('student', 'admin');

create table sessions (
  token_hash text primary key,
  kind       session_kind not null,
  student_id bigint references students(id) on delete cascade,
  admin_id   bigint references admins(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- جلسة الطالب تشير لطالب فقط، وجلسة الأدمن لأدمن فقط
  check (
    (kind = 'student' and student_id is not null and admin_id is null)
    or (kind = 'admin' and admin_id is not null and student_id is null)
  )
);
create index sessions_expires_idx on sessions (expires_at);
create index sessions_student_idx on sessions (student_id);
create index sessions_admin_idx on sessions (admin_id);

-- كل محاولة دخول فاشلة أو ناجحة، للحدّ من التخمين. identifier هو رقم الهاتف أو البريد كما أُدخل (مُطبَّعاً).
-- تُحذف السجلات الأقدم من يوم دورياً، فلا تتراكم هنا بيانات.
create table login_attempts (
  id         bigint generated always as identity primary key,
  scope      session_kind not null,
  identifier text not null,
  ip         text not null,
  succeeded  boolean not null,
  created_at timestamptz not null default now()
);
create index login_attempts_identifier_idx on login_attempts (scope, identifier, created_at desc);
create index login_attempts_ip_idx on login_attempts (scope, ip, created_at desc);
