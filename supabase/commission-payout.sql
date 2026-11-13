-- Commission approval and payout workflow for Bos Pangan.
alter table public.affiliate_commissions
  add column if not exists paid_at timestamptz;

create or replace function public.admin_update_commission_status(
  p_commission_id bigint,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_status text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  if p_status not in ('approved', 'paid', 'rejected') then
    raise exception 'Invalid target status';
  end if;

  select status into v_current_status
  from public.affiliate_commissions
  where id = p_commission_id
  for update;

  if not found then
    raise exception 'Commission not found';
  end if;

  if v_current_status = 'pending' and p_status not in ('approved', 'rejected') then
    raise exception 'Pending commission can only be approved or rejected';
  elsif v_current_status = 'approved' and p_status <> 'paid' then
    raise exception 'Approved commission can only be marked as paid';
  elsif v_current_status not in ('pending', 'approved') then
    raise exception 'This commission is already finalized';
  end if;

  update public.affiliate_commissions
  set status = p_status,
      paid_at = case when p_status = 'paid' then now() else null end
  where id = p_commission_id;
end;
$$;

revoke all on function public.admin_update_commission_status(bigint, text) from public;
grant execute on function public.admin_update_commission_status(bigint, text) to authenticated;
