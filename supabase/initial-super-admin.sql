-- Run after registering the account you want to make Super Admin.
-- Replace the email with an email address you control.
-- Execute only in the Supabase SQL Editor as project owner.
update public.profiles
set role='super_admin', updated_at=now()
where id=(select id from auth.users where lower(email)=lower('REPLACE_WITH_YOUR_EMAIL'));
-- Verify exactly one account was promoted:
select id, display_name, role from public.profiles where role='super_admin';
