import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/auth-config.js";

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const categories = ["Daging sapi","Ikan","Ayam","Sayuran","Minyak","Beras","Bumbu dapur","Buah"];
const money = n => "Rp" + Number(n || 0).toLocaleString("id-ID");
let user, role, editingId = null;

function panelMarkup() {
  const section = document.createElement("section");
  section.className = "panel";
  section.id = "commerceAdmin";
  section.innerHTML = `
    <h2>Commerce Control Center</h2>
    <p class="muted">Pengelolaan katalog, SKU, pajak, pesanan, transaksi khusus, dan campaign Bos Pangan.</p>
    <div class="tabs" style="margin:12px 0">
      <button type="button" data-tab="products" class="active">Produk</button>
      <button type="button" data-tab="orders">Transaksi</button>
      <button type="button" data-tab="campaigns">Email & Push</button>
      <button type="button" data-tab="settings" class="${role === "super_admin" ? "" : "hidden"}">Pengaturan</button>
    </div>
    <p id="commerceStatus" class="status" role="status">Panel siap.</p>
    <div id="tab-products">
      <form id="productForm" class="panel">
        <h3 id="productFormTitle">Tambah produk</h3>
        <div class="row">
          <label>Nama produk<input name="name" maxlength="160" required></label>
          <label>SKU<input name="sku" maxlength="64" required></label>
        </div>
        <div class="row">
          <label>Kategori<select name="category" required>${categories.map(c=>'<option>'+c+'</option>').join("")}</select></label>
          <label>Harga (Rp)<input name="price" type="number" min="0" step="0.01" required></label>
          <label>Stok<input name="stock" type="number" min="0" step="0.001" value="0" required></label>
          <label>Satuan<input name="unit" maxlength="24" value="pcs" required></label>
        </div>
        <label>Deskripsi<textarea name="description" rows="3" maxlength="5000"></textarea></label>
        <div class="row">
          <label>Pajak produk (%)<input name="tax_percent" type="number" min="0" max="100" step="0.01" placeholder="Kosongkan untuk ikut pajak default"></label>
          <label>Video YouTube (URL)<input name="youtube_url" type="url" placeholder="https://www.youtube.com/watch?v=..."></label>
        </div>
        <label>Foto produk (maksimal 5; JPG, PNG, WebP; maks. 8 MB/foto)<input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple></label>
        <div class="row"><label><span><input name="is_published" type="checkbox" style="width:auto"> Publikasikan produk</span></label><label><span><input name="is_featured" type="checkbox" style="width:auto"> Produk unggulan</span></label></div>
        <div class="row"><button class="primary" type="submit">Simpan produk</button><button type="button" id="cancelEdit">Reset form</button></div>
        <div id="currentImages" class="muted"></div>
      </form>
      <div id="productsTable" class="table-wrap"></div>
    </div>
    <div id="tab-orders" class="hidden">
      <h3>Daftar transaksi</h3><p class="muted">Termasuk pesanan reguler dan permintaan transaksi khusus/penawaran.</p>
      <div id="ordersTable" class="table-wrap"></div>
    </div>
    <div id="tab-campaigns" class="hidden">
      <form id="campaignForm" class="panel">
        <h3>Buat campaign produk</h3>
        <label>Produk<select name="product_id" id="campaignProduct" required></select></label>
        <label>Judul campaign<input name="title" maxlength="140" required></label>
        <label>Subject email<input name="subject" maxlength="180" required></label>
        <label>Isi pesan<textarea name="body_html" rows="5" required placeholder="Tulis informasi produk dan ajakan yang jelas."></textarea></label>
        <div class="row">
          <label>Channel<select name="channel"><option value="email">Email</option><option value="push">Push notification</option><option value="both">Email + Push</option></select></label>
          <label>Target<select name="audience"><option value="product_subscribers">Pelanggan yang memilih notifikasi produk ini</option><option value="all_opted_in">Semua pelanggan yang memberi izin</option></select></label>
          <label>Jadwal (opsional)<input name="scheduled_at" type="datetime-local"></label>
        </div>
        <button class="primary">Simpan campaign</button>
      </form>
      <div id="campaignsTable" class="table-wrap"></div>
    </div>
    <div id="tab-settings" class="${role === "super_admin" ? "" : "hidden"}">
      <form id="settingsForm" class="panel">
        <h3>Pengaturan toko (Super Admin)</h3>
        <label>Email owner untuk notifikasi transaksi<input name="owner_email" type="email" maxlength="254" required></label>
        <label>Pajak default katalog (%)<input name="tax_percent" type="number" min="0" max="100" step="0.01" required></label>
        <label><span><input name="email_enabled" type="checkbox" style="width:auto"> Aktifkan notifikasi email</span></label>
        <label><span><input name="push_enabled" type="checkbox" style="width:auto"> Aktifkan push notification</span></label>
        <button class="primary">Simpan pengaturan</button>
      </form>
    </div>`;
  $("adminView").append(section);
  section.querySelectorAll("[data-tab]").forEach(button => button.onclick = () => {
    section.querySelectorAll("[data-tab]").forEach(b=>b.classList.toggle("active",b===button));
    ["products","orders","campaigns","settings"].forEach(tab=>$("tab-"+tab).classList.toggle("hidden",tab!==button.dataset.tab));
  });
  return section;
}
function message(text){$("commerceStatus").textContent=text;}
function slugify(value){return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,150);}
function resetForm(){
  editingId=null;$("productForm").reset();$("productFormTitle").textContent="Tambah produk";$("currentImages").textContent="";
}
async function uploadImages(files, oldUrls=[]){
  if(files.length>5) throw new Error("Maksimal 5 foto produk.");
  const urls=[...oldUrls];
  for(const file of files){
    if(!["image/jpeg","image/png","image/webp"].includes(file.type)) throw new Error("Format foto harus JPG, PNG, atau WebP.");
    if(file.size>8*1024*1024) throw new Error("Ukuran setiap foto maksimal 8 MB.");
    const path=`${crypto.randomUUID()}-${slugify(file.name)}`;
    const {error}=await db.storage.from("product-images").upload(path,file,{contentType:file.type,upsert:false});
    if(error)throw error;
    const {data}=db.storage.from("product-images").getPublicUrl(path);
    urls.push(data.publicUrl);
  }
  if(urls.length>5) throw new Error("Total foto produk maksimal 5.");
  return urls;
}
async function loadProducts(){
  const {data,error}=await db.from("products").select("*").order("created_at",{ascending:false});
  if(error)throw error;
  $("productsTable").innerHTML=data.length?'<table><thead><tr><th>Produk</th><th>SKU</th><th>Kategori</th><th>Harga</th><th>Status</th><th>Aksi</th></tr></thead><tbody>'+
    data.map(p=>'<tr><td>'+esc(p.name)+'</td><td>'+esc(p.sku)+'</td><td>'+esc(p.category)+'</td><td>'+money(p.price)+'</td><td>'+(p.is_published?"Tayang":"Draft")+'</td><td><button data-edit="'+p.id+'">Edit</button> <button data-delete="'+p.id+'">Hapus</button></td></tr>').join("")+'</tbody></table>':'<p class="muted">Belum ada produk dari dashboard.</p>';
  $("campaignProduct").innerHTML=data.map(p=>'<option value="'+p.id+'">'+esc(p.name)+' · '+esc(p.sku)+'</option>').join("");
  $("productsTable").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>editProduct(data.find(p=>p.id===b.dataset.edit)));
  $("productsTable").querySelectorAll("[data-delete]").forEach(b=>b.onclick=async()=>{if(!confirm("Hapus produk ini? Riwayat transaksi akan tetap menyimpan snapshot produk."))return;const {error}=await db.from("products").delete().eq("id",b.dataset.delete);if(error)message(error.message);else{message("Produk dihapus.");await loadProducts();}});
}
function editProduct(p){
  editingId=p.id;const f=$("productForm").elements;
  for(const key of ["name","sku","category","price","stock","unit","description","tax_percent","youtube_url"])f[key].value=p[key]??"";
  f.is_published.checked=p.is_published;f.is_featured.checked=p.is_featured;
  $("productFormTitle").textContent="Edit produk · "+p.sku;
  $("currentImages").textContent="Foto tersimpan: "+(p.image_urls||[]).length+". Foto baru akan ditambahkan; pilih ulang maksimal 5 foto total.";
  window.scrollTo({top:$("commerceAdmin").offsetTop,behavior:"smooth"});
}
$("commerceAdmin") || null;
async function loadOrders(){
  const {data,error}=await db.from("orders").select("id,order_number,customer_name,customer_email,customer_phone,transaction_type,total,tax_amount,status,payment_status,created_at,special_request").order("created_at",{ascending:false}).limit(100);
  if(error)throw error;
  $("ordersTable").innerHTML=data.length?'<table><thead><tr><th>Nomor</th><th>Pelanggan</th><th>Jenis</th><th>Total / Pajak</th><th>Status</th><th>Ubah status</th></tr></thead><tbody>'+
    data.map(o=>'<tr><td>'+esc(o.order_number)+'<br><small>'+new Date(o.created_at).toLocaleString("id-ID")+'</small></td><td>'+esc(o.customer_name)+'<br>'+esc(o.customer_email)+'<br>'+esc(o.customer_phone)+'</td><td>'+esc(o.transaction_type)+(o.special_request?'<br><small>'+esc(o.special_request)+'</small>':"")+'</td><td>'+money(o.total)+'<br><small>Pajak '+money(o.tax_amount)+'</small></td><td>'+esc(o.status)+' / '+esc(o.payment_status)+'</td><td><select data-order-status="'+o.id+'"><option>new</option><option>quoted</option><option>confirmed</option><option>processing</option><option>shipped</option><option>completed</option><option>cancelled</option></select></td></tr>').join("")+'</tbody></table>':'<p class="muted">Belum ada transaksi.</p>';
  $("ordersTable").querySelectorAll("[data-order-status]").forEach(sel=>{const o=data.find(x=>x.id===sel.dataset.orderStatus);sel.value=o.status;sel.onchange=async()=>{const {error}=await db.from("orders").update({status:sel.value,updated_at:new Date().toISOString()}).eq("id",o.id);message(error?error.message:"Status transaksi diperbarui.");};});
}
async function loadCampaigns(){
  const {data,error}=await db.from("product_campaigns").select("id,title,subject,channel,audience,status,scheduled_at,created_at").order("created_at",{ascending:false}).limit(50);
  if(error)throw error;
  $("campaignsTable").innerHTML=data.length?'<table><thead><tr><th>Campaign</th><th>Channel / Target</th><th>Status</th><th>Jadwal</th><th>Aksi</th></tr></thead><tbody>'+
   data.map(c=>'<tr><td>'+esc(c.title)+'<br><small>'+esc(c.subject)+'</small></td><td>'+esc(c.channel)+' / '+esc(c.audience)+'</td><td>'+esc(c.status)+'</td><td>'+esc(c.scheduled_at||"—")+'</td><td>'+(c.status==="draft"||c.status==="scheduled"?'<button data-send-campaign="'+c.id+'">Kirim sekarang</button>':"—")+'</td></tr>').join("")+'</tbody></table>':'<p class="muted">Belum ada campaign.</p>';
  $("campaignsTable").querySelectorAll("[data-send-campaign]").forEach(b=>b.onclick=async()=>{if(!confirm("Kirim campaign ini kepada pelanggan yang sudah memberi izin?"))return;b.disabled=true;const {data:{session}}=await db.auth.getSession();const response=await fetch(SUPABASE_URL+"/functions/v1/send-product-campaign",{method:"POST",headers:{Authorization:"Bearer "+session.access_token,"Content-Type":"application/json"},body:JSON.stringify({campaign_id:b.dataset.sendCampaign})});const result=await response.json().catch(()=>({}));message(response.ok?"Campaign diproses. "+(result.sent??0)+" email terkirim.":(result.error||"Gagal mengirim campaign."));b.disabled=false;await loadCampaigns();});
}
async function loadSettings(){
  if(role!=="super_admin")return;
  const {data,error}=await db.from("store_settings").select("key,value");
  if(error)throw error;const v=Object.fromEntries(data.map(x=>[x.key,x.value]));
  const f=$("settingsForm").elements;
  f.owner_email.value=String(v.owner_notification_email||"").replace(/^"|"$/g,"");
  f.tax_percent.value=Number(v.default_tax_percent??0);
  f.email_enabled.checked=v.email_notifications_enabled!==false;
  f.push_enabled.checked=v.push_notifications_enabled!==false;
}
$("commerceAdmin")?.addEventListener("submit",()=>{});
function wireForms(){
  $("productForm").onsubmit=async e=>{
    e.preventDefault();const f=e.currentTarget.elements;const button=e.submitter;button.disabled=true;
    try{
      const existing=editingId?(await db.from("products").select("image_urls").eq("id",editingId).single()).data:null;
      const selected=[...f.images.files];const images=await uploadImages(selected,existing?.image_urls||[]);
      const name=f.name.value.trim(),sku=f.sku.value.trim().toUpperCase();
      const payload={name,sku,slug:slugify(name)+"-"+slugify(sku),category:f.category.value,price:Number(f.price.value),stock:Number(f.stock.value),unit:f.unit.value.trim(),description:f.description.value.trim(),tax_percent:f.tax_percent.value===""?null:Number(f.tax_percent.value),youtube_url:f.youtube_url.value.trim()||null,image_urls:images,is_published:f.is_published.checked,is_featured:f.is_featured.checked,updated_by:user.id};
      if(editingId){const {error}=await db.from("products").update(payload).eq("id",editingId);if(error)throw error;}
      else{payload.created_by=user.id;const {error}=await db.from("products").insert(payload);if(error)throw error;}
      resetForm();message("Produk berhasil disimpan.");await loadProducts();
    }catch(err){message("Gagal menyimpan produk: "+(err.message||err));}finally{button.disabled=false;}
  };
  $("cancelEdit").onclick=resetForm;
  $("campaignForm").onsubmit=async e=>{
    e.preventDefault();const f=e.currentTarget.elements;
    const payload={product_id:f.product_id.value,title:f.title.value.trim(),subject:f.subject.value.trim(),body_html:f.body_html.value.trim(),channel:f.channel.value,audience:f.audience.value,status:f.scheduled_at.value?"scheduled":"draft",scheduled_at:f.scheduled_at.value?new Date(f.scheduled_at.value).toISOString():null,created_by:user.id};
    const {error}=await db.from("product_campaigns").insert(payload);if(error)message(error.message);else{e.currentTarget.reset();message("Campaign disimpan. Admin dapat mengirimnya setelah ditinjau.");await loadCampaigns();}
  };
  $("settingsForm")?.addEventListener("submit",async e=>{
    e.preventDefault();if(role!=="super_admin")return;
    const f=e.currentTarget.elements;const rows=[
      ["owner_notification_email",f.owner_email.value.trim()],
      ["default_tax_percent",Number(f.tax_percent.value)],
      ["email_notifications_enabled",f.email_enabled.checked],
      ["push_notifications_enabled",f.push_enabled.checked]
    ];
    const {error}=await db.from("store_settings").upsert(rows.map(([key,value])=>({key,value:JSON.stringify(value),updated_by:user.id,updated_at:new Date().toISOString()})),{onConflict:"key"});
    message(error?error.message:"Pengaturan toko tersimpan.");
  });
}
async function init(){
 const {data:{session}}=await db.auth.getSession();if(!session)return;
 user=session.user;const {data:profile,error}=await db.from("profiles").select("role").eq("id",user.id).single();
 if(error||!["admin","super_admin"].includes(profile?.role))return;
 role=profile.role;
 if(role==="super_admin"){$("memberView").classList.add("hidden");$("affiliateView").classList.add("hidden");$("adminView").classList.remove("hidden");}
 const section=panelMarkup();wireForms();
 try{await Promise.all([loadProducts(),loadOrders(),loadCampaigns(),loadSettings()]);message("Commerce Control Center siap.");}
 catch(err){message("Backend belum sepenuhnya aktif: "+(err.message||err)+". Pastikan migration SQL sudah dijalankan.");}
}
init().catch(e=>console.error("Bos Pangan commerce admin:",e));
