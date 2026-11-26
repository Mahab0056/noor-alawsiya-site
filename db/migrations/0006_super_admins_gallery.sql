-- 0006: كل المشرفين مشرفون عامّون، ومعرض صور تديره لوحة الإدارة (طلب مهاب 26/11/2026).

-- كل مشرف حالي يصير مشرفاً عاماً، وكل مشرف جديد كذلك.
update admins set role = 'owner';
alter table admins alter column role set default 'owner';

-- صور المعرض محفوظة في القاعدة نفسها: لا خدمة تخزين خارجية ولا قرص يضيع عند إعادة النشر.
-- الصورة تُصغَّر في متصفح المشرف قبل الرفع، والخادم يتحقق من نوعها وحجمها.
create table gallery_images (
  id         bigint generated always as identity primary key,
  caption    text not null default '' check (char_length(caption) <= 140),
  mime       text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  bytes      bytea not null check (octet_length(bytes) between 1 and 5242880),
  width      integer not null check (width between 1 and 10000),
  height     integer not null check (height between 1 and 10000),
  position   integer not null,
  created_by bigint references admins(id) on delete set null,
  created_at timestamptz not null default now()
);
create index gallery_images_position_idx on gallery_images (position, id);
