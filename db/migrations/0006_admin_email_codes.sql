-- 0006: دخول المديرين بالبريد بدل تطبيق المصادقة (قرار محب 19/11: «سويه بس رسالة ايميل بدون qr»).
--
--   * «مفعّل» صار عموداً مستقلاً activated_at: يكفيه كلمة مرور، ولا يحتاج سر تحقق. totp_confirmed_at يبقى للمسار
--     القديم (مطفأ بالعلم ADMIN_TOTP) فقط.
--   * رمز الدخول بالبريد: ستة أرقام، مرة واحدة، 10 دقائق، 5 محاولات. لا يُخزَّن الرمز بل HMAC له بمفتاح من APP_SECRET،
--     ولا يُخزَّن معرّف التحدي (في كوكي قصيرة) بل sha256 له.
--   * «تذكّر هذا الجهاز 30 يوماً»: رمز عشوائي في كوكي، ولا يُخزَّن إلا sha256 له. يُمسح عند الإيقاف أو إعادة الدعوة.
--   * لا بريد ولا رمز في أي سجل.

alter table admins add column activated_at timestamptz;
update admins set activated_at = totp_confirmed_at where totp_confirmed_at is not null;

alter table admins drop constraint admins_active_has_secrets;
alter table admins add constraint admins_active_has_password check (activated_at is null or password_hash is not null);
alter table admins add constraint admins_totp_has_secret check (totp_confirmed_at is null or totp_secret is not null);

create table admin_login_codes (
  id             bigint generated always as identity primary key,
  admin_id       bigint not null references admins(id) on delete cascade,
  challenge_hash text not null unique,                                   -- sha256 لمعرّف التحدي الذي في الكوكي
  code_mac       text not null,                                          -- HMAC-SHA256 للرمز؛ الرمز نفسه لا يُخزَّن
  attempts       integer not null default 0 check (attempts between 0 and 5),
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  used_at        timestamptz,
  check (expires_at > created_at)
);
create index admin_login_codes_admin_idx on admin_login_codes (admin_id, created_at desc);

create table admin_devices (
  id           bigint generated always as identity primary key,
  admin_id     bigint not null references admins(id) on delete cascade,
  token_hash   text not null unique,                                     -- sha256 لرمز الكوكي
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  check (expires_at > created_at)
);
create index admin_devices_admin_idx on admin_devices (admin_id);
