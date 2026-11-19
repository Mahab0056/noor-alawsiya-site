-- 0005: دعوة المديرين بالبريد، ودور «المدير الأعلى»، وتفعيل التحقق بخطوتين من المدير نفسه عند أول دخول.
-- (الرقم 0005 لا 0004 لأن فرع مراجعة PR #2 يضيف 0004_guardian_not_blank.sql؛ الترحيلات تُطبَّق بترتيب الاسم
--  وكل ملف لم يُسجَّل بعد يُطبَّق، فلا يتعارض الاثنان مهما كان ترتيب الدمج.)
--
-- مبادئ:
--   * المدير المدعوّ «معلّق»: لا كلمة مرور ولا سر تحقق، فلا يستطيع الدخول حتى يؤكد رمزاً صحيحاً من تطبيق المصادقة.
--   * رمز الدعوة عشوائي (32 بايت) ولا يُخزَّن إلا تجزئته (sha256). يصلح مرة واحدة، 48 ساعة، وتُبطله أي دعوة أحدث.
--   * سجل العمليات يذكر الدعوة برقمها والمدير برقمه فقط، بلا بريد ولا رمز.

-- قيمة جديدة في النوع: لا تُستعمل في هذا الملف نفسه (Postgres لا يسمح باستعمالها في المعاملة ذاتها).
alter type admin_role add value if not exists 'super_admin';

alter table admins alter column password_hash drop not null;               -- المدعوّ لم يضع كلمة مروره بعد
alter table admins add column totp_pending_secret text;                    -- سر مقترح (مشفّر) ينتظر رمزاً صحيحاً قبل اعتماده
alter table admins add column totp_confirmed_at timestamptz;               -- null = لم يفعّل التحقق بخطوتين بعد، فلا دخول
alter table admins add column disabled_at timestamptz;                     -- أوقفه مدير أعلى
alter table admins add column invited_by bigint references admins(id) on delete set null;

-- من أُنشئ قبل هذه الدعوات (create-admin القديم) كان سره مفعّلاً منذ البداية.
update admins set totp_confirmed_at = created_at where totp_secret is not null;

-- مدير مفعّل يجب أن تكون له كلمة مرور وسر تحقق.
alter table admins add constraint admins_active_has_secrets check (totp_confirmed_at is null or (password_hash is not null and totp_secret is not null));

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
-- دعوة واحدة صالحة على الأكثر لكل مدير.
create unique index admin_invites_one_open_idx on admin_invites (admin_id) where used_at is null and revoked_at is null;

-- محاولات فتح الدعوة وتأكيد الرمز، للحدّ من التخمين. ip وحده، ورقم الدعوة إن عُرفت؛ لا رمز ولا بريد.
create table invite_attempts (
  id         bigint generated always as identity primary key,
  ip         text not null,
  invite_id  bigint references admin_invites(id) on delete cascade,
  succeeded  boolean not null default false,
  created_at timestamptz not null default now()
);
create index invite_attempts_ip_idx on invite_attempts (ip, created_at desc);
create index invite_attempts_invite_idx on invite_attempts (invite_id, created_at desc);
