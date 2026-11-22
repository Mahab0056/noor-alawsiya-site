-- 0007: الطالب المسجّل يطلب دورة ثانية من «حسابي» دون إعادة كتابة بياناته.
--
-- * كان القيد unique (student_id, course_id) يمنع أي طلب ثانٍ للدورة نفسها، حتى بعد الرفض.
--   صار القيد على الطلب «الحي» فقط: طلب واحد قيد المراجعة أو مقبول لكل طالب في كل دورة،
--   ويمكن طلب الدورة من جديد بعد رفض سابق.
-- * origin: من أين جاء الطلب. 'register' = مع إنشاء الحساب، 'account' = طالب مسجّل طلبه من حسابه.
-- * student_note: ملاحظة قصيرة اختيارية من الطالب (٣٠٠ حرف كحد أقصى).
-- * guardian_consent_at: للقاصر، وقت ضغط «ولي الأمر موافق على هذا الطلب» لهذا الطلب بعينه.
--   لا تُجمع بيانات جديدة: ولي الأمر هو المسجّل في جدول students.

alter table registrations drop constraint registrations_student_id_course_id_key;
create unique index registrations_one_live_idx on registrations (student_id, course_id) where status in ('pending', 'accepted');

alter table registrations
  add column origin text not null default 'register' check (origin in ('register', 'account')),
  add column student_note text check (student_note is null or char_length(student_note) between 1 and 300),
  add column guardian_consent_at timestamptz;

-- حد الطلبات اليومي يعدّ طلبات الطالب الأخيرة.
create index registrations_student_idx on registrations (student_id, created_at desc);
