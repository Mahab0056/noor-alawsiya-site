-- 0005: المشرف العام الأول (قرار مهاب 22/11/2026).
-- الدخول صار برمز يصل بالبريد، فلا سرّ هنا: السطر هو البريد المسموح له بطلب الرمز.
-- on conflict do nothing حتى لا يتكرر السطر إذا كان البريد مسجّلاً من قبل.
insert into admins (name, email, role)
values ('المشرف العام', 'mohamed.k.bnaian@gmail.com', 'owner')
on conflict do nothing;
