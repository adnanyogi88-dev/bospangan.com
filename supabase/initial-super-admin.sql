-- Bos Pangan: promote the first Super Admin account.
-- Run only in the dedicated Bos Pangan Supabase project:
-- Project ID: pasiitgynpevahsfudlg
-- Register and verify this account on bospangan.com before running this script.

do $$
declare
  v_user_id uuid;
begin
  select id into v_user_id
  from auth.users
  where lower(email) = lower('forbuldozer@gmail.com')
  limit 1;

  if v_user_id is null then
    raise exception 'Account forbuldozer@gmail.com was not found. Register it on bospangan.com first, then run this script again.';
  end if;

  update public.profiles
  set role = 'super_admin', updated_at = now()
  where id = v_user_id;

  if not found then
    raise exception 'Profile for forbuldozer@gmail.com was not found. Check the profiles signup trigger before retrying.';
  end if;
end;
$$;

-- Verify the result. Expected role: super_admin.
select id, display_name, role
from public.profiles
where id = (select id from auth.users where lower(email) = lower('forbuldozer@gmail.com'));
