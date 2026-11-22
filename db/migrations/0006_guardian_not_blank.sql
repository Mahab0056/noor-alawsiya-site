-- 0006: بيانات ولي الأمر لا تكون نصاً فارغاً. القيد minors_need_guardian يقبل '' لأنه يفحص is not null فقط.
alter table students add constraint guardian_not_blank check (
  (guardian_name is null or length(btrim(guardian_name)) >= 2)
  and (guardian_phone is null or guardian_phone ~ '^07[3-9][0-9]{8}$')
);
