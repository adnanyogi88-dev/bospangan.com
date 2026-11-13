-- Run this ONCE in Supabase SQL Editor to promote your own registered account.
-- Replace the email below with the email address you used to register.
-- Never promote an email address you do not control.
update public.profiles
set role = 'admin', updated_at = now()
where id = (
  select id from auth.users
  where lower(email) = lower('YOUR_REGISTERED_EMAIL')
);
