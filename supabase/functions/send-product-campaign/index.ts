import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), {status,headers:{...cors,"Content-Type":"application/json"}});

Deno.serve(async req => {
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return json({error:"Method not allowed"},405);
  const url=Deno.env.get("SUPABASE_URL")!, service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth=req.headers.get("Authorization")??"";
  const adminClient=createClient(url,Deno.env.get("SUPABASE_ANON_KEY")??"",{global:{headers:{Authorization:auth}}});
  const db=createClient(url,service,{auth:{persistSession:false}});
  try{
    const {data:{user}}=await adminClient.auth.getUser();
    if(!user) return json({error:"Authentication required"},401);
    const {data:profile}=await db.from("profiles").select("role").eq("id",user.id).single();
    if(!profile||!["admin","super_admin"].includes(profile.role)) return json({error:"Admin access required"},403);
    const {campaign_id}=await req.json();
    if(!campaign_id) return json({error:"campaign_id is required"},400);
    const {data:campaign,error}=await db.from("product_campaigns").select("*").eq("id",campaign_id).single();
    if(error||!campaign) return json({error:"Campaign not found"},404);
    if(!["draft","scheduled"].includes(campaign.status)) return json({error:"Campaign is not ready to send"},409);
    if(campaign.scheduled_at && new Date(campaign.scheduled_at).getTime()>Date.now()) return json({error:"Campaign is scheduled for a future time"},409);
    const {data:settings}=await db.from("store_settings").select("key,value").in("key",["email_notifications_enabled","push_notifications_enabled"]);
    const config=Object.fromEntries((settings??[]).map((x:any)=>[x.key,x.value]));
    const emailEnabled=config.email_notifications_enabled!==false;
    const pushEnabled=config.push_notifications_enabled!==false;
    const {error:updateError}=await db.from("product_campaigns").update({status:"sending"}).eq("id",campaign_id);
    if(updateError) throw updateError;

    let recipients:string[]=[];
    if(campaign.audience==="all_opted_in"){
      const {data}=await db.from("notification_preferences").select("email").eq("email_opt_in",true).is("unsubscribed_at",null);
      recipients=(data??[]).map((x:any)=>x.email);
    }else{
      const {data}=await db.from("product_notification_subscriptions").select("email").eq("product_id",campaign.product_id);
      recipients=[...new Set((data??[]).map((x:any)=>x.email))];
    }
    let sent=0, failed=0, pushSent=0, pushFailed=0;
    if(["email","both"].includes(campaign.channel) && emailEnabled){
      const key=Deno.env.get("RESEND_API_KEY");
      if(!key) throw new Error("RESEND_API_KEY is not configured");
      for(const email of recipients){
        const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({
          from:Deno.env.get("EMAIL_FROM")??"Bos Pangan <onboarding@resend.dev>",
          to:[email],subject:campaign.subject,
          html:campaign.body_html+"<hr><p style='font-size:12px;color:#777'>Anda menerima email ini karena memilih menerima informasi Bos Pangan. Hubungi admin jika ingin berhenti berlangganan.</p>"
        })});
        if(response.ok) sent++; else {failed++;console.error("Resend failed",email,await response.text());}
      }
    }
    if(["push","both"].includes(campaign.channel) && pushEnabled){
      const publicKey=Deno.env.get("VAPID_PUBLIC_KEY"), privateKey=Deno.env.get("VAPID_PRIVATE_KEY"), subject=Deno.env.get("VAPID_SUBJECT");
      if(publicKey&&privateKey&&subject){
        webpush.setVapidDetails(subject,publicKey,privateKey);
        const {data:subs}=await db.from("web_push_subscriptions").select("id,endpoint,p256dh,auth_key");
        for(const sub of subs??[]){
          try{
            await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth_key}},JSON.stringify({title:campaign.title,body:campaign.subject,url:"/"}));
            pushSent++;
          }catch(e){
            pushFailed++;
            if((e as any)?.statusCode===404||(e as any)?.statusCode===410) await db.from("web_push_subscriptions").delete().eq("id",sub.id);
          }
        }
      }else{
        console.warn("Push channel selected, but VAPID secrets are not configured.");
      }
    }
    const finalStatus=failed===0&&pushFailed===0?"sent":(sent+pushSent>0?"sent":"failed");
    await db.from("product_campaigns").update({status:finalStatus,sent_at:new Date().toISOString()}).eq("id",campaign_id);
    return json({success:true,sent,failed,push_sent:pushSent,push_failed:pushFailed,recipient_count:recipients.length});
  }catch(error){
    console.error("send-product-campaign:",error);
    return json({error:error instanceof Error?error.message:"Campaign failed"},500);
  }
});
