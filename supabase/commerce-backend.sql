-- Bos Pangan commerce backend foundation
-- Run after the existing supabase/schema.sql and affiliate migrations.
-- Never expose the Supabase service-role key in browser code.

begin;

-- 1) Roles: member, affiliate, admin, super_admin.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('member','affiliate','admin','super_admin'));

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('admin','super_admin')
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'super_admin'
  );
$$;
revoke all on function public.is_super_admin() from public;
grant execute on function public.is_super_admin() to authenticated;

create or replace function public.admin_set_user_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  if p_role not in ('member','affiliate','admin','super_admin') then
    raise exception 'Invalid role';
  end if;
  if p_role in ('admin','super_admin') and not public.is_super_admin() then
    raise exception 'Only super admin can assign admin privileges';
  end if;
  if exists (select 1 from public.profiles where id=p_user_id and role='super_admin')
     and not public.is_super_admin() then
    raise exception 'Only super admin can modify a super admin';
  end if;
  update public.profiles set role=p_role, updated_at=now() where id=p_user_id;
  if not found then raise exception 'User profile not found'; end if;
  if p_role='affiliate' then
    insert into public.affiliate_accounts(user_id, referral_code, status)
    values (p_user_id, 'BOS' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)), 'active')
    on conflict (user_id) do update set status='active';
  elsif p_role in ('member','admin','super_admin') then
    update public.affiliate_accounts set status='paused' where user_id=p_user_id;
  end if;
end;
$$;
revoke all on function public.admin_set_user_role(uuid,text) from public;
grant execute on function public.admin_set_user_role(uuid,text) to authenticated;

-- 2) System settings. Tax and owner email are editable from a restricted admin UI.
create table if not exists public.store_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.store_settings enable row level security;
drop policy if exists "admin reads store settings" on public.store_settings;
create policy "admin reads store settings" on public.store_settings
for select to authenticated using (public.is_admin());
drop policy if exists "super admin manages store settings" on public.store_settings;
create policy "super admin manages store settings" on public.store_settings
for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
insert into public.store_settings(key,value) values
 ('default_tax_percent','0'::jsonb),
 ('owner_notification_email','""'::jsonb),
 ('store_currency','"IDR"'::jsonb),
 ('email_notifications_enabled','true'::jsonb),
 ('push_notifications_enabled','true'::jsonb)
on conflict (key) do nothing;
grant select, insert, update, delete on public.store_settings to authenticated;

-- 3) Products and product media.
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  slug text not null unique,
  category text not null check (category in ('Daging sapi','Ikan','Ayam','Sayuran','Minyak','Beras','Bumbu dapur','Buah')),
  description text not null default '',
  price numeric(14,2) not null default 0 check (price >= 0),
  stock numeric(14,3) not null default 0 check (stock >= 0),
  unit text not null default 'pcs',
  tax_percent numeric(5,2) check (tax_percent between 0 and 100),
  image_urls text[] not null default '{}',
  youtube_url text,
  is_published boolean not null default false,
  is_featured boolean not null default false,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_max_five_images check (cardinality(image_urls) <= 5)
);
create index if not exists products_category_published_idx on public.products(category,is_published);
create index if not exists products_created_at_idx on public.products(created_at desc);
alter table public.products enable row level security;
drop policy if exists "public reads published products" on public.products;
create policy "public reads published products" on public.products
for select to anon, authenticated using (is_published or public.is_admin());
drop policy if exists "admins manage products" on public.products;
create policy "admins manage products" on public.products
for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;

