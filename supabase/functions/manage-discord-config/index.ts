import { createClient } from 'jsr:@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,apikey,content-type',
  'Content-Type': 'application/json',
};
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
type DiagnosticStatus = 'ok' | 'warning' | 'error';
type DiagnosticResult = { id: string; category: string; label: string; status: DiagnosticStatus; message: string; duration_ms?: number };
const safeFetch = async (url: string, init: RequestInit = {}, timeout = 8000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
};
const level = (role: string) => {
  const value = String(role || '').toLocaleLowerCase('ro-RO');
  if (value.includes('coordonator') || value === 'admin' || value === 'owner') return 7;
  if (value === 'lider') return 6;
  if (['colider', 'co lider', 'co-lider'].includes(value)) return 5;
  if (value.includes('manager')) return 4;
  if (value.includes('familia')) return 3;
  if (value.includes('sef') || value.includes('șef')) return 2;
  return 1;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return reply({ error: 'Metodă invalidă.' }, 405);
  try {
    const body = await request.json();
    const token = body.access_token;
    if (!token) return reply({ error: 'Sesiunea Discord lipsește.' }, 401);

    const discordResponse = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!discordResponse.ok) return reply({ error: 'Sesiunea Discord a expirat.' }, 401);
    const discordUser = await discordResponse.json();

    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || keys.default;
    if (!serviceKey) throw new Error('Cheia service role nu este configurată.');
    const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
    const { data: panelUser, error: userError } = await db.from('users').select('role,default_role').eq('discord_id', discordUser.id).maybeSingle();
    if (userError) throw userError;
    if (!panelUser || level(panelUser.role || panelUser.default_role) !== 7) return reply({ error: 'Este necesar nivelul 7.' }, 403);

    if (body.action === 'get') {
      const [{ data: config, error: configError }, { data: mappings, error: mappingsError }] = await Promise.all([
        db.from('discord_panel_config').select('*').eq('id', 1).maybeSingle(),
        db.from('discord_role_mappings').select('*').order('permission_level'),
      ]);
      if (configError) throw configError;
      if (mappingsError) throw mappingsError;
      return reply({ config, mappings: mappings || [] });
    }

    if (body.action === 'diagnose') {
      const results: DiagnosticResult[] = [];
      const add = (id: string, category: string, label: string, status: DiagnosticStatus, message: string, duration_ms?: number) =>
        results.push({ id, category, label, status, message, ...(duration_ms === undefined ? {} : { duration_ms }) });
      const check = async (id: string, category: string, label: string, task: () => Promise<{ status?: DiagnosticStatus; message: string }>) => {
        const started = Date.now();
        try { const outcome = await task(); add(id, category, label, outcome.status || 'ok', outcome.message, Date.now() - started); }
        catch (error) { add(id, category, label, 'error', error instanceof Error ? error.message : 'Verificarea a eșuat.', Date.now() - started); }
      };

      const [{ data: config, error: configError }, { data: mappings, error: mappingsError }] = await Promise.all([
        db.from('discord_panel_config').select('*').eq('id', 1).maybeSingle(),
        db.from('discord_role_mappings').select('discord_role_id,discord_role_name,panel_role,permission_level,enabled').order('permission_level'),
      ]);
      if (configError) throw configError;
      if (mappingsError) throw mappingsError;

      await check('database-schema', 'Supabase', 'Schema și securitate', async () => {
        const { data, error } = await db.rpc('get_panel_system_diagnostics');
        if (error) throw new Error(`Rulează migrarea pentru diagnosticare: ${error.message}`);
        const missing = Array.isArray(data?.missing_tables) ? data.missing_tables : [];
        const rlsMissing = Array.isArray(data?.rls_disabled_tables) ? data.rls_disabled_tables : [];
        const cron = Boolean(data?.cleanup_cron_active);
        if (missing.length) return { status: 'error', message: `Lipsesc tabele: ${missing.join(', ')}.` };
        if (rlsMissing.length) return { status: 'warning', message: `RLS este dezactivat pentru: ${rlsMissing.join(', ')}.` };
        return { status: cron ? 'ok' : 'warning', message: cron ? 'Tabelele, RLS și curățarea automată sunt configurate.' : 'Tabelele și RLS sunt configurate, dar programarea curățării nu este activă.' };
      });

      await check('current-user', 'Supabase', 'Utilizatorul administrator', async () => {
        const { data, error } = await db.from('users').select('display_name,username').eq('discord_id', discordUser.id).maybeSingle();
        if (error) throw error;
        if (!data) return { status: 'error', message: 'Utilizatorul Discord nu există în tabela users.' };
        const display = String(data.display_name || '').trim();
        return display ? { message: `Utilizator sincronizat: ${display}.` } : { status: 'warning', message: 'Utilizatorul există, dar display_name nu este completat.' };
      });

      const missingConfig = ['discord_client_id', 'guild_id', 'panel_public_url'].filter((key) => !String(config?.[key] || '').trim());
      add('discord-config', 'Discord', 'Aplicație și server', missingConfig.length ? 'error' : 'ok', missingConfig.length ? `Câmpuri necompletate: ${missingConfig.join(', ')}.` : 'Client ID, Guild ID și URL-ul public sunt salvate.');
      const validMappings = (mappings || []).filter((item: any) => item.enabled !== false && /^\d{15,22}$/.test(String(item.discord_role_id || '')) && item.discord_role_name && item.panel_role);
      const levels = new Set(validMappings.map((item: any) => Number(item.permission_level)));
      add('discord-roles', 'Discord', 'Cele 7 roluri', validMappings.length === 7 && levels.size === 7 ? 'ok' : 'error', validMappings.length === 7 && levels.size === 7 ? 'Toate cele 7 niveluri au nume și ID Discord valid.' : `Sunt valide ${validMappings.length} din 7 mapări de rol.`);

      const webhookFields: Array<[string, string]> = [
        ['family_webhook_url', 'Anunțuri Familie / Birouri'], ['mechanics_webhook_url', 'Anunțuri Angajați'], ['pontaj_webhook_url', 'Pontaj / Loguri'],
        ['requests_webhook_url', 'Cereri / Absențe'], ['contracts_webhook_url', 'Contracte'], ['marketplace_webhook_url', 'Marketplace'], ['illegal_marketplace_webhook_url', 'Black Market'],
      ];
      await Promise.all(webhookFields.map(([field, label]) => check(`webhook-${field}`, 'Webhook-uri', label, async () => {
        const url = String(config?.[field] || '').trim();
        if (!url) return { status: 'warning', message: 'Webhook necompletat.' };
        if (!/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+$/i.test(url)) return { status: 'error', message: 'Formatul URL-ului nu este valid.' };
        const response = await safeFetch(url, { method: 'GET' });
        return response.ok ? { message: 'Webhook valid și accesibil.' } : { status: 'error', message: `Discord a răspuns cu HTTP ${response.status}.` };
      })));

      const functionNames = ['sync-discord-role', 'manage-community-posts', 'send-discord-notification', 'close-expired-shifts'];
      await Promise.all(functionNames.map((name) => check(`edge-${name}`, 'Edge Functions', name, async () => {
        const response = await safeFetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/${name}`, { method: 'OPTIONS', headers: { Origin: String(config?.panel_public_url || 'https://localhost') } });
        return response.ok ? { message: 'Funcția este publicată și răspunde.' } : { status: 'error', message: `Funcția răspunde cu HTTP ${response.status}.` };
      })));
      add('edge-manage-discord-config', 'Edge Functions', 'manage-discord-config', 'ok', 'Funcția curentă este publicată și execută diagnosticul.');

      await check('public-panel', 'GitHub / site public', 'Pagina publică', async () => {
        const base = String(config?.panel_public_url || '').replace(/\/$/, '');
        if (!base) return { status: 'error', message: 'URL-ul public nu este configurat.' };
        const response = await safeFetch(`${base}/login.html`);
        return response.ok ? { message: 'Pagina login.html este publică și accesibilă.' } : { status: 'error', message: `login.html răspunde cu HTTP ${response.status}.` };
      });
      await check('public-supabase-config', 'GitHub / site public', 'Configurația Supabase publicată', async () => {
        const base = String(config?.panel_public_url || '').replace(/\/$/, '');
        if (!base) return { status: 'error', message: 'URL-ul public nu este configurat.' };
        const response = await safeFetch(`${base}/js/supabase-config.js`);
        if (!response.ok) return { status: 'error', message: `Fișierul răspunde cu HTTP ${response.status}.` };
        const content = await response.text();
        return content.includes(String(Deno.env.get('SUPABASE_URL') || '')) ? { message: 'Fișierul public indică proiectul Supabase curent.' } : { status: 'error', message: 'Fișierul public indică alt proiect Supabase.' };
      });
      await check('public-critical-pages', 'GitHub / site public', 'Scripturi pe paginile esențiale', async () => {
        const base = String(config?.panel_public_url || '').replace(/\/$/, '');
        const pages = ['login.html', 'index.html', 'pontaj.html', 'anunturi.html', 'discord-configurare.html'];
        const failed: string[] = [];
        await Promise.all(pages.map(async (page) => {
          const response = await safeFetch(`${base}/${page}`);
          if (!response.ok) { failed.push(`${page} (HTTP ${response.status})`); return; }
          if (!(await response.text()).includes('js/supabase-config.js')) failed.push(`${page} (lipsește supabase-config.js)`);
        }));
        return failed.length ? { status: 'error', message: failed.join('; ') } : { message: 'Paginile esențiale încarcă configurația Supabase.' };
      });

      const summary = results.reduce((acc, item) => { acc[item.status]++; return acc; }, { ok: 0, warning: 0, error: 0 });
      return reply({ checked_at: new Date().toISOString(), results, summary });
    }

    if (body.action === 'save') {
      const config = body.config || {};
      if (!/^\d{15,22}$/.test(String(config.discord_client_id || ''))) throw new Error('Client ID Discord invalid.');
      if (!/^\d{15,22}$/.test(String(config.guild_id || ''))) throw new Error('Guild ID Discord invalid.');
      try { new URL(config.panel_public_url); } catch { throw new Error('URL-ul public al panelului este invalid.'); }

      const configRow = {
        id: 1,
        discord_client_id: String(config.discord_client_id).trim(),
        guild_id: String(config.guild_id).trim(),
        panel_public_url: String(config.panel_public_url).replace(/\/$/, ''),
        family_role_id: config.family_role_id || null,
        mechanics_role_id: config.mechanics_role_id || null,
        family_webhook_url: config.family_webhook_url || null,
        mechanics_webhook_url: config.mechanics_webhook_url || null,
        pontaj_webhook_url: config.pontaj_webhook_url || null,
        requests_webhook_url: config.requests_webhook_url || null,
        contracts_webhook_url: config.contracts_webhook_url || null,
        marketplace_webhook_url: config.marketplace_webhook_url || null,
        illegal_marketplace_webhook_url: config.illegal_marketplace_webhook_url || null,
        updated_by_discord_id: discordUser.id,
        updated_at: new Date().toISOString(),
      };
      const { error: configError } = await db.from('discord_panel_config').upsert(configRow, { onConflict: 'id' });
      if (configError) throw configError;

      const mappings = Array.isArray(body.mappings) ? body.mappings : [];
      if (mappings.length !== 7) throw new Error('Trebuie completate toate cele 7 roluri.');
      const mappingRows = mappings.map((item: any) => ({
        discord_role_id: String(item.discord_role_id || '').trim(),
        discord_role_name: String(item.discord_role_name || '').trim(),
        panel_role: String(item.panel_role || '').trim(),
        permission_level: Number(item.permission_level),
        priority: Number(item.permission_level) * 10,
        enabled: true,
        updated_at: new Date().toISOString(),
      }));
      if (mappingRows.some((item: any) => !/^\d{15,22}$/.test(item.discord_role_id) || !item.discord_role_name || !item.panel_role || item.permission_level < 1 || item.permission_level > 7)) {
        throw new Error('Unul dintre roluri are ID-ul sau denumirea necompletată/invalidă.');
      }
      const { error: clearMappingsError } = await db.from('discord_role_mappings').delete().neq('discord_role_id', '');
      if (clearMappingsError) throw clearMappingsError;
      const { error: mappingsError } = await db.from('discord_role_mappings').insert(mappingRows);
      if (mappingsError) throw mappingsError;
      return reply({ ok: true });
    }

    return reply({ error: 'Acțiune necunoscută.' }, 400);
  } catch (error) {
    console.error(error);
    return reply({ error: error instanceof Error ? error.message : 'Eroare necunoscută.' }, 400);
  }
});
