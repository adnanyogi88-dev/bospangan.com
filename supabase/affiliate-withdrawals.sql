-- Affiliate withdrawal requests and admin payout workflow.
create table if not exists public.affiliate_payout_requests (
  id bigint generated always as identity primary key,
  affiliate_user_id uuid not null references public.affiliate_accounts(user_id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  payout_method text not null check (payout_method in ('bank','ewallet')),
  recipient_name text not null check (char_length(trim(recipient_name)) between 1 and 100),
  payout_destination text not null check (char_length(trim(payout_destination)) between 3 and 160),
  status text not null default 'pending' check (status in ('pending','approved','paid','rejected')),
  admin_note text not null default '',
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  paid_at timestamptz
);

create index if not exists affiliate_payout_requests_user_date_idx
  on public.affiliate_payout_requests(affiliate_user_id, requested_at desc);
alter table public.affiliate_payout_requests enable row level security;
revoke all on public.affiliate_payout_requests from anon, authenticated;
grant select on public.affiliate_payout_requests to authenticated;

drop policy if exists "affiliate reads own payout requests or admin" on public.affiliate_payout_requests;
create policy "affiliate reads own payout requests or admin"
on public.affiliate_payout_requests for select to authenticated
using (auth.uid() = affiliate_user_id or public.is_admin());

create or replace function public.request_affiliate_withdrawal(
  p_amount numeric,
  p_method text,
  p_destination text,
  p_recipient_name text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_available numeric(14,2);
  v_request_id bigint;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid withdrawal amount'; end if;
  if p_method not in ('bank','ewallet') then raise exception 'Invalid payout method'; end if;
  if char_length(trim(coalesce(p_destination,''))) not between 3 and 160 then raise exception 'Invalid payout destination'; end if;
  if char_length(trim(coalesce(p_recipient_name,''))) not between 1 and 100 then raise exception 'Invalid recipient name'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  if not exists (
    select 1 from public.affiliate_accounts
    where user_id = v_user_id and status = 'active'
  ) then raise exception 'Active affiliate account required'; end if;

  select
    coalesce((select sum(amount) from public.affiliate_commissions
      where affiliate_user_id = v_user_id and status = 'approved'), 0)
    -
    coalesce((select sum(amount) from public.affiliate_payout_requests
      where affiliate_user_id = v_user_id and status in ('pending','approved','paid')), 0)
  into v_available;

  if p_amount > v_available then raise exception 'Withdrawal exceeds available balance'; end if;

  insert into public.affiliate_payout_requests
    (affiliate_user_id, amount, payout_method, payout_destination, recipient_name)
  values
    (v_user_id, p_amount, p_method, trim(p_destination), trim(p_recipient_name))
  returning id into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.request_affiliate_withdrawal(numeric,text,text,text) from public;
grant execute on function public.request_affiliate_withdrawal(numeric,text,text,text) to authenticated;

create or replace function public.admin_update_payout_status(
  p_request_id bigint,
  p_status text,
  p_admin_note text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_status text;
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  if p_status not in ('approved','paid','rejected') then raise exception 'Invalid target status'; end if;

  select status into v_current_status
  from public.affiliate_payout_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'Payout request not found'; end if;

  if v_current_status = 'pending' and p_status not in ('approved','rejected') then
    raise exception 'Pending request can only be approved or rejected';
  elsif v_current_status = 'approved' and p_status not in ('paid','rejected') then
    raise exception 'Approved request can only be paid or rejected';
  elsif v_current_status not in ('pending','approved') then
    raise exception 'This request is already finalized';
  end if;

  update public.affiliate_payout_requests
  set status = p_status,
      admin_note = left(coalesce(p_admin_note,''),500),
      reviewed_at = case when v_current_status = 'pending' then now() else reviewed_at end,
      paid_at = case when p_status = 'paid' then now() else null end
  where id = p_request_id;
end;
$$;

revoke all on function public.admin_update_payout_status(bigint,text,text) from public;
grant execute on function public.admin_update_payout_status(bigint,text,text) to authenticated;
