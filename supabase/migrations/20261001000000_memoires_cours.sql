-- =====================================================================
-- Migration : Support des mémoires et des cours (colonnes auteur et mention)
-- ---------------------------------------------------------------------
-- À exécuter dans Supabase → SQL Editor → Run.
-- Idempotent : peut être exécuté plusieurs fois sans erreur.
-- =====================================================================

begin;

-- Ajout des colonnes auteur et mention pour les mémoires de fin d'études
alter table public.document add column if not exists auteur text;
alter table public.document add column if not exists mention text;

alter table public.proposition add column if not exists auteur text;
alter table public.proposition add column if not exists mention text;

commit;
