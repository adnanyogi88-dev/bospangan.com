import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/auth-config.js";
const db=createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
const $=id=>document.getElementById(id);
const slug=decodeURIComponent(location.pathname.replace(/^\/landingpage\/?/,"").replace(/\/$/,""));
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
$("year").textContent=new Date().getFullYear();
function meta(name,content,property=false){
 let node=document.querySelector(property?'meta[property="'+name+'"]':'meta[name="'+name+'"]');
 if(!node){node=document.createElement("meta");property?node.setAttribute("property",name):node.setAttribute("name",name);document.head.append(node);}
 node.setAttribute("content",content||"");
}
async function render(){
 if(!slug){notFound();return;}
 const {data,error}=await db.from("landing_pages").select("title,slug,excerpt,content_html,primary_image_url,meta_title,meta_description,published_at,status").eq("slug",slug).eq("status","published").maybeSingle();
 if(error||!data){notFound();return;}
 const canonical="https://bospangan.com/landingpage/"+encodeURIComponent(data.slug);
 document.title=(data.meta_title||data.title)+" | Bos Pangan";
 meta("description",data.meta_description||data.excerpt);
 meta("og:title",data.meta_title||data.title,true);meta("og:description",data.meta_description||data.excerpt,true);
 meta("og:type","website",true);if(data.primary_image_url)meta("og:image",data.primary_image_url,true);
 let link=document.querySelector('link[rel="canonical"]');if(!link){link=document.createElement("link");link.rel="canonical";document.head.append(link);}link.href=canonical;
 const safe=window.DOMPurify?DOMPurify.sanitize(data.content_html,{USE_PROFILES:{html:true}}):esc(data.content_html);
 $("page").innerHTML='<section class="hero"><div class="wrap hero-inner"><div class="eyebrow">Bos Pangan · Juara Pangan Lokal</div><h1>'+esc(data.title)+'</h1>'+(data.excerpt?'<p class="excerpt">'+esc(data.excerpt)+'</p>':'')+(data.primary_image_url?'<img class="primary-image" src="'+esc(data.primary_image_url)+'" alt="'+esc(data.title)+'">':'')+'</div></section><article class="wrap content">'+safe+'</article>';
}
function notFound(){
 document.title="Halaman Tidak Ditemukan | Bos Pangan";
 $("page").innerHTML='<div class="wrap not-found"><h1>Halaman tidak ditemukan</h1><p>Landing page ini belum tersedia atau belum dipublikasikan.</p><a href="/">Kembali ke Bos Pangan</a></div>';
}
render().catch(notFound);
