-- تشديد بعد المراجعة الأمنية للمرحلة 2.

-- آخر خطوة زمنية قُبل فيها رمز التحقق لكل مدير، حتى لا يُستعمل الرمز نفسه مرتين.
alter table admins add column totp_last_step bigint;

-- محاولات التسجيل لكل عنوان، منفصلة عن محاولات الدخول حتى لا يحجب أحدهما الآخر.
-- لا تحمل أي بيانات عن الطالب. تُحذف السجلات الأقدم من يوم.
create table registration_attempts (
  id         bigint generated always as identity primary key,
  ip         text not null,
  created_at timestamptz not null default now()
);
create index registration_attempts_ip_idx on registration_attempts (ip, created_at desc);
