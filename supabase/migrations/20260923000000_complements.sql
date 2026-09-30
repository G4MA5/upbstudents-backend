-- =====================================================================
-- Compléments au schéma existant (tables document et utilisateurs)
-- ---------------------------------------------------------------------
-- À coller dans Supabase → SQL Editor → Run.
-- Idempotent : peut être exécuté plusieurs fois sans erreur.
-- Non destructif : aucune ligne existante n'est modifiée ni supprimée,
-- aucune colonne existante n'est changée.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. document.id doit être unique pour pouvoir être référencé
--    (la clé primaire de document est doc_id ; id est l'identifiant
--    numérique utilisé par l'application).
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'document'
      and indexdef ilike 'create unique index%(id)'
  ) then
    alter table public.document add constraint document_id_key unique (id);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Date d'ajout des documents
--    Les documents existants gardent une date vide (inconnue) ; tous les
--    nouveaux documents reçoivent automatiquement la date d'ajout.
-- ---------------------------------------------------------------------
alter table public.document add column if not exists created_at timestamptz;
alter table public.document alter column created_at set default now();

-- ---------------------------------------------------------------------
-- 3. Index utiles (recherche par filière / type, profil par compte)
-- ---------------------------------------------------------------------
create index if not exists document_filiere_type_idx on public.document (filiere, type);
create index if not exists document_admis_idx        on public.document (admis);
create index if not exists utilisateurs_user_id_idx  on public.utilisateurs (user_id);

-- ---------------------------------------------------------------------
-- 4. Favoris : un étudiant ↔ un document
--    Supprimer un compte ou un document retire aussi le favori.
-- ---------------------------------------------------------------------
create table if not exists public.favori (
  user_id      uuid        not null references auth.users (id)      on delete cascade,
  document_id  bigint      not null references public.document (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (user_id, document_id)
);

create index if not exists favori_user_idx on public.favori (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- 5. Propositions de documents (en attente de validation)
--    Un document proposé n'apparaît JAMAIS dans la bibliothèque tant
--    qu'un contributeur autorisé ne l'a pas publié.
-- ---------------------------------------------------------------------
create table if not exists public.proposition (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  statut          text not null default 'en_attente'
                  check (statut in ('en_attente', 'publiee', 'refusee')),
  user_id         uuid   null references auth.users (id)      on delete set null,
  nom             text   not null,
  email           text   not null,
  filiere         text   not null,
  niveau          text   not null,
  type            text   not null,
  matiere         text   not null,
  annee           text   not null,
  session         text,
  description     text,
  fichier_path    text   not null unique,
  fichier_nom     text,
  fichier_type    text,
  fichier_taille  bigint,
  motif           text,
  document_id     bigint null references public.document (id) on delete set null,
  traite_le       timestamptz
);

create index if not exists proposition_statut_idx on public.proposition (statut, created_at);

-- ---------------------------------------------------------------------
-- 6. Sécurité : seules les routes API (clé service) accèdent à ces
--    tables. RLS activé sans politique = aucun accès public direct.
-- ---------------------------------------------------------------------
alter table public.favori      enable row level security;
alter table public.proposition enable row level security;

-- ---------------------------------------------------------------------
-- 7. Bucket privé pour les fichiers proposés (20 Mo, formats acceptés)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'propositions',
  'propositions',
  false,
  20971520,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do nothing;

commit;
