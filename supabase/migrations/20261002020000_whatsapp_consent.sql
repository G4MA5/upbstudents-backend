-- =====================================================================
-- Consentement aux notifications WhatsApp (opt-in)
-- ---------------------------------------------------------------------

alter table public.utilisateurs
  add column if not exists whatsapp_optin    boolean     null,
  add column if not exists whatsapp_optin_at timestamptz null;
