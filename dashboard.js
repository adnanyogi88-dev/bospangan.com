import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/auth-config.js";
const supabase=createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=n=>"Rp"+Number(n||0).toLocaleString("id-ID");
const status=(s)=>{ $("status").textContent=s; };
const table=(headers,rows)=>rows.length?'<table><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join("")+'</tr></thead><tbody>'+rows.join("")+'</tbody></table>':'<p class="muted">Belum ada data.</p>';
let currentUser=null, profile=null;
async function init(){
 const {data:{session}}=await supabase.auth.getSession();
 if(!session){location.href="/";return;}
 currentUser=session.user;
 const {data,error}=await supabase.from("profiles").select("id,display_name,role,created_at").eq("id",currentUser.id).single();
 if(error||!data){status("Profil belum dapat dibaca: "+(error?.message||"data tidak ditemukan"));return;}
 profile=data;
 $("welcome").textContent="Halo, "+(profile.display_name||currentUser.email.split("@")[0]);
 $("identity").textContent=currentUser.email;
 $("roleBadge").textContent="Hak akses: "+profile.role;
 $("displayName").value=profile.display_name||"";
 $("favoriteCount").textContent=(()=>{try{return JSON.parse(localStorage.getItem("bospangan-v1-favorites")||"[]").length}catch{return 0}})();
 $("memberView").classList.remove("hidden");
 if(profile.role==="affiliate"){$("memberView").classList.add("hidden");$("affiliateView").classList.remove("hidden");await loadAffiliate();}
 if(["admin","super_admin"].includes(profile.role)){$("memberView").classList.add("hidden");$("affiliateView").classList.add("hidden");$("adminView").classList.remove("hidden");await loadAdmin();}
 if(profile.role==="member")await loadApplication();
 status("Dashboard siap. Data ditampilkan sesuai hak akses akun.");
}
async function loadApplication(){
 const {data,error}=await supabase.from("affiliate_applications").select("status,created_at").eq("user_id",currentUser.id).maybeSingle();
 if(error){$("applicationStatus").textContent="Status pengajuan belum tersedia.";return;}
 $("applicationStatus").textContent=data?"Status pengajuan: "+data.status:"Belum ada pengajuan affiliate.";
 $("affiliateForm").classList.toggle("hidden",!!data);
}
$("profileForm").addEventListener("submit",async e=>{
 e.preventDefault();const display_name=$("displayName").value.trim();
 const {error}=await supabase.from("profiles").update({display_name,updated_at:new Date().toISOString()}).eq("id",currentUser.id);
 if(error)status("Gagal menyimpan profil: "+error.message);else{$("welcome").textContent="Halo, "+display_name;status("Profil berhasil diperbarui.");}
});
$("affiliateForm").addEventListener("submit",async e=>{
 e.preventDefault();const motivation=$("motivation").value.trim();
 const {error}=await supabase.from("affiliate_applications").insert({user_id:currentUser.id,motivation});
 if(error)status("Pengajuan gagal: "+error.message);else{status("Pengajuan affiliate terkirim dan menunggu pemeriksaan admin.");await loadApplication();}
});
async function loadAffiliate(){
 const [{data:account,error:aErr},{data:refs,error:rErr},{data:comm,error:cErr},{data:payouts,error:pErr}]=await Promise.all([
  supabase.from("affiliate_accounts").select("referral_code,status").eq("user_id",currentUser.id).single(),
  supabase.from("affiliate_referrals").select("id,created_at").eq("affiliate_user_id",currentUser.id).order("created_at",{ascending:false}),
  supabase.from("affiliate_commissions").select("amount,status,note,created_at,paid_at").eq("affiliate_user_id",currentUser.id).order("created_at",{ascending:false}),
  supabase.from("affiliate_payout_requests").select("id,amount,status,payout_method,payout_destination,recipient_name,admin_note,payment_reference,requested_at,reviewed_at,paid_at").eq("affiliate_user_id",currentUser.id).order("requested_at",{ascending:false})
 ]);
 if(aErr){status("Data affiliate belum tersedia: "+aErr.message);return;}
 const link=location.origin+"/?ref="+encodeURIComponent(account.referral_code);
 $("refLink").textContent=link;$("copyRef").onclick=async()=>{try{await navigator.clipboard.writeText(link);status("Link referral disalin.");}catch{status("Salin link secara manual dari kotak link.");}};
 if(rErr||cErr||pErr){status("Sebagian data affiliate belum dapat dimuat. Pastikan migrasi penarikan sudah dijalankan.");return;}
 const {data:payoutProfile,error:ppErr}=await supabase.from("affiliate_payout_profiles").select("payout_method,recipient_name,payout_destination").eq("user_id",currentUser.id).maybeSingle();
 if(ppErr){status("Data tujuan pembayaran belum dapat dimuat. Jalankan migrasi fitur rekening tersimpan.");return;}
 if(payoutProfile){$("payoutMethod").value=payoutProfile.payout_method;$("recipientName").value=payoutProfile.recipient_name;$("payoutDestination").value=payoutProfile.payout_destination;}
 $("referralCount").textContent=refs.length;
 const total=comm.filter(x=>x.status==="approved"||x.status==="paid").reduce((s,x)=>s+Number(x.amount),0);
 const reserved=payouts.filter(x=>["pending","approved","paid"].includes(x.status)).reduce((s,x)=>s+Number(x.amount),0);
 const available=Math.max(0,comm.filter(x=>x.status==="approved").reduce((s,x)=>s+Number(x.amount),0)-reserved);
 $("commissionTotal").textContent=money(total);$("pendingTotal").textContent=money(available);
 $("withdrawalAmount").max=String(available);$("withdrawalBalance").textContent=money(available);$("withdrawalMinimumNotice").textContent=available<50000?"Minimum penarikan Rp50.000. Saldo Anda belum mencukupi.":"Minimum penarikan Rp50.000.";
 $("affiliatePayouts").innerHTML=table(["Tanggal pengajuan","Nominal","Tujuan","Status","Catatan admin","Tanggal dibayar"],payouts.map(x=>'<tr><td>'+esc(new Date(x.requested_at).toLocaleDateString("id-ID"))+'</td><td>'+money(x.amount)+'</td><td>'+esc(x.payout_method==="bank"?"Transfer bank":"E-wallet")+' · '+esc(x.recipient_name)+'<br><small>'+esc(x.payout_destination)+'</small></td><td>'+esc(x.status)+'</td><td>'+esc(x.admin_note||"—")+'</td><td>'+(x.paid_at?esc(new Date(x.paid_at).toLocaleDateString("id-ID")):"—")+'</td></tr>'));
 $("affiliateCommissions").innerHTML=table(["Tanggal","Nominal","Status","Tanggal dibayar","Catatan"],comm.map(x=>'<tr><td>'+esc(new Date(x.created_at).toLocaleDateString("id-ID"))+'</td><td>'+money(x.amount)+'</td><td>'+esc(x.status)+'</td><td>'+(x.paid_at?esc(new Date(x.paid_at).toLocaleDateString("id-ID")):"—")+'</td><td>'+esc(x.note)+'</td></tr>'));
 $("affiliateReferrals").innerHTML=table(["Tanggal bergabung","Status"],refs.map(x=>'<tr><td>'+esc(new Date(x.created_at).toLocaleDateString("id-ID"))+'</td><td>Terdaftar</td></tr>'));
 $("savePayoutDetails").onclick=async()=>{const payload={user_id:currentUser.id,payout_method:$("payoutMethod").value,recipient_name:$("recipientName").value.trim(),payout_destination:$("payoutDestination").value.trim(),updated_at:new Date().toISOString()};if(payload.recipient_name.length<1||payload.payout_destination.length<3){status("Lengkapi nama pemilik dan nomor rekening/e-wallet terlebih dahulu.");return;}const b=$("savePayoutDetails");b.disabled=true;const {error}=await supabase.from("affiliate_payout_profiles").upsert(payload,{onConflict:"user_id"});b.disabled=false;if(error)status("Tujuan pembayaran gagal disimpan: "+error.message);else status("Tujuan pembayaran berhasil disimpan.");};
 $("withdrawalForm").onsubmit=async e=>{e.preventDefault();const amount=Number($("withdrawalAmount").value),payout_method=$("payoutMethod").value,recipient_name=$("recipientName").value.trim(),payout_destination=$("payoutDestination").value.trim();if(!Number.isFinite(amount)||amount<50000){status("Minimum penarikan adalah Rp50.000.");return;}if(amount>available){status("Nominal penarikan melebihi saldo tersedia.");return;}const button=$("withdrawalSubmit");button.disabled=true;const saved=await supabase.from("affiliate_payout_profiles").upsert({user_id:currentUser.id,payout_method,recipient_name,payout_destination,updated_at:new Date().toISOString()},{onConflict:"user_id"});if(saved.error){button.disabled=false;status("Tujuan pembayaran gagal disimpan: "+saved.error.message);return;}const {error}=await supabase.rpc("request_affiliate_withdrawal",{p_amount:amount,p_method:payout_method,p_destination:payout_destination,p_recipient_name:recipient_name});button.disabled=false;if(error){status("Pengajuan penarikan gagal: "+error.message);return;}$("withdrawalAmount").value="";status("Pengajuan penarikan berhasil dikirim. Menunggu pemeriksaan admin.");await loadAffiliate();};

}
async function loadAdmin(){
 const [{data:members,error:mErr},{data:apps,error:aErr},{data:comm,error:cErr},{data:affs,error:fErr},{data:payouts,error:pErr}]=await Promise.all([
  supabase.from("profiles").select("id,display_name,role,created_at").order("created_at",{ascending:false}),
  supabase.from("affiliate_applications").select("user_id,motivation,status,created_at").eq("status","pending").order("created_at",{ascending:true}),
  supabase.from("affiliate_commissions").select("id,amount,status,created_at,affiliate_user_id,paid_at").order("created_at",{ascending:false}),
  supabase.from("affiliate_accounts").select("user_id,referral_code,status"),
  supabase.from("affiliate_payout_requests").select("id,affiliate_user_id,amount,status,payout_method,payout_destination,recipient_name,admin_note,payment_reference,requested_at,paid_at").order("requested_at",{ascending:false})
 ]);
 if(mErr||aErr||cErr||fErr||pErr){status("Gagal memuat data admin. Pastikan migrasi SQL penarikan sudah dijalankan.");return;}
 $("memberTotal").textContent=members.length;$("applicationTotal").textContent=apps.length;
 $("adminCommissionTotal").textContent=money(comm.reduce((s,x)=>s+Number(x.amount),0));
 const emailMap={}; // Email sengaja tidak diambil dari auth.users di browser.
 $("membersTable").innerHTML=table(["Nama","Role","Terdaftar","ID pengguna"],members.map(m=>'<tr><td>'+esc(m.display_name||"—")+'</td><td><select data-role-user="'+esc(m.id)+'"><option value="member" '+(m.role==="member"?"selected":"")+'>member</option><option value="affiliate" '+(m.role==="affiliate"?"selected":"")+'>affiliate</option><option value="admin" '+(m.role==="admin"?"selected":"")+'>admin</option><option value="super_admin" '+(m.role==="super_admin"?"selected":"")+'>super_admin</option></select></td><td>'+esc(new Date(m.created_at).toLocaleDateString("id-ID"))+'</td><td><small>'+esc(m.id)+'</small></td></tr>'));
 $("membersTable").querySelectorAll("[data-role-user]").forEach(sel=>sel.addEventListener("change",async()=>{const {error}=await supabase.rpc("admin_set_user_role",{p_user_id:sel.dataset.roleUser,p_role:sel.value});if(error){status("Role gagal diubah: "+error.message);await loadAdmin();}else{status("Role pengguna berhasil diperbarui.");await loadAdmin();}}));
 $("applicationsTable").innerHTML=table(["ID pengguna","Motivasi","Tanggal","Tindakan"],apps.map(x=>'<tr><td><small>'+esc(x.user_id)+'</small></td><td>'+esc(x.motivation)+'</td><td>'+esc(new Date(x.created_at).toLocaleDateString("id-ID"))+'</td><td><button class="primary" data-review="'+esc(x.user_id)+'" data-approve="true">Setujui</button> <button data-review="'+esc(x.user_id)+'" data-approve="false">Tolak</button></td></tr>'));
 $("applicationsTable").querySelectorAll("[data-review]").forEach(b=>b.onclick=async()=>{const {error}=await supabase.rpc("admin_review_affiliate",{p_user_id:b.dataset.review,p_approve:b.dataset.approve==="true"});if(error)status("Review gagal: "+error.message);else status("Pengajuan affiliate diperbarui.");await loadAdmin();});
 $("commissionAffiliate").innerHTML=affs.filter(a=>a.status==="active").map(a=>'<option value="'+esc(a.user_id)+'">'+esc(a.referral_code)+'</option>').join("");
 $("adminCommissions").innerHTML=table(["Affiliate","Nominal","Status","Tanggal","Tindakan"],comm.map(x=>{const action=x.status==="pending"?'<button class="primary" data-commission-id="'+x.id+'" data-next-status="approved">Setujui</button> <button data-commission-id="'+x.id+'" data-next-status="rejected">Tolak</button>':x.status==="approved"?"Menunggu pengajuan penarikan":"—";return '<tr><td><small>'+esc(x.affiliate_user_id)+'</small></td><td>'+money(x.amount)+'</td><td>'+esc(x.status)+'</td><td>'+esc(new Date(x.created_at).toLocaleDateString("id-ID"))+'</td><td>'+action+'</td></tr>';}));
 $("adminCommissions").querySelectorAll("[data-commission-id]").forEach(b=>b.onclick=async()=>{if(b.dataset.nextStatus==="paid"&&!confirm("Pastikan transfer benar-benar sudah dilakukan. Lanjut tandai dibayar?"))return;b.disabled=true;const {error}=await supabase.rpc("admin_update_commission_status",{p_commission_id:Number(b.dataset.commissionId),p_status:b.dataset.nextStatus});if(error)status("Status komisi gagal diperbarui: "+error.message);else status("Status komisi berhasil diperbarui.");await loadAdmin();});
 $("adminPayoutRequests").innerHTML=table(["Affiliate","Nominal","Tujuan pembayaran","Status","Tanggal","Tindakan"],payouts.map(x=>{const action=x.status==="pending"?'<button class="primary" data-payout-id="'+x.id+'" data-next-status="approved">Setujui</button> <button data-payout-id="'+x.id+'" data-next-status="rejected">Tolak</button>':x.status==="approved"?'<button class="primary" data-payout-id="'+x.id+'" data-next-status="paid">Tandai dibayar</button>':"—";return '<tr><td><small>'+esc(x.affiliate_user_id)+'</small></td><td>'+money(x.amount)+'</td><td>'+esc(x.payout_method==="bank"?"Transfer bank":"E-wallet")+'<br>'+esc(x.recipient_name)+'<br><small>'+esc(x.payout_destination)+'</small></td><td>'+esc(x.status)+(x.admin_note?"<br><small>"+esc(x.admin_note)+"</small>":"")+(x.payment_reference?"<br><small>Ref: "+esc(x.payment_reference)+"</small>":"")+'</td><td>'+esc(new Date(x.requested_at).toLocaleDateString("id-ID"))+'</td><td>'+action+'</td></tr>';}));
 $("adminPayoutRequests").querySelectorAll("[data-payout-id]").forEach(b=>b.onclick=async()=>{const next=b.dataset.nextStatus;if(next==="paid"&&!confirm("Pastikan transfer sudah benar-benar dilakukan ke tujuan yang tertera. Tandai sebagai dibayar?"))return;const admin_note=prompt(next==="paid"?"Masukkan nomor referensi/bukti transaksi (wajib):":"Catatan untuk affiliate (opsional):")||"";if(next==="paid"&&!admin_note.trim()){status("Nomor referensi transaksi wajib diisi sebelum menandai dibayar.");return;}b.disabled=true;const {error}=await supabase.rpc("admin_update_payout_status",{p_request_id:Number(b.dataset.payoutId),p_status:next,p_admin_note:admin_note});if(error)status("Status penarikan gagal diperbarui: "+error.message);else status("Status penarikan berhasil diperbarui.");await loadAdmin();});

}
$("commissionForm").addEventListener("submit",async e=>{
 e.preventDefault();const affiliate_user_id=$("commissionAffiliate").value,amount=Number($("commissionAmount").value),note=$("commissionNote").value.trim();
 if(!affiliate_user_id||!Number.isFinite(amount)||amount<=0){status("Pilih affiliate dan nominal komisi yang valid.");return;}
 const {error}=await supabase.from("affiliate_commissions").insert({affiliate_user_id,amount,note});
 if(error)status("Komisi gagal dicatat: "+error.message);else{status("Komisi berhasil dicatat.");$("commissionAmount").value="";$("commissionNote").value="";await loadAdmin();}
});
$("logout").onclick=async()=>{await supabase.auth.signOut();location.href="/";};
supabase.auth.onAuthStateChange((event,session)=>{if(event==="SIGNED_OUT"||!session)location.href="/";});
init().catch(e=>status("Terjadi kesalahan: "+e.message));
