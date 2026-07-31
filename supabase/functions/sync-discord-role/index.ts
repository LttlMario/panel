import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

function getServiceKey() {
  const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacyKey) return legacyKey;

  const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
  return keys.default;
}

function discordAvatarUrl(discordId: string, avatar: string | null) {
  return avatar
    ? `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png`
    : 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f468-200d-1f4bb.png';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  try {
    const { access_token } = await request.json();
    if (!access_token || typeof access_token !== 'string') {
      return new Response(JSON.stringify({ error: 'Lipsește tokenul Discord.' }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, getServiceKey());
    const { data: savedConfig } = await supabase
      .from('discord_panel_config')
      .select('guild_id')
      .eq('id', 1)
      .maybeSingle();
    const guildId = savedConfig?.guild_id || Deno.env.get('DISCORD_GUILD_ID');
    if (!guildId) {
      throw new Error('Secretul DISCORD_GUILD_ID nu este configurat.');
    }

    const discordHeaders = { Authorization: `Bearer ${access_token}` };
    const userResponse = await fetch('https://discord.com/api/v10/users/@me', { headers: discordHeaders });
    if (!userResponse.ok) {
      return new Response(JSON.stringify({ error: 'Sesiunea Discord nu mai este validă.' }), { status: 401, headers: corsHeaders });
    }
    const discordUser = await userResponse.json();

    const memberResponse = await fetch(
      `https://discord.com/api/v10/users/@me/guilds/${guildId}/member`,
      { headers: discordHeaders },
    );

    // Dacă utilizatorul nu este pe server,
    // îl tratăm ca Vizitator (Guest).
    let member: any = null;
    let memberRoleIds = new Set<string>();

    if (memberResponse.ok) {
      member = await memberResponse.json();
      memberRoleIds = new Set<string>(member.roles ?? []);
}

    const { data: mappings, error: mappingsError } = await supabase
      .from('discord_role_mappings')
      .select('discord_role_id, panel_role, permission_level, priority')
      .eq('enabled', true)
      .order('permission_level', { ascending: false })
      .order('priority', { ascending: false });
    if (mappingsError) throw mappingsError;

    const matchedRole = (mappings ?? []).find((mapping) => memberRoleIds.has(mapping.discord_role_id));
    const panelRole = matchedRole?.panel_role ?? 'Vizitator';
    const avatar = discordAvatarUrl(discordUser.id, discordUser.avatar);
    const userData = {
      discord_id: discordUser.id,
      username: discordUser.username,
      // La fiecare autentificare rescriem numele din profilul membrului serverului Discord.
      display_name:
        member?.nick?.trim()
        || member?.user?.global_name?.trim()
        || discordUser.global_name?.trim()
        || member?.user?.username
        || discordUser.username,
      email: discordUser.email ?? null,
      avatar,
      role: panelRole,
      default_role: panelRole,
    };

    const { data: savedUser, error: saveError } = await supabase
      .from('users')
      .upsert(userData, { onConflict: 'discord_id' })
      .select('*')
      .single();
    if (saveError) throw saveError;

    const permissionLevel = matchedRole?.permission_level ?? 0;
    return new Response(JSON.stringify({
      user: { ...savedUser, permission_level: permissionLevel },
      permission_level: permissionLevel,
    }), { headers: corsHeaders });
  } catch (error) {
    console.error('Discord role sync failed:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Eroare necunoscută.' }), { status: 500, headers: corsHeaders });
  }
});
