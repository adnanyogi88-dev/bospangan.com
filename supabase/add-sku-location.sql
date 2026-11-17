-- Bos Pangan: add a dedicated storage/location field for each SKU.
-- Safe to run on an existing database; does not alter existing product records.
alter table public.products
  add column if not exists sku_location text not null default '';

comment on column public.products.sku_location is
  'Physical storage location for this product SKU, e.g. Rack A-01 / Gudang 1.';
