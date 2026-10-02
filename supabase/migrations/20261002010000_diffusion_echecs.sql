-- =====================================================================
-- Détail des échecs d'une diffusion WhatsApp
-- ---------------------------------------------------------------------

alter table public.diffusion
  add column if not exists echecs_detail jsonb not null default '[]'::jsonb;
