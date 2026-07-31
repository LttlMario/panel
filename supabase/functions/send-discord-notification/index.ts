import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Content-Type':'application/json'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:cors});
const levels:Record<string,number>={pontaj:1,requests:1,contracts:4,marketplace:1,illegal_marketplace:3};
const fields:Record<string,string>={pontaj:'pontaj_webhook_url',requests:'requests_webhook_url',contracts:'contracts_webhook_url',marketplace:'marketplace_webhook_url',illegal_marketplace:'illegal_marketplace_webhook_url'};
const roleLevel=(role:string)=>{const value=String(role||'').toLocaleLowerCase('ro-RO');if(value.includes('coordonator')||['admin','owner'].includes(value))return 7;if(value==='lider')return 6;if(['colider','co lider','co-lider'].includes(value))return 5;if(value.includes('manager'))return 4;if(value.includes('familia'))return 3;if(value.includes('sef')||value.includes('șef'))return 2;return 1};

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(request.method!=='POST')return reply({error:'Metodă invalidă.'},405);
  try{
    const contentType=request.headers.get('content-type')||'';
    let channel='',token='',payload:unknown,forwardBody:BodyInit,forwardHeaders:Record<string,string>={};
    if(contentType.includes('multipart/form-data')){
      const form=await request.formData();channel=String(form.get('_panel_channel')||'');token=String(form.get('_panel_access_token')||'');form.delete('_panel_channel');form.delete('_panel_access_token');forwardBody=form;
    }else{
      const body=await request.json();channel=String(body.channel||'');token=String(body.access_token||'');payload=body.payload;forwardBody=JSON.stringify(payload);forwardHeaders['Content-Type']='application/json';
    }
    if(!fields[channel])return reply({error:'Canal Discord invalid.'},400);
    const me=await fetch('https://discord.com/api/v10/users/@me',{headers:{Authorization:`Bearer ${token}`}});if(!me.ok)return reply({error:'Sesiunea Discord a expirat.'},401);const discordUser=await me.json();
    const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')??'{}'),serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||keys.default;if(!serviceKey)throw new Error('Cheia service role lipsește.');const db=createClient(Deno.env.get('SUPABASE_URL')!,serviceKey);
    const {data:user}=await db.from('users').select('role,default_role').eq('discord_id',discordUser.id).maybeSingle();if(!user||roleLevel(user.role||user.default_role)<levels[channel])return reply({error:'Nu ai nivelul necesar pentru această notificare.'},403);
    const {data:config,error}=await db.from('discord_panel_config').select(fields[channel]).eq('id',1).maybeSingle();if(error)throw error;const webhook=config?.[fields[channel]];if(!webhook)throw new Error(`Webhook-ul ${channel} nu este configurat.`);
    const sent=await fetch(webhook,{method:'POST',headers:forwardHeaders,body:forwardBody});if(!sent.ok)throw new Error(`Discord a răspuns cu HTTP ${sent.status}.`);return reply({ok:true});
  }catch(error){console.error(error);return reply({error:error instanceof Error?error.message:'Eroare necunoscută.'},400)}
});
