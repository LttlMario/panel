-- Configurare completa pentru al doilea server Discord.
-- Migrarea este idempotenta si poate fi rulata si pe proiecte existente.

alter table public.discord_panel_config
  add column if not exists discord_client_id_secondary text,
  add column if not exists guild_id_secondary text,
  add column if not exists organization_name text,
  add column if not exists organization_code text,
  add column if not exists organization_description text,
  add column if not exists organization_logo text,
  add column if not exists organization_banner text;

alter table public.discord_role_mappings
  add column if not exists discord_role_id_secondary text,
  add column if not exists discord_role_name_secondary text;

create index if not exists discord_role_mappings_secondary_role_idx
  on public.discord_role_mappings(discord_role_id_secondary)
  where discord_role_id_secondary is not null;

alter table public.discord_panel_config
  drop constraint if exists discord_panel_config_secondary_pair_check;

alter table public.discord_panel_config
  add constraint discord_panel_config_secondary_pair_check check (
    (nullif(trim(discord_client_id_secondary), '') is null and nullif(trim(guild_id_secondary), '') is null)
    or
    (nullif(trim(discord_client_id_secondary), '') is not null and nullif(trim(guild_id_secondary), '') is not null)
  );
