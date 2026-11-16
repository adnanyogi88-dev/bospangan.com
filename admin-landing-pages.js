import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/auth-config.js";

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let user = null, editingId = null, active = false;

function slugify(value) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,120);
}
function message(value) { const node=$("landingStatus"); if(node) node.textContent=value; }
function panelMarkup() {
  const panel=document.createElement("section");
  panel.id="landingPagesPanel";
  panel.className="panel";
  panel.innerHTML=`
    <div class="admin-content-heading">
      <div><h2>Landing Page</h2><p class="muted">Buat dan kelola halaman promosi Bos Pangan.</p></div>
      <button class="primary" id="newLandingPage">+ Buat Landing Page</button>
    </div>
    <div id="landingStatus" class="status" role="status">Memuat modul landing page…</div>
    <div id="landingList"></div>
    <form id="landingForm" class="panel hidden">
      <div class="admin-content-heading"><div><h3 id="landingFormTitle">Buat Landing Page</h3><p class="muted">Konten akan diterbitkan pada /landingpage/slug</p></div><button type="button" id="closeLandingForm">Tutup</button></div>
      <label>Judul halaman<input name="title" maxlength="180" required placeholder="Contoh: Supplier Sembako untuk Warung"></label>
      <label>Slug URL<div class="row"><input name="slug" maxlength="120" pattern="[a-z0-9]+(-[a-z0-9]+)*" required placeholder="supplier-sembako"><span class="code">/landingpage/<b id="slugPreview">slug</b></span></div></label>
      <label>Ringkasan / excerpt<textarea name="excerpt" rows="2" maxlength="300" placeholder="Ringkasan singkat halaman"></textarea></label>
      <label>Primary Image (JPG, PNG, WebP; maks. 8 MB)<input name="primary_image" type="file" accept="image/jpeg,image/png,image/webp"></label>
      <div id="landingImagePreview" class="muted"></div>
      <label>Konten halaman</label>
      <div class="tabs" id="landingToolbar">
        <button type="button" data-command="formatBlock" data-value="h2">H2</button>
        <button type="button" data-command="formatBlock" data-value="h3">H3</button>
        <button type="button" data-command="bold"><b>B</b></button>
        <button type="button" data-command="italic"><i>I</i></button>
        <button type="button" data-command="insertUnorderedList">• List</button>
        <button type="button" data-command="insertOrderedList">1. List</button>
        <button type="button" data-command="createLink">Tautan</button>
        <button type="button" data-command="removeFormat">Hapus format</button>
      </div>
      <div id="landingEditor" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="Tulis isi landing page di sini…" style="min-height:320px;border:1px solid #dfe4ec;border-radius:8px;padding:16px;line-height:1.7;background:#fff;outline-color:#0bbf94"></div>
      <div class="row">
        <label>Meta Title<input name="meta_title" maxlength="70" placeholder="Judul SEO halaman"></label>
        <label>Meta Description<textarea name="meta_description" rows="2" maxlength="170" placeholder="Deskripsi SEO maksimal 170 karakter"></textarea></label>
      </div>
      <label>Status publikasi<select name="status"><option value="draft">Draft</option><option value="published">Published</option></select></label>
      <div class="row"><button class="primary" id="saveLandingPage" type="submit">Simpan Landing Page</button><button type="button" id="cancelLandingEdit">Batal</button></div>
    </form>`;
  $("adminView").append(panel);
  panel.querySelector("#newLandingPage").onclick=()=>openForm();
  panel.querySelector("#closeLandingForm").onclick=()=>panel.querySelector("#landingForm").classList.add("hidden");
  panel.querySelector("#cancelLandingEdit").onclick=()=>{resetForm();panel.querySelector("#landingForm").classList.add("hidden");};
  const form=panel.querySelector("#landingForm");
  form.elements.title.addEventListener("input",()=>{if(!editingId||!form.elements.slug.dataset.manual){form.elements.slug.value=slugify(form.elements.title.value);updateSlug();}});
  form.elements.slug.addEventListener("input",()=>{form.elements.slug.dataset.manual="1";form.elements.slug.value=slugify(form.elements.slug.value);updateSlug();});
  function updateSlug(){panel.querySelector("#slugPreview").textContent=form.elements.slug.value||"slug";}
  panel.querySelectorAll("#landingToolbar button").forEach(button=>button.onclick=()=>{
    const cmd=button.dataset.command;
    if(cmd==="createLink"){const url=prompt("Masukkan URL tautan (https://…)");if(url&&/^https?:\/\//i.test(url))document.execCommand(cmd,false,url);return;}
    document.execCommand(cmd,false,button.dataset.value||null);$("landingEditor").focus();
  });
  form.elements.primary_image.addEventListener("change",()=>{
    const file=form.elements.primary_image.files[0];
    panel.querySelector("#landingImagePreview").textContent=file?file.name+" · "+(file.size/1024/1024).toFixed(2)+" MB":"";
  });
  form.onsubmit=savePage;
  return panel;
}
function resetForm(){
  editingId=null;
  const form=$("landingForm"); if(!form)return;
  form.reset();form.elements.slug.dataset.manual="";
  $("landingEditor").innerHTML="";
  $("landingFormTitle").textContent="Buat Landing Page";
  $("landingImagePreview").textContent="";
}
function openForm(){
  resetForm();
  $("landingForm").classList.remove("hidden");
  $("landingForm").scrollIntoView({behavior:"smooth",block:"start"});
}
async function uploadImage(file){
  if(!file)return null;
  if(!["image/jpeg","image/png","image/webp"].includes(file.type))throw new Error("Format gambar harus JPG, PNG, atau WebP.");
  if(file.size>8*1024*1024)throw new Error("Ukuran gambar maksimal 8 MB.");
  const path=user.id+"/"+crypto.randomUUID()+"-"+slugify(file.name);
  const {error}=await db.storage.from("landing-page-images").upload(path,file,{contentType:file.type,upsert:false});
  if(error)throw error;
  return db.storage.from("landing-page-images").getPublicUrl(path).data.publicUrl;
}
async function savePage(event){
  event.preventDefault();
  const form=event.currentTarget, button=$("saveLandingPage");
  const title=form.elements.title.value.trim(), slug=slugify(form.elements.slug.value);
  const content=$("landingEditor").innerHTML.trim();
  if(!title||!slug||!content){message("Judul, slug, dan konten wajib diisi.");return;}
  if(!/<(p|h[1-6]|ul|ol|blockquote|img|table|div)\b/i.test(content)){message("Tambahkan konten teks menggunakan paragraf atau heading.");return;}
  button.disabled=true;
  try{
    let primary_image_url=editingId?form.dataset.imageUrl||null:null;
    const file=form.elements.primary_image.files[0];
    if(file)primary_image_url=await uploadImage(file);
    const payload={
      title,slug,excerpt:form.elements.excerpt.value.trim(),content_html:content,
      primary_image_url,meta_title:form.elements.meta_title.value.trim()||title,
      meta_description:form.elements.meta_description.value.trim()||form.elements.excerpt.value.trim(),
      status:form.elements.status.value,updated_by:user.id,updated_at:new Date().toISOString()
    };
    if(payload.status==="published"&&!editingId)payload.published_at=new Date().toISOString();
    if(payload.status==="published"&&editingId)payload.published_at=payload.published_at||new Date().toISOString();
    let result;
    if(editingId)result=await db.from("landing_pages").update(payload).eq("id",editingId);
    else result=await db.from("landing_pages").insert({...payload,created_by:user.id});
    if(result.error)throw result.error;
    message("Landing page berhasil disimpan.");
    resetForm();form.classList.add("hidden");await loadPages();
  }catch(error){message("Gagal menyimpan: "+(error.message||error));}
  finally{button.disabled=false;}
}
async function loadPages(){
  const {data,error}=await db.from("landing_pages").select("id,title,slug,excerpt,status,updated_at,published_at").order("updated_at",{ascending:false});
  if(error){message("Gagal memuat landing page: "+error.message);return;}
  $("landingList").innerHTML=data.length?`<div class="table-wrap"><table><thead><tr><th>Judul</th><th>URL</th><th>Status</th><th>Terakhir diubah</th><th>Aksi</th></tr></thead><tbody>${data.map(p=>`<tr><td><strong>${esc(p.title)}</strong><br><small>${esc(p.excerpt)}</small></td><td><a href="/landingpage/${encodeURIComponent(p.slug)}" target="_blank" rel="noopener">/landingpage/${esc(p.slug)}</a></td><td>${p.status==="published"?"Published":"Draft"}</td><td>${new Date(p.updated_at).toLocaleString("id-ID")}</td><td><button type="button" data-edit="${p.id}">Edit</button> <button type="button" data-delete="${p.id}">Hapus</button></td></tr>`).join("")}</tbody></table></div>`:'<p class="muted">Belum ada landing page. Klik “Buat Landing Page” untuk mulai.</p>';
  $("landingList").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>editPage(data.find(p=>p.id===b.dataset.edit)));
  $("landingList").querySelectorAll("[data-delete]").forEach(b=>b.onclick=async()=>{
    const p=data.find(x=>x.id===b.dataset.delete);
    if(!confirm("Hapus landing page “"+p.title+"”?"))return;
    const {error}=await db.from("landing_pages").delete().eq("id",p.id);
    if(error)message("Gagal menghapus: "+error.message);else{message("Landing page dihapus.");await loadPages();}
  });
}
async function editPage(page){
  const {data,error}=await db.from("landing_pages").select("*").eq("id",page.id).single();
  if(error){message(error.message);return;}
  editingId=data.id;
  const form=$("landingForm"),f=form.elements;
  f.title.value=data.title;f.slug.value=data.slug;f.slug.dataset.manual="1";
  f.excerpt.value=data.excerpt||"";f.meta_title.value=data.meta_title||"";
  f.meta_description.value=data.meta_description||"";f.status.value=data.status;
  form.dataset.imageUrl=data.primary_image_url||"";
  $("landingEditor").innerHTML=data.content_html||"";
  $("landingImagePreview").textContent=data.primary_image_url?"Primary image tersimpan. Pilih file baru untuk mengganti.":"Belum ada primary image.";
  $("landingFormTitle").textContent="Edit Landing Page";
  $("slugPreview").textContent=data.slug;
  form.classList.remove("hidden");form.scrollIntoView({behavior:"smooth",block:"start"});
}
async function activate(){
  if(active)return;active=true;
  const {data:{session}}=await db.auth.getSession();
  if(!session){message("Silakan login sebagai admin.");return;}
  user=session.user;
  const {data:profile,error}=await db.from("profiles").select("role").eq("id",user.id).single();
  if(error||!["admin","super_admin"].includes(profile?.role)){message("Akses ditolak. Modul ini hanya untuk Admin dan Super Admin.");return;}
  if(!$("landingPagesPanel"))panelMarkup();
  await loadPages();
}
function openModule(){
  const admin=$("adminView");
  if(!$("landingPagesPanel"))panelMarkup();
  admin.querySelectorAll(":scope > .panel").forEach(p=>p.classList.add("hidden"));
  admin.querySelectorAll(":scope > .cards").forEach(p=>p.classList.add("hidden"));
  $("landingPagesPanel").classList.remove("hidden");
  $("landingPagesPanel").classList.add("admin-panel-active");
  activate();
}
window.openLandingPagesModule = openModule;
document.addEventListener("click",event=>{
  const button=event.target.closest("[data-admin-target='content']");
  if(!button)return;
  event.preventDefault();event.stopImmediatePropagation();
  document.querySelectorAll("[data-admin-target]").forEach(b=>b.classList.toggle("active",b===button));
  if(!$("landingPagesPanel"))panelMarkup();
  openModule();
},true);
document.addEventListener("click",event=>{
  const button=event.target.closest("[data-admin-target='overview']");
  if(!button||!$("landingPagesPanel"))return;
  $("landingPagesPanel").classList.remove("admin-panel-active");
  $("landingPagesPanel").classList.add("hidden");
},true);
