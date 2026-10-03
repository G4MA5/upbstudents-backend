-- =====================================================================
-- Stockage de la session WhatsApp et de la file d'attente (wa-service)
-- ---------------------------------------------------------------------
create table if not exists public.wa_state (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Sécurité : seule la clé service (wa-service) y accède.
-- RLS activé sans politique = aucun accès public, même avec la clé anonyme.
alter table public.wa_state enable row level security;
