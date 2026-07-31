import { createClient } from 'jsr:@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const roleLevel=(value:unknown)=>{const text=String(value||'').toLowerCase();const number=Number(value);if(Number.isFinite(number))return number;if(text.includes('admin')||text.includes('owner'))return 7;if(text.includes('manager'))return 4;return 1};
Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  try{
    const body=await request.json(), token=String(body.access_token||'');
    if(!token)return reply({error:'Sesiunea Discord lipsește.'},401);
    const discordResponse=await fetch('https://discord.com/api/users/@me',{headers:{authorization:`Bearer ${token}`}});
    if(!discordResponse.ok)return reply({error:'Sesiunea Discord a expirat.'},401);
    const discordUser=await discordResponse.json();
    const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')??'{}');
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||keys.default;
    if(!serviceKey)return reply({error:'Cheia de server lipsește.'},500);
    const db=createClient(Deno.env.get('SUPABASE_URL')!,serviceKey);
    const {data:user}=await db.from('users').select('display_name,username,role,default_role').eq('discord_id',discordUser.id).maybeSingle();
    if(!user)return reply({error:'Utilizatorul nu este înregistrat în panel.'},403);
    const level=roleLevel(user.role||user.default_role), actorName=user.display_name||user.username||discordUser.username;
    if(body.action==='notifications'){
      const {data:notes,error}=await db.from('panel_notifications').select('*').or(`recipient_discord_id.is.null,recipient_discord_id.eq.${discordUser.id}`).order('created_at',{ascending:false}).limit(40);if(error)throw error;
      const {data:reads}=await db.from('panel_notification_reads').select('notification_id').eq('discord_id',discordUser.id);
      return reply({notifications:notes||[],read_ids:(reads||[]).map(x=>x.notification_id)});
    }
    if(body.action==='mark_read'){
      const ids=(Array.isArray(body.ids)?body.ids:[]).slice(0,100);if(ids.length)await db.from('panel_notification_reads').upsert(ids.map((id:unknown)=>({notification_id:id,discord_id:discordUser.id})),{onConflict:'notification_id,discord_id'});return reply({ok:true});
    }
    if(level<7)return reply({error:'Acțiunea necesită rol de administrator.'},403);
    if(body.action==='audit'){
      const {error}=await db.from('admin_audit_log').insert({actor_discord_id:discordUser.id,actor_name:actorName,action:String(body.event||'admin_action').slice(0,120),target_type:body.target_type||null,target_id:body.target_id==null?null:String(body.target_id),details:body.details||{}});if(error)throw error;return reply({ok:true});
    }
    if(body.action==='create_notification'){
      const title=String(body.title||'').trim().slice(0,120),message=String(body.message||'').trim().slice(0,1000);if(!title||!message)return reply({error:'Titlul și mesajul sunt obligatorii.'},400);
      const {data,error}=await db.from('panel_notifications').insert({title,message,level:['info','success','warning','error'].includes(body.level)?body.level:'info',recipient_discord_id:String(body.recipient||'').trim()||null,link:String(body.link||'').trim()||null}).select('id').single();if(error)throw error;
      await db.from('admin_audit_log').insert({actor_discord_id:discordUser.id,actor_name:actorName,action:'notification_create',target_type:'panel_notification',target_id:String(data.id),details:{recipient:body.recipient||'all'}});return reply({id:data.id});
    }
    if(body.action==='import_config'){
      const value=body.value;if(!value||typeof value!=='object')return reply({error:'Configurație invalidă.'},400);const {error}=await db.from('app_settings').upsert({key:'pontaj_config',value,updated_at:new Date().toISOString()},{onConflict:'key'});if(error)throw error;await db.from('admin_audit_log').insert({actor_discord_id:discordUser.id,actor_name:actorName,action:'config_import',target_type:'app_settings',target_id:'pontaj_config'});return reply({ok:true});
    }
    return reply({error:'Acțiune necunoscută.'},400);
  }catch(error){return reply({error:error instanceof Error?error.message:'Eroare internă.'},500)}
});
