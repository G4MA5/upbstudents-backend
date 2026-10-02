-- =====================================================================
-- Historique des diffusions WhatsApp (annonces envoyées par les admins)
-- ---------------------------------------------------------------------

begin;

create table if not exists public.diffusion (
  id             text primary key,                    -- identifiant de la campagne
  created_at     timestamptz not null default now(),  -- date de lancement
  updated_at     timestamptz not null default now(),  -- dernière synchro de l'état
  admin_user_id  uuid null references auth.users (id) on delete set null,
  admin_email    text not null,                       -- qui a diffusé
  canal          text not null default 'whatsapp',
  type           text not null
                 check (type in ('tous', 'filiere', 'niveau', 'contributeurs', 'liste', 'mixte')),
  cible          jsonb not null default '{}'::jsonb,  -- filtres choisis
  message        text not null,                       -- texte diffusé (avec {prenom} / {nom})
  total          integer not null default 0,          -- destinataires
  envoyes        integer not null default 0,
  echecs         integer not null default 0,
  annules        integer not null default 0,
  erreurs        jsonb not null default '{}'::jsonb,  -- détail des échecs
  statut         text not null default 'en_cours'
                 check (statut in ('en_cours', 'terminee', 'annulee', 'echec', 'interrompue')),
  termine_le     timestamptz null
);

create index if not exists diffusion_created_idx on public.diffusion (created_at desc);
create index if not exists diffusion_statut_idx  on public.diffusion (statut);

-- Seules les routes API (clé service) accèdent à cette table :
-- RLS activé sans politique = aucun accès public direct.
alter table public.diffusion enable row level security;

commit;
