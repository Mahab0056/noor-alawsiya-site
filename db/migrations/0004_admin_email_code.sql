-- 0004: الدخول إلى لوحة الإدارة برمز يصل بالبريد، بدل كلمة المرور ورمز المصادقة (قرار مهاب 22/11/2026).

-- المشرف صار يُنشأ ببريده وحده، فكلمة المرور لم تعد إلزامية. العمود باقٍ لمن أُنشئ قبل هذا التغيير.
alter table admins alter column password_hash drop not null;

-- رموز الدخول المرسلة بالبريد. يُخزَّن hmac الرمز بمفتاح APP_SECRET لا تجزئته المجرّدة:
-- ستة أرقام تُخمَّن من جدول كامل في لحظة لو تسرّب الجدول وحده.
create table admin_login_codes (
  id          bigint generated always as identity primary key,
  admin_id    bigint not null references admins(id) on delete cascade,
  code_hash   text not null,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index admin_login_codes_admin_idx on admin_login_codes (admin_id, created_at desc);
create index admin_login_codes_expires_idx on admin_login_codes (expires_at);
