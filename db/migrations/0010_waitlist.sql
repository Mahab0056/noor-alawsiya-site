-- 0010: قائمة الانتظار «بلّغوني لما تنفتح دورة».
-- (0008 محجوز لعدّادات التسجيل funnel-counts، و0009 للدروس lessons-phase3.)
--
-- ولي الأمر يترك رقم هاتفه حين لا توجد دورة مفتوحة، والإدارة تبلّغه بيدها على واتساب حين تنفتح.
-- أقل البيانات: رقم الهاتف فقط إلزامي. لا اسم للطالب ولا تاريخ ميلاد، بل فئة عمر اختيارية.
--
-- * course_id: الدورة التي تهمه، أو null = «أي دورة».
-- * age_band: under10 = أقل من ١٠، 10to14 = ١٠–١٤، 15plus = ١٥ فأكثر. اختياري.
-- * consent_version + consented_at: نص الموافقة الذي وافق عليه ووقتها.
-- * notified_at: وقت ضغط المشرف «تم التبليغ». removed_at: وقت الحذف (بطلبه أو بانتهاء مدة الحفظ)؛
--   الحذف يمسح الرقم والاسم، ويبقى السطر بلا بيانات شخصية للعدّ فقط.
-- * رقم واحد لكل دورة (أو لـ«أي دورة») في القائمة الحية: التكرار لا يضيف سطراً.

create table course_waitlist (
  id              bigint generated always as identity primary key,
  guardian_name   text check (guardian_name is null or char_length(guardian_name) between 2 and 80),
  phone           text check (phone is null or phone ~ '^07[3-9][0-9]{8}$'),
  course_id       bigint references courses(id),
  age_band        text check (age_band is null or age_band in ('under10', '10to14', '15plus')),
  consent_version text not null,
  consented_at    timestamptz not null,
  created_at      timestamptz not null default now(),
  notified_at     timestamptz,
  removed_at      timestamptz,
  -- سطر حي = فيه رقم؛ سطر محذوف = بلا رقم ولا اسم.
  constraint course_waitlist_live_has_phone check ((removed_at is null) = (phone is not null)),
  constraint course_waitlist_removed_is_blank check (removed_at is null or guardian_name is null)
);
create unique index course_waitlist_one_live_idx on course_waitlist (phone, coalesce(course_id, 0)) where removed_at is null;
create index course_waitlist_course_idx on course_waitlist (course_id, created_at) where removed_at is null;
-- الحد اليومي العام يعدّ ما أُضيف خلال آخر ٢٤ ساعة.
create index course_waitlist_created_idx on course_waitlist (created_at);

-- طلبات قائمة الانتظار لكل عنوان، منفصلة عن محاولات الدخول والتسجيل. بلا أي بيانات عن الشخص. تُحذف بعد يوم.
create table waitlist_attempts (
  id         bigint generated always as identity primary key,
  ip         text not null,
  created_at timestamptz not null default now()
);
create index waitlist_attempts_ip_idx on waitlist_attempts (ip, created_at desc);