-- Product image bucket; public reads, admins upload/update/delete.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('product-images','product-images',true,8388608,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=true, file_size_limit=8388608,
  allowed_mime_types=array['image/jpeg','image/png','image/webp'];
drop policy if exists "public reads Bos Pangan product images" on storage.objects;
create policy "public reads Bos Pangan product images" on storage.objects
for select to anon, authenticated using (bucket_id='product-images');
drop policy if exists "admins upload Bos Pangan product images" on storage.objects;
create policy "admins upload Bos Pangan product images" on storage.objects
for insert to authenticated with check (bucket_id='product-images' and public.is_admin());
drop policy if exists "admins update Bos Pangan product images" on storage.objects;
create policy "admins update Bos Pangan product images" on storage.objects
for update to authenticated using (bucket_id='product-images' and public.is_admin())
with check (bucket_id='product-images' and public.is_admin());
drop policy if exists "admins delete Bos Pangan product images" on storage.objects;
create policy "admins delete Bos Pangan product images" on storage.objects
for delete to authenticated using (bucket_id='product-images' and public.is_admin());

-- 4) Orders, order lines, special transaction requests.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('BOS-' || to_char(now(),'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  customer_id uuid references auth.users(id),
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  transaction_type text not null default 'regular' check (transaction_type in ('regular','special')),
  special_request text not null default '',
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  tax_percent numeric(5,2) not null default 0 check (tax_percent between 0 and 100),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  status text not null default 'new' check (status in ('new','confirmed','processing','shipped','completed','cancelled','quoted')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','pending','paid','refunded')),
  admin_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_created_at_idx on public.orders(created_at desc);
create index if not exists orders_customer_email_idx on public.orders(lower(customer_email));
alter table public.orders enable row level security;
drop policy if exists "customers create orders" on public.orders;
create policy "customers create orders" on public.orders
for insert to anon, authenticated with check (
  (customer_id is null and auth.uid() is null)
  or customer_id = auth.uid()
);
drop policy if exists "admins manage orders" on public.orders;
create policy "admins manage orders" on public.orders
for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant insert on public.orders to anon, authenticated;
grant select, update on public.orders to authenticated;

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  sku_snapshot text not null,
  product_name_snapshot text not null,
  unit_price numeric(14,2) not null check (unit_price >= 0),
  quantity numeric(14,3) not null check (quantity > 0),
  line_subtotal numeric(14,2) not null check (line_subtotal >= 0),
  created_at timestamptz not null default now()
);
alter table public.order_items enable row level security;
drop policy if exists "admins manage order items" on public.order_items;
create policy "admins manage order items" on public.order_items
for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.order_items to authenticated;

-- 5) Email/push preferences, product campaigns, delivery queue and audit trail.
create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  customer_name text not null default '',
  email_opt_in boolean not null default false,
  push_opt_in boolean not null default false,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;
drop policy if exists "admins manage notification preferences" on public.notification_preferences;
create policy "admins manage notification preferences" on public.notification_preferences
for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.notification_preferences to authenticated;

create table if not exists public.product_campaigns (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  title text not null,
  subject text not null,
  body_html text not null,
  channel text not null check (channel in ('email','push','both')),
  audience text not null default 'product_subscribers' check (audience in ('product_subscribers','all_opted_in')),
  status text not null default 'draft' check (status in ('draft','scheduled','sending','sent','failed','cancelled')),
  scheduled_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.product_campaigns enable row level security;
drop policy if exists "admins manage product campaigns" on public.product_campaigns;
create policy "admins manage product campaigns" on public.product_campaigns
for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.product_campaigns to authenticated;

create table if not exists public.notification_queue (
  id bigint generated always as identity primary key,
  event_type text not null,
  recipient_email text not null,
  subject text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists notification_queue_pending_idx on public.notification_queue(status,created_at);
alter table public.notification_queue enable row level security;
drop policy if exists "admins read notification queue" on public.notification_queue;
create policy "admins read notification queue" on public.notification_queue
for select to authenticated using (public.is_admin());
grant select on public.notification_queue to authenticated;

create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_id uuid references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);
alter table public.web_push_subscriptions enable row level security;
drop policy if exists "admins manage web push subscriptions" on public.web_push_subscriptions;
create policy "admins manage web push subscriptions" on public.web_push_subscriptions
for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.web_push_subscriptions to authenticated;

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
drop policy if exists "admins read audit log" on public.admin_audit_log;
create policy "admins read audit log" on public.admin_audit_log
for select to authenticated using (public.is_admin());
grant select on public.admin_audit_log to authenticated;

-- Queue an owner email when a new order is created. Actual sending is performed
-- server-side by a Supabase Edge Function using RESEND_API_KEY.
create or replace function public.queue_owner_order_notification()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_email text;
begin
  select value #>> '{}' into v_email from public.store_settings where key='owner_notification_email';
  if coalesce(v_email,'') <> '' then
    insert into public.notification_queue(event_type,recipient_email,subject,payload)
    values (
      'new_order', v_email, 'Pesanan baru Bos Pangan: ' || new.order_number,
      jsonb_build_object('order_id',new.id,'order_number',new.order_number,
        'customer_name',new.customer_name,'customer_email',new.customer_email,
        'total',new.total,'transaction_type',new.transaction_type)
    );
  end if;
  return new;
end;
$$;
drop trigger if exists trg_queue_owner_order_notification on public.orders;
create trigger trg_queue_owner_order_notification after insert on public.orders
for each row execute function public.queue_owner_order_notification();

commit;


-- Product-specific opt-in subscriptions and per-line tax snapshots.
create table if not exists public.product_notification_subscriptions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  email text not null,
  consented_at timestamptz not null default now(),
  unique(product_id,email)
);
alter table public.product_notification_subscriptions enable row level security;
drop policy if exists "admins manage product subscriptions" on public.product_notification_subscriptions;
create policy "admins manage product subscriptions" on public.product_notification_subscriptions
for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.product_notification_subscriptions to authenticated;
alter table public.order_items add column if not exists tax_percent numeric(5,2) not null default 0 check (tax_percent between 0 and 100);
alter table public.order_items add column if not exists tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0);

-- Allow signed-in customers to register their own browser push subscription.
drop policy if exists "users register own push subscription" on public.web_push_subscriptions;
create policy "users register own push subscription" on public.web_push_subscriptions
for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "users read own push subscription" on public.web_push_subscriptions;
create policy "users read own push subscription" on public.web_push_subscriptions
for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "users delete own push subscription" on public.web_push_subscriptions;
create policy "users delete own push subscription" on public.web_push_subscriptions
for delete to authenticated using (user_id = auth.uid() or public.is_admin());
