// Renvoie l'e-mail de confirmation à tous les comptes Supabase dont l'adresse
// n'est pas encore confirmée.
//
// À lancer sur votre ordinateur uniquement (jamais dans le frontend) : le
// script utilise la clé service_role pour lister les comptes.
//
//   npm run relancer-confirmations                 → simulation (aucun envoi)
//   npm run relancer-confirmations -- --envoyer    → envoi réel
//
// Options :
//   --envoyer        envoie réellement les e-mails (sinon : simulation)
//   --limite=50      nombre maximum d'e-mails envoyés pendant ce lancement
//   --pause=3000     délai entre deux envois, en millisecondes
//   --depuis=2026-09-01  seulement les comptes créés depuis cette date
//
// Un journal (scripts/.relance-confirmations.json) retient les adresses déjà
// relancées : si l'envoi s'arrête (limite d'envoi Supabase atteinte), il suffit
// de relancer la commande plus tard, elle reprend là où elle s'était arrêtée.
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const env = (...names) => names.map((n) => process.env[n]).find(Boolean);
const URL_SUPABASE = env("supabase_url", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
const CLE_SERVICE = env("supabase_service_role_key", "SUPABASE_SERVICE_ROLE_KEY");
const FRONTEND_URL = (env("FRONTEND_URL") || "https://upbstudents-labibliotheque.com").replace(/\/+$/, "");

const JOURNAL = new URL("./.relance-confirmations.json", import.meta.url);
// Une adresse relancée il y a moins de 24 h n'est pas relancée à nouveau.
const DELAI_ENTRE_RELANCES = 24 * 60 * 60 * 1000;

function options() {
  const args = process.argv.slice(2);
  const valeur = (nom) => args.find((a) => a.startsWith(`--${nom}=`))?.split("=")[1];
  const depuis = valeur("depuis");
  return {
    envoyer: args.includes("--envoyer"),
    limite: Number(valeur("limite")) || Number.POSITIVE_INFINITY,
    pause: Number(valeur("pause")) || 3000,
    depuis: depuis ? new Date(depuis) : null,
  };
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

async function lireJournal() {
  try {
    return JSON.parse(await readFile(JOURNAL, "utf8"));
  } catch {
    return {};
  }
}

/** Tous les comptes non confirmés (la liste Supabase est paginée). */
async function comptesNonConfirmes(supabase, depuis) {
  const resultat = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) {
      if (u.email_confirmed_at || !u.email) continue;
      if (u.banned_until && new Date(u.banned_until) > new Date()) continue;
      if (depuis && new Date(u.created_at) < depuis) continue;
      resultat.push(u);
    }
    if (data.users.length < 1000) return resultat;
  }
}

async function main() {
  if (!URL_SUPABASE || !CLE_SERVICE) {
    console.error(
      "Variables manquantes : supabase_url et supabase_service_role_key.\n" +
        "Ajoutez-les dans le fichier .env (ou .env.local) du backend.",
    );
    process.exit(1);
  }

  const opts = options();
  const supabase = createClient(URL_SUPABASE, CLE_SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const journal = await lireJournal();
  const comptes = await comptesNonConfirmes(supabase, opts.depuis);
  const maintenant = Date.now();
  const aRelancer = comptes.filter((u) => {
    const derniere = journal[u.email] ? Date.parse(journal[u.email]) : 0;
    return maintenant - derniere > DELAI_ENTRE_RELANCES;
  });

  console.log(`Comptes non confirmés : ${comptes.length}`);
  console.log(`Déjà relancés ces dernières 24 h : ${comptes.length - aRelancer.length}`);
  console.log(`À relancer maintenant : ${aRelancer.length}\n`);

  if (!opts.envoyer) {
    for (const u of aRelancer) {
      console.log(`  ${u.email}  (inscrit le ${new Date(u.created_at).toLocaleDateString("fr-FR")})`);
    }
    console.log("\nSimulation : aucun e-mail envoyé. Ajoutez --envoyer pour lancer l'envoi.");
    return;
  }

  let envoyes = 0;
  let echecs = 0;

  for (const u of aRelancer) {
    if (envoyes >= opts.limite) break;

    const { error } = await supabase.auth.resend({
      type: "signup",
      email: u.email,
      options: { emailRedirectTo: `${FRONTEND_URL}/?compte=confirme` },
    });

    if (error) {
      // Limite d'envoi atteinte : inutile d'insister, on reprendra plus tard.
      if (error.status === 429 || /rate limit|security purposes/i.test(error.message)) {
        console.error(`\nLimite d'envoi Supabase atteinte (${error.message}).`);
        console.error("Relancez la commande plus tard : elle reprendra là où elle s'est arrêtée.");
        break;
      }
      echecs++;
      console.error(`Échec : ${u.email} — ${error.message}`);
    } else {
      envoyes++;
      journal[u.email] = new Date().toISOString();
      await writeFile(JOURNAL, JSON.stringify(journal, null, 2));
      console.log(`Envoyé (${envoyes}/${aRelancer.length}) : ${u.email}`);
    }

    await attendre(opts.pause);
  }

  const restants = aRelancer.length - envoyes - echecs;
  console.log(`\nTerminé : ${envoyes} envoyés, ${echecs} échecs, ${restants} restants.`);
}

main().catch((err) => {
  console.error("Erreur :", err.message || err);
  process.exit(1);
});
