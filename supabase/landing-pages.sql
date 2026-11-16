-- Bos Pangan Landing Page CMS
create table if not exists public.landing_pages (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  excerpt text not null default '',
  content_html text not null default '',
  primary_image_url text,
  meta_title text not null default '',
  meta_description text not null default '',
  status text not null default 'draft' check (status in ('draft','published')),
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint landing_pages_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
create index if not exists landing_pages_status_published_idx
  on public.landing_pages(status, published_at desc);
alter table public.landing_pages enable row level security;

create or replace function public.is_landing_page_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('admin','super_admin')
  );
$$;
revoke all on function public.is_landing_page_admin() from public;
grant execute on function public.is_landing_page_admin() to authenticated;

drop policy if exists "Public can read published landing pages" on public.landing_pages;
create policy "Public can read published landing pages"
  on public.landing_pages for select to anon, authenticated
  using (status = 'published' or public.is_landing_page_admin());

drop policy if exists "Admins create landing pages" on public.landing_pages;
create policy "Admins create landing pages"
  on public.landing_pages for insert to authenticated
  with check (public.is_landing_page_admin() and created_by = auth.uid());

drop policy if exists "Admins update landing pages" on public.landing_pages;
create policy "Admins update landing pages"
  on public.landing_pages for update to authenticated
  using (public.is_landing_page_admin())
  with check (public.is_landing_page_admin());

drop policy if exists "Admins delete landing pages" on public.landing_pages;
create policy "Admins delete landing pages"
  on public.landing_pages for delete to authenticated
  using (public.is_landing_page_admin());

grant select on public.landing_pages to anon, authenticated;
grant insert, update, delete on public.landing_pages to authenticated;

-- Public image delivery; only admin/super admin may upload or modify files.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('landing-page-images','landing-page-images',true,8388608,
  array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 8388608,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "Public can view landing page images" on storage.objects;
create policy "Public can view landing page images" on storage.objects
for select to anon, authenticated using (bucket_id = 'landing-page-images');

drop policy if exists "Admins upload landing page images" on storage.objects;
create policy "Admins upload landing page images" on storage.objects
for insert to authenticated with check (
  bucket_id = 'landing-page-images' and public.is_landing_page_admin()
);

drop policy if exists "Admins update landing page images" on storage.objects;
create policy "Admins update landing page images" on storage.objects
for update to authenticated using (
  bucket_id = 'landing-page-images' and public.is_landing_page_admin()
) with check (
  bucket_id = 'landing-page-images' and public.is_landing_page_admin()
);

drop policy if exists "Admins delete landing page images" on storage.objects;
create policy "Admins delete landing page images" on storage.objects
for delete to authenticated using (
  bucket_id = 'landing-page-images' and public.is_landing_page_admin()
);
