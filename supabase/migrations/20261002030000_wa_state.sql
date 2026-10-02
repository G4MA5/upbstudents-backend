-- =====================================================================
-- Stockage de la session WhatsApp et de la file d'attente (wa-service)
-- ---------------------------------------------------------------------
-- À coller dans Supabase → SQL Editor → Run.
-- Idempotent et non destructif : crée seulement une nouvelle table.
--
-- Utile quand wa-service est hébergé sur un disque éphémère (ex. Render
-- gratuit) : la session WhatsApp et la file survivent aux redémarrages,
-- sans rescanner le QR code.
--
--   "session:<nom>"  fichiers de la session WhatsApp (SECRETS : donnent
--                    accès au compte WhatsApp)
--   "queue"          file d'attente et campagnes en cours
-- =====================================================================

create table if not exists public.wa_state (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Sécurité : seule la clé service (wa-service) y accède.
-- RLS activé sans politique = aucun accès public, même avec la clé anonyme.
alter table public.wa_state enable row level security;
