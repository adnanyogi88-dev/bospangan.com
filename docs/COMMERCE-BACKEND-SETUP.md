# Bos Pangan Commerce Backend

This repository now includes a Supabase commerce backend foundation alongside the existing membership/affiliate system.

## What is included

- Role model: member, affiliate, admin, super_admin.
- Product catalog table with SKU, eight approved categories, stock, price, per-product tax override, up to five image URLs, and YouTube URL.
- Public product image bucket with admin-only write access.
- Orders and immutable order-item snapshots, including regular and special/quotation transactions.
- Order tax snapshots and configurable default tax rate.
- Owner order-email notification queue.
- Product email/push campaign records with opt-in recipient sources.
- Admin audit log and browser push subscription storage.
- Dashboard Commerce Control Center for product CRUD, order status, campaigns, and super-admin store settings.
- Supabase Edge Functions for secure order creation and product campaign delivery.

## Setup

1. Open the Supabase project already configured in `auth-config.js`.
2. Run `supabase/commerce-backend.sql` in Supabase SQL Editor after the existing `supabase/schema.sql` and affiliate migrations have been applied.
3. Register the account that should become the first Super Admin.
4. Edit `supabase/initial-super-admin.sql`, replace `REPLACE_WITH_YOUR_EMAIL` with that account's email, and run it in SQL Editor.
5. In the Super Admin dashboard, set the owner notification email and default tax percentage.
6. Configure Edge Function secrets:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-side only; never add to frontend files)
   - `RESEND_API_KEY`
   - `EMAIL_FROM` (must be a verified sender/domain in Resend)
   - `ALLOWED_ORIGIN` (production website origin)
   - For browser push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
7. Deploy functions with Supabase CLI:
   ```sh
   supabase functions deploy create-order
   supabase functions deploy send-product-campaign
   ```
8. The website must be redeployed after dashboard/frontend changes.

## Edge Function API

### POST /functions/v1/create-order

Accepts:
```json
{
  "customer_name": "Nama pelanggan",
  "customer_email": "customer@example.com",
  "customer_phone": "08xxxxxxxxxx",
  "transaction_type": "regular",
  "items": [{"product_id": "PRODUCT_UUID", "quantity": 2}]
}
```

For a special transaction, send `transaction_type: "special"` and a `special_request` describing the required goods/volume/timing. The function calculates tax server-side from the product override or store default and creates the order.

### POST /functions/v1/send-product-campaign

Requires a signed-in admin/super_admin bearer token and `campaign_id`. It sends only to notification recipients who have opted in. Email delivery requires Resend. Push delivery requires VAPID secrets and registered browser subscriptions.

## Important operational notes

- Do not put the Supabase service-role key or Resend API key in browser JavaScript.
- The initial Super Admin must be assigned from SQL Editor by the project owner.
- Configure tax rates with your finance/tax advisor; the default is 0% until changed.
- Verify the sender domain in Resend before sending campaigns.
- Scheduled campaign records are stored with their scheduled time. Automatic scheduled dispatch requires a Supabase Cron/HTTP schedule invoking the campaign function.
- Browser push requires a service worker and an explicit customer permission/subscribe flow; the VAPID keys alone are not sufficient.
