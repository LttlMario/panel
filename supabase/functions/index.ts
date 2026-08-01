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
    const { data: savedConfig, error: configError } = await supabase
          .from('discord_panel_config')
          .select('guild_id,guild_id_secondary')
          .eq('id', 1)
          .maybeSingle();
    if (configError) throw configError;

    const guildIds = [...new Set([
      savedConfig?.guild_id,
      savedConfig?.guild_id_secondary
    ].filter((guildId): guildId is string => typeof guildId === 'string' && guildId.trim().length > 0))];

    if (!guildIds.length) {
      throw new Error('Nu există niciun server Discord configurat.');
    }

    const discordHeaders = { Authorization: `Bearer ${access_token}` };
    const userResponse = await fetch('https://discord.com/api/v10/users/@me', { headers: discordHeaders });
    if (!userResponse.ok) {
      return new Response(JSON.stringify({ error: 'Sesiunea Discord nu mai este validă.' }), { status: 401, headers: corsHeaders });
    }
    const discordUser = await userResponse.json();
    const primaryBotToken = Deno.env.get('DISCORD_BOT_TOKEN')?.trim();
    const secondaryBotToken = Deno.env.get('DISCORD_SECONDARY_BOT_TOKEN')?.trim();

    let member: any = null;
    const memberRoleIds = new Set<string>();
    const guildResults: Array<{ guild_id: string; status: number; roles: string[] }> = [];

    for (const guildId of guildIds) {

      const memberResponse = await fetch(
        `https://discord.com/api/v10/users/@me/guilds/${guildId}/member`,
        { headers: discordHeaders },
      );

      if (memberResponse.ok) {
        let guildMember = await memberResponse.json();

        // Daca tokenul OAuth nu livreaza rolurile, citim acelasi membru direct
        // prin botul instalat in server. Tokenurile botilor raman doar in
        // Supabase Edge Function Secrets.
        if (!Array.isArray(guildMember.roles) || guildMember.roles.length === 0) {
          const botToken = guildId === savedConfig?.guild_id_secondary
            ? secondaryBotToken || primaryBotToken
            : primaryBotToken;

          if (botToken) {
            const botMemberResponse = await fetch(
              `https://discord.com/api/v10/guilds/${guildId}/members/${discordUser.id}`,
              { headers: { Authorization: `Bot ${botToken}` } },
            );

            if (botMemberResponse.ok) {
              guildMember = await botMemberResponse.json();
              console.log('Roluri citite prin bot pentru guild:', guildId);
            } else {
              console.warn(
                'Botul nu poate citi membrul pentru guild:',
                guildId,
                'status:',
                botMemberResponse.status,
              );
            }
          } else {
            console.warn('Lipseste tokenul botului pentru guild:', guildId);
          }
        }
        if (!member) member = guildMember;

        const roles = Array.isArray(guildMember.roles)
          ? guildMember.roles.filter((role: unknown): role is string => typeof role === 'string')
          : [];

        for (const roleId of roles) memberRoleIds.add(roleId);
        guildResults.push({ guild_id: guildId, status: memberResponse.status, roles });
        console.log('Discord guild verificat:', guildId, 'roluri:', roles);
      } else {
        guildResults.push({ guild_id: guildId, status: memberResponse.status, roles: [] });
        console.warn('Discord guild indisponibil:', guildId, 'status:', memberResponse.status);
      }

    }

    const { data: mappings, error: mappingsError } = await supabase
      .from('discord_role_mappings')
        .select(`
        discord_role_id,
        discord_role_id_secondary,
        panel_role,
        permission_level,
        priority
        `)
      .eq('enabled', true)
      .order('permission_level', { ascending: false })
      .order('priority', { ascending: false });
    if (mappingsError) throw mappingsError;

    const normalizedMappings = (mappings ?? []).map((mapping) => ({
      ...mapping,
      discord_role_id: String(mapping.discord_role_id || '').trim(),
      discord_role_id_secondary: String(mapping.discord_role_id_secondary || '').trim(),
      permission_level: Number(mapping.permission_level) || 0,
      priority: Number(mapping.priority) || 0,
    }));

    const matchedRoles = normalizedMappings
      .filter((mapping) =>
        memberRoleIds.has(mapping.discord_role_id) ||
        memberRoleIds.has(mapping.discord_role_id_secondary)
      )
      .sort((a, b) =>
        b.permission_level - a.permission_level || b.priority - a.priority
      );

    const configuredRoleIds = new Set(
      normalizedMappings.flatMap((mapping) => [
        mapping.discord_role_id,
        mapping.discord_role_id_secondary,
      ]).filter(Boolean),
    );
    const unmappedRoleIds = [...memberRoleIds].filter((roleId) => !configuredRoleIds.has(roleId));
    console.log('Roluri Discord reunite:', [...memberRoleIds]);
    console.log(
      'Mapari potrivite:',
      matchedRoles.map((mapping) => ({
        panel_role: mapping.panel_role,
        permission_level: mapping.permission_level,
        primary: mapping.discord_role_id,
        secondary: mapping.discord_role_id_secondary,
      })),
    );
    if (unmappedRoleIds.length) console.warn('Roluri Discord fara mapare:', unmappedRoleIds);

    const matchedRole = matchedRoles[0];
    const panelRole = matchedRole?.panel_role ?? 'Vizitator';
    const avatar = discordAvatarUrl(discordUser.id, discordUser.avatar);
    const permissionLevel = matchedRole?.permission_level ?? 0;
    console.log(
      'Rol final panel:',
      panelRole,
      'nivel:',
      permissionLevel,
      'utilizator:',
      discordUser.id,
    );

    const userData = {
      discord_id: discordUser.id,
      username: discordUser.username,
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
      permission_level: permissionLevel,
    };

    const { data: savedUser, error: saveError } = await supabase
      .from('users')
      .upsert(userData, { onConflict: 'discord_id' })
      .select('*')
      .single();
    if (saveError) throw saveError;

    return new Response(JSON.stringify({
      user: { ...savedUser, permission_level: permissionLevel },
      permission_level: permissionLevel,
      guilds: guildResults,
    }), { headers: corsHeaders });
  } catch (error) {
    console.error('Discord role sync failed:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Eroare necunoscută.' }), { status: 500, headers: corsHeaders });
  }
});
