-- 0009: «روابط الحملات». رابط لكل ملصق أو منشور أو صفحة إنستغرام، بآخره ?from=<الاسم>.
--
-- * name: اسم المصدر القصير الذي يظهر في الرابط. حروف لاتينية صغيرة وأرقام وشرطة، من ٢ إلى ٢٠ حرفاً،
--   لا يبدأ بشرطة ولا ينتهي بها. فريد: الاسم هو ما يُعدّ عليه، فلا يصح أن يدل على صفحتين.
--   other و direct محجوزان لأن عدّاد التسجيل يستعملهما لمعنى آخر (مصدر غير معروف / بلا مصدر).
-- * target: الصفحة التي يفتحها الرابط: الرئيسية، صفحة التسجيل، أو صفحة التسجيل مع دورة مختارة.
-- * لا يُحفظ شيء عن الزائر ولا عن الموظف هنا. من أنشأ الرابط مكتوب في audit_log برقم الرابط فقط، مثل بقية الإدارة.

create table campaign_links (
  id bigint generated always as identity primary key,
  name text not null unique
    constraint campaign_name_shape check (char_length(name) between 2 and 20 and name ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
    constraint campaign_name_reserved check (name not in ('other', 'direct')),
  target text not null check (target in ('home', 'register', 'course')),
  course_id bigint references courses (id),
  created_at timestamptz not null default now(),
  constraint campaign_course_target check ((target = 'course') = (course_id is not null))
);
