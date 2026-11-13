import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/auth-config.js";
const $ = (id) => document.getElementById(id);
const ready = SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("YOUR_") && SUPABASE_ANON_KEY.length > 20 && !SUPABASE_ANON_KEY.includes("YOUR_");
let client = null, user = null;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function show(title, html) { $("heading").textContent = title; $("panel").innerHTML = html; if (!$("box").open) $("box").showModal(); }
function message(text, ok=false) { const el=$("authStatus"); if(el){el.className=ok?"auth-success":"auth-error";el.textContent=text;} }
function configNotice(){show("Masuk / Daftar",'<div class="auth-note">Tampilan login sudah dipasang. Untuk mengaktifkan akun, admin perlu menghubungkan project Supabase dengan mengisi <code>auth-config.js</code> dan menjalankan <code>supabase/schema.sql</code>.</div>');}
function authForm(mode="login"){
 if(!ready||!client) return configNotice();
 const reg=mode==="register";
 show(reg?"Daftar Anggota":"Masuk ke Akun Anda",`
 <div class="auth-tabs"><button data-mode="login" class="${!reg?"active":""}">Masuk</button><button data-mode="register" class="${reg?"active":""}">Daftar</button></div>
 <form id="authForm" class="auth-form">
 ${reg?'<label>Nama lengkap<input name="name" autocomplete="name" maxlength="80" required></label>':""}
 <label>Email<input name="email" type="email" autocomplete="email" maxlength="254" required></label>
 <label>Password<input name="password" type="password" minlength="8" autocomplete="${reg?"new-password":"current-password"}" required></label>
 <p id="authStatus" class="auth-error" role="status"></p><button class="primary full" type="submit">${reg?"Buat Akun":"Masuk"}</button></form>
 ${!reg?'<button id="forgot" class="full" type="button">Lupa password?</button>':""}
 <button id="google" class="auth-google" type="button">Lanjutkan dengan Google</button>
 <p class="auth-small">Gunakan email aktif agar dapat menerima verifikasi dan pemulihan akun.</p>`);
 $("panel").querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>authForm(b.dataset.mode));
 $("authForm").onsubmit=async e=>{
  e.preventDefault();const data=new FormData(e.currentTarget),email=String(data.get("email")).trim(),password=String(data.get("password"));
  const submit=e.currentTarget.querySelector('[type="submit"]');submit.disabled=true;message("Memproses...");
  try{
   if(reg){const {error}=await client.auth.signUp({email,password,options:{data:{display_name:String(data.get("name")).trim(),referral_code:new URLSearchParams(location.search).get("ref")||""},emailRedirectTo:location.origin}});if(error)throw error;message("Pendaftaran dikirim. Periksa email untuk verifikasi.",true);}
   else{const {error}=await client.auth.signInWithPassword({email,password});if(error)throw error;await syncUser();account();}
  }catch(err){message(err.message||"Tidak dapat memproses akun.");}finally{submit.disabled=false;}
 };
 $("google").onclick=async()=>{const {error}=await client.auth.signInWithOAuth({provider:"google",options:{redirectTo:location.origin}});if(error)message(error.message);};
 $("forgot")?.addEventListener("click",async()=>{const email=$("authForm").elements.email.value.trim();if(!email)return message("Isi email terlebih dahulu.");const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:location.origin});message(error?error.message:"Jika email terdaftar, tautan pemulihan akan dikirim.",!error);});
}
async function syncUser(){if(!client)return;const {data}=await client.auth.getUser();user=data.user||null;const b=$("accountTop");if(b)b.textContent=user?(user.user_metadata?.display_name||user.email.split("@")[0]):"Masuk / Daftar";}
async function account(){
 if(!user)return authForm();
 let name=user.user_metadata?.display_name||"",role="member";
 const {data}=await client.from("profiles").select("display_name,role").eq("id",user.id).maybeSingle();
 if(data){name=data.display_name||name;role=data.role||role;}
 show("Akun Saya",`<div class="account-card"><strong>${esc(name||"Anggota")}</strong><p>${esc(user.email)}</p><p>Peran: ${esc(role==="admin"?"Admin":role==="affiliate"?"Affiliator":"Member")}</p></div>
 <div class="auth-actions"><button id="goDashboard" type="button">Buka Dashboard</button><button id="rename" type="button">Ubah Nama</button><button id="logout" type="button">Keluar</button></div><p id="authStatus" role="status"></p>`);
 $("goDashboard").onclick=()=>{location.href="/dashboard.html";};
 $("rename").onclick=async()=>{const next=prompt("Nama tampilan:",name);if(next===null)return;const {error}=await client.from("profiles").update({display_name:next.trim(),updated_at:new Date().toISOString()}).eq("id",user.id);if(error)message(error.message);else{await client.auth.updateUser({data:{display_name:next.trim()}});await syncUser();account();}};
 $("logout").onclick=async()=>{const {error}=await client.auth.signOut();if(error)return message(error.message);user=null;await syncUser();authForm();};
}
function resetPassword(){
 show("Buat Password Baru",'<form id="resetForm" class="auth-form"><label>Password baru<input name="password" type="password" minlength="8" autocomplete="new-password" required></label><p id="authStatus" role="status"></p><button class="primary full" type="submit">Simpan Password</button></form>');
 $("resetForm").onsubmit=async e=>{e.preventDefault();const password=String(new FormData(e.currentTarget).get("password"));const {error}=await client.auth.updateUser({password});if(error)message(error.message);else{message("Password berhasil diperbarui. Silakan masuk kembali.",true);await client.auth.signOut();user=null;await syncUser();setTimeout(()=>authForm("login"),900);}};
}
function open(){if(user)account();else authForm();}
window.TWSAuth={open};
if(ready){client=createClient(SUPABASE_URL,SUPABASE_ANON_KEY);client.auth.onAuthStateChange((event,session)=>{user=session?.user||null;if(event==="PASSWORD_RECOVERY")resetPassword();syncUser();});syncUser();}
$("accountTop").onclick=open;
