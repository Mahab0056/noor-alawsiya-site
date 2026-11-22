-- 0011: متابعة الطالب، النوع الأبسط «حضور وملاحظة» (تصميم awsiya-progress-design-2011r). مطفأة بالعلم PROGRESS_TRACKING.
-- (الرقم 0011 لا 0008: 0008 محجوز للعدّادات، و0009 للدروس وروابط الحملة، و0010 لقائمة الانتظار في فروع أخرى.
--  الترحيلات تُطبَّق بترتيب الاسم وكل ملف لم يُسجَّل يُطبَّق، فلا يتعارض أي منها مهما كان ترتيب الدمج.)
--
-- مبادئ:
--   * دور «أستاذ» جديد: يدخل كالمشرف (بريد + كلمة مرور + رمز بالبريد)، ولا يرى إلا حلقات دوراته وأسماء طلابها المقبولين.
--   * من يسجّل الحضور لدورة: المدير الأعلى لأي دورة، وغيره (أستاذ أو مشرف) فقط إن أُسند إلى الدورة في course_teachers.
--   * حلقة واحدة لكل دورة في اليوم (بتوقيت بغداد). سطر حضور واحد لكل طالب في الحلقة، وملاحظة قصيرة يقرؤها ولي الأمر.
--   * ولي الأمر يرى الحضور عبر الطلب المقبول (view enrollments): رفض الطلب لاحقاً يُخفي السجل فوراً.
--   * حذف الطالب يحذف سجل حضوره. سجل العمليات لا يحمل أسماء ولا نص الملاحظات، أرقاماً فقط.

-- قيمة جديدة في النوع: لا تُستعمل في هذا الملف نفسه (Postgres لا يسمح باستعمالها في المعاملة ذاتها).
alter type admin_role add value if not exists 'teacher';

-- نوع المتابعة لكل دورة. «حضور وملاحظة» فقط مبني الآن؛ «تلاوة» و«حفظ» تنتظر أجوبة المدرسة.
create type progress_track as enum ('attendance', 'tilawa', 'hifz');
alter table courses add column progress_track progress_track not null default 'attendance';

-- من يسجّل لأي دورة.
create table course_teachers (
  course_id bigint not null references courses(id) on delete cascade,
  admin_id  bigint not null references admins(id) on delete cascade,
  added_by  bigint references admins(id) on delete set null,
  added_at  timestamptz not null default now(),
  primary key (course_id, admin_id)
);
create index course_teachers_admin_idx on course_teachers (admin_id);

-- الحلقة: تُنشأ عند أول حفظ للحضور في ذلك اليوم.
create table class_sessions (
  id         bigint generated always as identity primary key,
  course_id  bigint not null references courses(id) on delete cascade,
  held_on    date not null,                                             -- تاريخ بغداد
  created_by bigint references admins(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (course_id, held_on)
);

create type attendance_status as enum ('present', 'absent', 'excused');

create table session_attendance (
  session_id  bigint not null references class_sessions(id) on delete cascade,
  student_id  bigint not null references students(id) on delete cascade,
  status      attendance_status not null,
  note        text check (note is null or char_length(note) between 1 and 300),  -- يقرؤها ولي الأمر، عن الدرس فقط
  recorded_by bigint references admins(id) on delete set null,
  recorded_at timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (session_id, student_id)
);
create index session_attendance_student_idx on session_attendance (student_id);
