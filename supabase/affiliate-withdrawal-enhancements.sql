-- Minimum withdrawal, saved payout destination, and payment reference.
alter table public.affiliate_payout_requests add column if not exists payment_reference text not null default '';
create table if not exists public.affiliate_payout_profiles (
 user_id uuid primary key references public.affiliate_accounts(user_id) on delete cascade,
 payout_method text not null check (payout_method in ('bank','ewallet')),
 recipient_name text not null check (char_length(trim(recipient_name)) between 1 and 100),
 payout_destination text not null check (char_length(trim(payout_destination)) between 3 and 160),
 updated_at timestamptz not null default now()
);
alter table public.affiliate_payout_profiles enable row level security;
revoke all on public.affiliate_payout_profiles from anon, authenticated;
grant select, insert, update on public.affiliate_payout_profiles to authenticated;
drop policy if exists "affiliate manages own payout profile" on public.affiliate_payout_profiles;
create policy "affiliate manages own payout profile" on public.affiliate_payout_profiles
for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.request_affiliate_withdrawal(p_amount numeric,p_method text,p_destination text,p_recipient_name text)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare v_user_id uuid := auth.uid(); v_available numeric(14,2); v_request_id bigint;
begin
 if v_user_id is null then raise exception 'Authentication required'; end if;
 if p_amount is null or p_amount < 50000 then raise exception 'Minimum withdrawal is Rp50,000'; end if;
 if p_method not in ('bank','ewallet') then raise exception 'Invalid payout method'; end if;
 if char_length(trim(coalesce(p_destination,''))) not between 3 and 160 then raise exception 'Invalid payout destination'; end if;
 if char_length(trim(coalesce(p_recipient_name,''))) not between 1 and 100 then raise exception 'Invalid recipient name'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_user_id::text,0));
 if not exists(select 1 from public.affiliate_accounts where user_id=v_user_id and status='active') then raise exception 'Active affiliate account required'; end if;
 select coalesce((select sum(amount) from public.affiliate_commissions where affiliate_user_id=v_user_id and status='approved'),0)
 - coalesce((select sum(amount) from public.affiliate_payout_requests where affiliate_user_id=v_user_id and status in ('pending','approved','paid')),0)
 into v_available;
 if p_amount > v_available then raise exception 'Withdrawal exceeds available balance'; end if;
 insert into public.affiliate_payout_requests(affiliate_user_id,amount,payout_method,payout_destination,recipient_name)
 values(v_user_id,p_amount,p_method,trim(p_destination),trim(p_recipient_name)) returning id into v_request_id;
 return v_request_id;
end; $$;
revoke all on function public.request_affiliate_withdrawal(numeric,text,text,text) from public;
grant execute on function public.request_affiliate_withdrawal(numeric,text,text,text) to authenticated;

create or replace function public.admin_update_payout_status(p_request_id bigint,p_status text,p_admin_note text default '')
returns void language plpgsql security definer set search_path = ''
as $$
declare v_current_status text;
begin
 if not public.is_admin() then raise exception 'Not authorized'; end if;
 if p_status not in ('approved','paid','rejected') then raise exception 'Invalid target status'; end if;
 if p_status='paid' and char_length(trim(coalesce(p_admin_note,'')))<3 then raise exception 'Payment reference is required before marking paid'; end if;
 select status into v_current_status from public.affiliate_payout_requests where id=p_request_id for update;
 if not found then raise exception 'Payout request not found'; end if;
 if v_current_status='pending' and p_status not in ('approved','rejected') then raise exception 'Pending request can only be approved or rejected';
 elsif v_current_status='approved' and p_status not in ('paid','rejected') then raise exception 'Approved request can only be paid or rejected';
 elsif v_current_status not in ('pending','approved') then raise exception 'This request is already finalized'; end if;
 update public.affiliate_payout_requests set status=p_status,admin_note=left(coalesce(p_admin_note,''),500),
 payment_reference=case when p_status='paid' then left(trim(p_admin_note),160) else payment_reference end,
 reviewed_at=case when v_current_status='pending' then now() else reviewed_at end,
 paid_at=case when p_status='paid' then now() else null end where id=p_request_id;
end; $$;
revoke all on function public.admin_update_payout_status(bigint,text,text) from public;
grant execute on function public.admin_update_payout_status(bigint,text,text) to authenticated;
