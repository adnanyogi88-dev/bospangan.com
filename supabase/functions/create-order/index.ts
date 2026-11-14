import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "Server configuration is incomplete" }, 500);
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  try {
    const input = await req.json();
    const name = String(input.customer_name ?? "").trim().slice(0, 120);
    const email = String(input.customer_email ?? "").trim().toLowerCase().slice(0, 254);
    const phone = String(input.customer_phone ?? "").trim().slice(0, 32);
    const kind = input.transaction_type === "special" ? "special" : "regular";
    const specialRequest = String(input.special_request ?? "").trim().slice(0, 4000);
    const items = Array.isArray(input.items) ? input.items : [];
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.length < 7) {
      return json({ error: "Nama, email, dan nomor telepon yang valid wajib diisi." }, 400);
    }
    if (kind === "special" && specialRequest.length < 10) {
      return json({ error: "Jelaskan kebutuhan transaksi khusus minimal 10 karakter." }, 400);
    }
    if (kind === "regular" && (items.length < 1 || items.length > 50)) {
      return json({ error: "Pesanan reguler harus memiliki 1–50 item." }, 400);
    }

    const ids = [...new Set(items.map((x: any) => String(x.product_id ?? "")))];
    let products: any[] = [];
    if (kind === "regular") {
      const { data, error } = await db.from("products")
        .select("id,sku,name,price,stock,tax_percent,is_published")
        .in("id", ids).eq("is_published", true);
      if (error) throw error;
      products = data ?? [];
      if (products.length !== ids.length) return json({ error: "Satu atau lebih produk tidak tersedia." }, 400);
    }

    const { data: settings } = await db.from("store_settings").select("key,value")
      .in("key", ["default_tax_percent", "owner_notification_email", "email_notifications_enabled"]);
    const config = Object.fromEntries((settings ?? []).map((x: any) => [x.key, x.value]));
    const defaultTax = Number(config.default_tax_percent ?? 0);
    const map = new Map(products.map(p => [p.id, p]));
    const normalized = items.map((item: any) => {
      const p = map.get(String(item.product_id));
      const qty = Number(item.quantity);
      if (!p || !Number.isFinite(qty) || qty <= 0 || qty > 100000) throw new Error("Item atau jumlah pesanan tidak valid.");
      if (Number(p.stock) < qty) throw new Error("Stok tidak mencukupi untuk " + p.name + ".");
      return { product: p, quantity: qty, line: Number(p.price) * qty };
    });
    const subtotal = normalized.reduce((sum, x) => sum + x.line, 0);
    const taxPercent = normalized.length
      ? Math.max(...normalized.map(x => x.product.tax_percent == null ? defaultTax : Number(x.product.tax_percent)))
      : defaultTax;
    const taxAmount = Number((subtotal * taxPercent / 100).toFixed(2));
    const total = Number((subtotal + taxAmount).toFixed(2));

    const { data: authData } = await db.auth.getUser(
      req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? ""
    );
    const customerId = authData?.user?.id ?? null;

    const { data: order, error: orderError } = await db.from("orders").insert({
      customer_id: customerId, customer_name: name, customer_email: email, customer_phone: phone,
      transaction_type: kind, special_request: specialRequest, subtotal,
      tax_percent: taxPercent, tax_amount: taxAmount, total,
      status: kind === "special" ? "quoted" : "new",
    }).select("id,order_number,total,tax_amount,tax_percent,status").single();
    if (orderError) throw orderError;

    if (normalized.length) {
      const rows = normalized.map(x => ({
        order_id: order.id, product_id: x.product.id, sku_snapshot: x.product.sku,
        product_name_snapshot: x.product.name, unit_price: x.product.price,
        quantity: x.quantity, line_subtotal: x.line,
      }));
      const { error } = await db.from("order_items").insert(rows);
      if (error) {
        await db.from("orders").delete().eq("id", order.id);
        throw error;
      }
    }

    const ownerEmail = String(config.owner_notification_email ?? "").trim();
    if (ownerEmail && config.email_notifications_enabled !== false) {
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey) {
        const lines = normalized.map(x => `<li>${x.product.name} (${x.product.sku}) × ${x.quantity}</li>`).join("");
        const html = `<h2>Transaksi baru Bos Pangan</h2><p>Nomor: <b>${order.order_number}</b></p><p>Customer: ${name}<br>${email}<br>${phone}</p><p>Jenis: ${kind}</p><ul>${lines}</ul><p>Subtotal: Rp${subtotal.toLocaleString("id-ID")}<br>Pajak (${taxPercent}%): Rp${taxAmount.toLocaleString("id-ID")}<br><b>Total: Rp${total.toLocaleString("id-ID")}</b></p><p>${specialRequest}</p>`;
        const sent = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: Deno.env.get("EMAIL_FROM") ?? "Bos Pangan <onboarding@resend.dev>", to: [ownerEmail], subject: "Transaksi baru " + order.order_number, html }),
        });
        if (!sent.ok) {
          const { error: queueError } = await db.from("notification_queue").update({ status: "failed", last_error: "Email provider error" })
            .eq("event_type", "new_order").eq("recipient_email", ownerEmail).eq("status", "pending");
          console.error("Owner email failed", await sent.text(), queueError);
        } else {
          await db.from("notification_queue").update({ status: "sent", sent_at: new Date().toISOString() })
            .eq("event_type", "new_order").eq("recipient_email", ownerEmail).eq("status", "pending");
        }
      }
    }

    return json({ success: true, order });
  } catch (error) {
    console.error("create-order:", error);
    return json({ error: error instanceof Error ? error.message : "Unable to create order" }, 400);
  }
});
