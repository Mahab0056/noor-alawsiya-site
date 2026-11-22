-- 0012: دعوة المشرفين بالبريد، ودور «المدير الأعلى»، وإيقاف مشرف.
-- (كان 0005_admin_invites و0006_admin_email_codes في خط الـRC. الرقمان 0004 و0005 صارا للموقع الحي بعد PR #10،
--  وجدول admin_login_codes أنشأه 0004_admin_email_code الحي، فهذا الملف لا يلمسه.)
--
-- مبادئ:
--   * الدخول كما في الموقع الحي منذ PR #10: رمز من ستة أرقام يصل بالبريد في كل دخول، بلا كلمة مرور ولا تطبيق مصادقة.
--   * المشرف المدعوّ «معلّق» (activated_at فارغ): لا يصله رمز دخول حتى يفتح رابط الدعوة ويكتب اسمه.
--   * رمز الدعوة عشوائي (32 بايت) ولا يُخزَّن إلا تجزئته (sha256). يصلح مرة واحدة، 48 ساعة، وتُبطله أي دعوة أحدث.
--   * سجل العمليات يذكر الدعوة برقمها والمشرف برقمه فقط، بلا بريد ولا رمز.
--   * كل ما هنا إضافة: عمود جديد أو جدول جديد أو قيمة جديدة في النوع. لا يُحذف شيء، فالرجوع إلى 2d2215b يبقى ممكناً.

-- قيمة جديدة في النوع: لا تُستعمل في هذا الملف نفسه (Postgres لا يسمح باستعمالها في المعاملة ذاتها)، بل في 0013.
alter type admin_role add value if not exists 'super_admin';

alter table admins add column activated_at timestamptz;                    -- null = مدعوّ لم يقبل الدعوة بعد، فلا دخول
alter table admins add column disabled_at timestamptz;                     -- أوقفه مدير أعلى
alter table admins add column invited_by bigint references admins(id) on delete set null;

-- كل مشرف موجود قبل هذا الملف يدخل اليوم برمز البريد، فهو مفعّل منذ إنشائه.
update admins set activated_at = created_at where activated_at is null;

create table admin_invites (
  id          bigint generated always as identity primary key,
  admin_id    bigint not null references admins(id) on delete cascade,
  token_hash  text not null unique,                                        -- sha256 للرمز؛ الرمز نفسه لا يُخزَّن
  created_by  bigint references admins(id) on delete set null,             -- null = أمر المشغّل (create-admin --invite)
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  revoked_at  timestamptz,                                                 -- سحبها مدير أعلى، أو أبطلتها دعوة أحدث
  check (expires_at > created_at)
);
create index admin_invites_admin_idx on admin_invites (admin_id, created_at desc);
-- دعوة واحدة صالحة على الأكثر لكل مشرف.
create unique index admin_invites_one_open_idx on admin_invites (admin_id) where used_at is null and revoked_at is null;

-- محاولات فتح الدعوة، للحدّ من التخمين. ip وحده، ورقم الدعوة إن عُرفت؛ لا رمز ولا بريد.
create table invite_attempts (
  id         bigint generated always as identity primary key,
  ip         text not null,
  invite_id  bigint references admin_invites(id) on delete cascade,
  succeeded  boolean not null default false,
  created_at timestamptz not null default now()
);
create index invite_attempts_ip_idx on invite_attempts (ip, created_at desc);
create index invite_attempts_invite_idx on invite_attempts (invite_id, created_at desc);
