-- Bos Pangan profile table and access policies.
-- Run in Supabase SQL Editor after creating your project.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'member' check (role in ('member','affiliate','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select to authenticated using (auth.uid() = id);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, updated_at) on public.profiles to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Assign admin manually from SQL Editor only:
-- update public.profiles set role = 'admin' where id = '<AUTH_USER_UUID>';


-- Affiliate and dashboard foundation.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
for select to authenticated
using (auth.uid() = id or public.is_admin());

create table if not exists public.affiliate_applications (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  motivation text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
alter table public.affiliate_applications enable row level security;
grant select, insert on public.affiliate_applications to authenticated;
drop policy if exists "read own or admin affiliate applications" on public.affiliate_applications;
create policy "read own or admin affiliate applications" on public.affiliate_applications
for select to authenticated using (auth.uid() = user_id or public.is_admin());
drop policy if exists "apply as self" on public.affiliate_applications;
create policy "apply as self" on public.affiliate_applications
for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "admin review affiliate applications" on public.affiliate_applications;
create policy "admin review affiliate applications" on public.affiliate_applications
for update to authenticated using (public.is_admin()) with check (public.is_admin());

create table if not exists public.affiliate_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  referral_code text not null unique,
  status text not null default 'active' check (status in ('active','paused')),
  created_at timestamptz not null default now()
);
alter table public.affiliate_accounts enable row level security;
grant select on public.affiliate_accounts to authenticated;
drop policy if exists "read own or admin affiliate account" on public.affiliate_accounts;
create policy "read own or admin affiliate account" on public.affiliate_accounts
for select to authenticated using (auth.uid() = user_id or public.is_admin());

create table if not exists public.affiliate_referrals (
  id bigint generated always as identity primary key,
  affiliate_user_id uuid not null references public.affiliate_accounts(user_id) on delete cascade,
  referred_user_id uuid not null unique references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.affiliate_referrals enable row level security;
grant select on public.affiliate_referrals to authenticated;
drop policy if exists "affiliate reads own referrals or admin" on public.affiliate_referrals;
create policy "affiliate reads own referrals or admin" on public.affiliate_referrals
for select to authenticated using (auth.uid() = affiliate_user_id or public.is_admin());

create table if not exists public.affiliate_commissions (
  id bigint generated always as identity primary key,
  affiliate_user_id uuid not null references public.affiliate_accounts(user_id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending','approved','paid','rejected')),
  note text not null default '',
  created_at timestamptz not null default now()
);
alter table public.affiliate_commissions enable row level security;
grant select, insert, update on public.affiliate_commissions to authenticated;
drop policy if exists "affiliate reads own commissions or admin" on public.affiliate_commissions;
create policy "affiliate reads own commissions or admin" on public.affiliate_commissions
for select to authenticated using (auth.uid() = affiliate_user_id or public.is_admin());
drop policy if exists "admin manages commissions" on public.affiliate_commissions;
create policy "admin manages commissions" on public.affiliate_commissions
for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.admin_review_affiliate(p_user_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  update public.affiliate_applications
    set status = case when p_approve then 'approved' else 'rejected' end,
        reviewed_at = now()
    where user_id = p_user_id;
  if not found then
    raise exception 'Application not found';
  end if;
  if p_approve then
    update public.profiles set role = 'affiliate' where id = p_user_id;
    v_code := 'TWS' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    insert into public.affiliate_accounts(user_id, referral_code)
      values (p_user_id, v_code)
      on conflict (user_id) do nothing;
  end if;
end;
$$;
revoke all on function public.admin_review_affiliate(uuid, boolean) from public;
grant execute on function public.admin_review_affiliate(uuid, boolean) to authenticated;

create or replace function public.admin_set_user_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  if p_role not in ('member','affiliate','admin') then raise exception 'Invalid role'; end if;
  update public.profiles set role = p_role, updated_at = now() where id = p_user_id;
  if not found then raise exception 'User profile not found'; end if;
  if p_role = 'affiliate' then
    insert into public.affiliate_accounts(user_id, referral_code, status)
      values (p_user_id, 'TWS' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)), 'active')
      on conflict (user_id) do update set status = 'active';
  elsif p_role = 'member' or p_role = 'admin' then
    update public.affiliate_accounts set status = 'paused' where user_id = p_user_id;
  end if;
end;
$$;
revoke all on function public.admin_set_user_role(uuid, text) from public;
grant execute on function public.admin_set_user_role(uuid, text) to authenticated;

-- Attach new signups to a valid affiliate code supplied at registration.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;

  insert into public.affiliate_referrals (affiliate_user_id, referred_user_id)
  select a.user_id, new.id
  from public.affiliate_accounts as a
  where upper(a.referral_code) = upper(coalesce(new.raw_user_meta_data ->> 'referral_code', ''))
    and a.status = 'active'
    and coalesce(new.raw_user_meta_data ->> 'referral_code', '') <> ''
  on conflict (referred_user_id) do nothing;

  return new;
end;
$function$;
