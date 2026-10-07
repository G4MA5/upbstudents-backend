# Services externes — UpB Student's

Deux microservices Express (JavaScript, ESM, Node 20+) appelés en HTTP par le backend Next.js.

> **Mise en production** : [DEPLOY-RENDER.md](DEPLOY-RENDER.md) (**Render gratuit**, sans serveur : session stockée dans Supabase) ou [DEPLOY.md](DEPLOY.md) (VPS avec Docker + HTTPS).
Ils sont indépendants de Next : on peut les déployer, redémarrer et mettre à jour séparément.

| Service | Port | Rôle | Documentation |
|---|---|---|---|
| `wa-service` | 3001 | Notifications WhatsApp (Baileys, connexion par QR code) | [wa-service/README.md](wa-service/README.md) |
| `storage-service` | 3002 | Stockage de documents : Supabase Storage, Cloudinary en repli | [storage-service/README.md](storage-service/README.md) |

```
                 x-api-key                        ┌──────────────────────┐
 Next (route  ───────────────►  wa-service :3001 ─┤ Baileys → WhatsApp   │
 handlers,    ───────────────►  storage-service   ├──────────────────────┤
 serveur)                       :3002             │ Supabase → Cloudinary│
                                                  └──────────────────────┘
```

> **Règle d'or** : les services ne sont appelés que depuis le **serveur** Next (route handlers, server actions). Jamais depuis le navigateur : la clé API ne doit jamais être exposée au client.

## Sommaire

1. [Prérequis](#prérequis)
2. [Installation et lancement local](#installation-et-lancement-local)
3. [Variables d'environnement](#variables-denvironnement)
4. [Docker](#docker)
5. [Sécurité](#sécurité)
6. [Idempotence](#idempotence)
7. [Correspondance e-mails ↔ WhatsApp (intégration dans Next)](#correspondance-e-mails--whatsapp)
8. [Dépannage](#dépannage)
9. [Diffusion d'annonces WhatsApp (admins)](#diffusion-dannonces-whatsapp-admins)
10. [Production](#production)

## Prérequis

- Node.js 20 ou plus (`node -v`) ; ou Docker + Docker Compose v2.
- **wa-service** : un numéro WhatsApp classique et le téléphone qui le porte (pour scanner le QR code).
- **storage-service** : un projet Supabase (URL + clé `service_role`), un bucket existant, et un compte Cloudinary (cloud name, API key, API secret).

## Installation et lancement local

```bash
cd services/wa-service      && cp .env.example .env && npm install
cd ../storage-service       && cp .env.example .env && npm install
```

Renseignez les deux fichiers `.env` (voir ci-dessous), puis dans chaque dossier :

```bash
npm run dev     # node --watch src/index.js  (rechargement automatique)
npm start       # node src/index.js          (production)
```

`npm install` crée un `package-lock.json` dans chaque service : **versionnez-le** (les Dockerfile l'utilisent avec `npm ci`).

### Scanner le QR code (wa-service)

1. Lancez `wa-service` : un QR code s'affiche dans le terminal.
2. Sur le téléphone : **WhatsApp → Paramètres → Appareils connectés → Connecter un appareil**, puis scannez.
3. `GET /health` renvoie `{"ready": true, ...}`.
4. La session est enregistrée dans `wa-service/auth/` : plus besoin de rescanner, la reconnexion est automatique.
5. Si le numéro est déconnecté depuis le téléphone (`loggedOut`), le service ne se reconnecte pas : supprimez `auth/` (ou le volume Docker) et relancez pour rescanner.

## Variables d'environnement

### wa-service (`wa-service/.env`)

| Variable | Défaut | Description |
|---|---|---|
| `PORT` | `3001` | Port HTTP |
| `API_KEY` | — | Secret partagé (header `x-api-key`). Obligatoire |
| `DEFAULT_COUNTRY_CODE` | `225` | Indicatif ajouté aux numéros de 10 chiffres |
| `LOG_LEVEL` | `warn` | Niveau de logs Baileys (`pino`) |
| `DATA_DIR` | `data` | Dossier de sauvegarde de la file d'attente (volume `wa-data` sous Docker) |
| `SESSION_STORE` | — | `supabase` : session WhatsApp et file stockées dans la table `wa_state` (hébergeur au disque éphémère, ex. Render gratuit). Requiert `SUPABASE_URL` et `SUPABASE_SERVICE_KEY` |
| `AUTH_DIR` | `auth` | Dossier de la session WhatsApp (mode fichier) |
| `QR_KEY` | — | Active la page `/qr?key=…` qui affiche le QR code dans le navigateur ; à retirer une fois connecté |
| `BROADCAST_MAX_RECIPIENTS` | `1000` | Destinataires max par diffusion |

### storage-service (`storage-service/.env`)

| Variable | Défaut | Description |
|---|---|---|
| `PORT` | `3002` | Port HTTP |
| `API_KEY` | — | Secret partagé. Obligatoire |
| `SUPABASE_URL` | — | URL du projet Supabase |
| `SUPABASE_SERVICE_KEY` | — | Clé `service_role` (secrète) |
| `SUPABASE_BUCKET` | `documents` | Bucket **déjà existant** (le service ne le crée pas ; le bucket actuel de l'application s'appelle `Doc`) |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | — | Identifiants Cloudinary |
| `SUPABASE_LIMIT_GB` | `4.5` | Seuil de bascule vers Cloudinary |

### Côté Next (`.env.local` — à ajouter par vous)

```
WA_SERVICE_URL=http://localhost:3001
WA_API_KEY=<même valeur que API_KEY de wa-service>
ADMIN_WHATSAPP=2250700000000
STORAGE_SERVICE_URL=http://localhost:3002
STORAGE_API_KEY=<même valeur que API_KEY de storage-service>
```

Utilisez des clés différentes pour chaque service (`openssl rand -hex 32`). En Docker Compose, depuis un autre conteneur l'URL serait `http://wa-service:3001`.

## Docker

Tout se lance depuis le dossier `services/`.

### Fichiers

- `wa-service/Dockerfile`, `storage-service/Dockerfile` : image `node:20-alpine`, installation des dépendances (`npm ci --omit=dev` si un lockfile est présent, sinon `npm install`), lancement par `node src/index.js`. `wa-service` installe aussi `git` car certaines dépendances de Baileys sont téléchargées depuis GitHub.
- `docker-compose.yml` : les 2 services, `restart: always`, `init`, rotation des logs, ports liés à `127.0.0.1` (accessibles depuis le serveur seulement), variables lues dans `wa-service/.env` et `storage-service/.env`, et deux volumes nommés pour `wa-service` : **`wa-auth`** (`/app/auth`, session WhatsApp) et **`wa-data`** (`/app/data`, file d'attente et campagnes). Les images tournent en utilisateur non-root et ont un `HEALTHCHECK` (visible dans `docker compose ps`).

> **Profils Docker Compose** : `docker compose up` lance seulement `wa-service`. Ajoutez `--profile proxy` pour le HTTPS public (Caddy) et `--profile storage` pour `storage-service` (optionnel, pas encore appelé par Next). Voir [DEPLOY.md](DEPLOY.md).



```bash
docker compose up -d --build        # construire et démarrer
docker compose ps                   # état des conteneurs
docker compose logs -f wa-service   # logs (et QR code au premier lancement)
docker compose logs -f storage-service
docker compose restart wa-service   # redémarrer un service
docker compose down                 # arrêter (le volume wa-auth est conservé)
docker compose up -d --build        # après une mise à jour du code
```

### Points importants

- **Les volumes `wa-auth` (session WhatsApp) et `wa-data` (file d'attente) sont vitaux.** `docker compose down` les conserve ; `docker compose down -v` ou `docker volume rm` les **supprime** (il faudra rescanner le QR code et les messages en attente sont perdus).
- **Le QR code s'affiche dans les logs** (`docker compose logs -f wa-service`). Un terminal assez large est nécessaire pour qu'il reste lisible.
- **Une seule instance de `wa-service`** : ne pas la répliquer (une session WhatsApp ne peut être utilisée que par un processus à la fois, et l'idempotence est en mémoire). Ne pas utiliser `--scale`.
- Les `.env` ne sont pas copiés dans l'image : ils sont injectés à l'exécution (`env_file`). Après modification d'un `.env`, faites `docker compose up -d` pour recréer le conteneur.
- Les ports sont liés à `127.0.0.1` : pour que Next (hébergé ailleurs) les joigne, placez un reverse proxy HTTPS devant (voir [Production](#production)). N'ouvrez jamais 3001/3002 directement sur Internet.
- **Vercel** : un déploiement Vercel ne peut pas joindre `localhost`. Hébergez les services sur un serveur/VPS (ou Render, Railway, Fly.io…) avec un volume persistant pour `wa-service/auth`, et mettez son URL publique (HTTPS) dans `WA_SERVICE_URL` / `STORAGE_SERVICE_URL`.

## Sécurité

- Toutes les routes exigent le header `x-api-key` (sinon `401`). Sans `API_KEY` défini, toutes les requêtes sont refusées.
- Ne commitez jamais de `.env` ni `wa-service/auth/` (couverts par `services/.gitignore`). Le dossier `auth/` donne accès au compte WhatsApp.
- Baileys n'est **pas** l'API officielle : l'usage automatisé d'un compte WhatsApp classique peut mener à un blocage du numéro. La file d'attente espace les envois (3 à 8 s) pour limiter le risque ; utilisez un numéro dédié et n'envoyez qu'à des personnes qui s'attendent à être contactées.

## Idempotence

Rejouer une requête (retry réseau, double clic, redémarrage de Next en plein appel) ne doit pas envoyer deux messages ni stocker deux fichiers.

| Route | Comportement |
|---|---|
| `POST /notify`, `POST /send` (wa) | Un même message n'est mis en file qu'une fois |
| `POST /upload` (storage) | Un même fichier n'est stocké qu'une fois |
| `DELETE /file` (storage) | Naturellement idempotent : supprimer un fichier déjà supprimé renvoie aussi `{ "deleted": true }` |
| `GET /url`, `GET /health`, `GET /templates` | Lecture seule, sans effet de bord |

Mécanisme (identique dans les deux services, `src/idempotency.js`) :

- **Avec `Idempotency-Key: <valeur>`** (200 caractères max) : la clé est mémorisée **24 h**. Le rejeu avec le même contenu renvoie le résultat initial avec `"duplicate": true`, sans refaire le travail. Le rejeu avec la même clé mais un **contenu différent** est refusé (`422`).
- **Sans clé** : un contenu strictement identique reçu de nouveau pendant **60 s** est considéré comme un doublon.
- Deux requêtes simultanées identiques partagent le même traitement.
- Un échec n'est pas mémorisé : l'appel peut être retenté.
- Un doublon renvoie `"duplicate": true` (statut `202` pour wa-service, `200` au lieu de `201` pour `/upload`).

Limites : la mémoire est locale au processus et **perdue au redémarrage** ; une instance unique est supposée. Pour un message qui doit pouvoir être renvoyé volontairement à l'identique (rare), utilisez une `Idempotency-Key` différente.

**Bonne pratique** : générez des clés déterministes liées à l'événement métier, par exemple `proposal_published:<id proposition>`, `signup:<user id>`. Ainsi, même un nouvel essai tardif (après 60 s) ne génère pas de doublon.

## Correspondance e-mails ↔ WhatsApp

À intégrer **plus tard** dans Next (rien n'est modifié pour l'instant). Chaque appel se place juste après l'envoi de l'e-mail correspondant.

| E-mail existant | Fichier / fonction Next | Destinataire | Type `/notify` |
|---|---|---|---|
| Message du formulaire de contact | `src/app/api/contact/route.js` (après `sendMail`) | admin | `contact_message` |
| Nouvelle proposition à valider | `src/app/api/proposer/route.js`, `notifyAdmin` | admin | `proposal_admin` |
| Accusé de réception de la proposition | `src/app/api/proposer/route.js`, `acknowledge` | contributeur | `proposal_received` |
| Proposition publiée | `src/app/api/propositions/route.js`, action `publier` | contributeur | `proposal_published` |
| Proposition refusée | `src/app/api/propositions/route.js`, action `refuser` | contributeur | `proposal_rejected` |
| Confirmation d'inscription (envoyée par **Supabase Auth**) | `src/app/api/inscription/route.js` (après le `signUp` réussi) | nouvel inscrit | `signup_confirmation` |
| Réinitialisation du mot de passe (envoyée par **Supabase Auth**) | `src/app/api/forgot/route.js` (après `resetPasswordForEmail` sans erreur) | propriétaire du compte | `password_reset_requested` |

> **Adaptations par rapport aux e-mails**
> - Les 2 boutons du mail admin (`proposal_admin`) deviennent des liens en texte brut ; le gabarit HTML devient du texte avec `*gras*`.
> - Pour l'inscription et le mot de passe oublié, Supabase génère et envoie lui-même le lien : l'application n'y a pas accès. Le message WhatsApp est donc un **avis** (« un e-mail vous a été envoyé ») **sans le lien**. Pour envoyer le lien lui-même par WhatsApp, il faudrait configurer un *Send Email Auth Hook* Supabase : hors périmètre ici.
> - Il n'y a aucune pièce jointe dans les e-mails existants.

### Helper à coller (serveur uniquement, ne lève jamais d'erreur)

```js
async function notifyWhatsApp(type, phone, data, idempotencyKey) {
  if (!process.env.WA_SERVICE_URL || !phone) return;
  try {
    const res = await fetch(`${process.env.WA_SERVICE_URL}/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.WA_API_KEY,
        ...(idempotencyKey && { "Idempotency-Key": idempotencyKey }),
      },
      body: JSON.stringify({ type, phone, data }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error("[whatsapp]", res.status, await res.text());
  } catch (err) {
    console.error("[whatsapp]", err);
  }
}
```

### Exemples d'appels

```js
// contact — après sendMail
await notifyWhatsApp("contact_message", process.env.ADMIN_WHATSAPP,
  { nom, email, objet, message });

// proposer — dans notifyAdmin
await notifyWhatsApp("proposal_admin", process.env.ADMIN_WHATSAPP, {
  id, nom: proposal.nom, email: proposal.email, type: proposal.type,
  filiere: proposal.filiere, niveau: proposal.niveau, matiere: proposal.matiere,
  annee: proposal.annee, session: proposal.session, description: proposal.description,
  fileName: file.name, fileSize: file.size, downloadUrl: signed?.signedUrl, reviewUrl,
}, id ? `proposal_admin:${id}` : undefined);

// proposer — dans acknowledge
await notifyWhatsApp("proposal_received", proposal.telephone, {
  nom: proposal.nom, matiere: proposal.matiere, type: proposal.type, filiere: proposal.filiere,
}, id ? `proposal_received:${id}` : undefined);

// propositions — publier
await notifyWhatsApp("proposal_published", proposal.telephone,
  { nom: proposal.nom, matiere: meta.matiere }, `proposal_published:${proposal.id}`);

// propositions — refuser
await notifyWhatsApp("proposal_rejected", proposal.telephone,
  { nom: proposal.nom, matiere: proposal.matiere, motif }, `proposal_rejected:${proposal.id}`);

// inscription — après le signUp réussi (numero et prenom sont déjà lus dans la route)
await notifyWhatsApp("signup_confirmation", numero,
  { prenom, email: data.user.email }, `signup:${data.user.id}`);

// forgot — après resetPasswordForEmail, seulement si `error` est null.
// La réponse HTTP reste identique dans tous les cas (pas de fuite sur l'existence du compte).
const { data: profil } = await supabaseAdmin
  .from("utilisateurs").select("prenom, numero").eq("email", email).maybeSingle();
if (profil?.numero) {
  await notifyWhatsApp("password_reset_requested", profil.numero,
    { prenom: profil.prenom, email },
    `reset:${email}:${Math.floor(Date.now() / (15 * 60_000))}`); // une fois par fenêtre de 15 min
}
```

### Numéros de téléphone

- Les 2 messages **admin** utilisent un numéro fixe (`ADMIN_WHATSAPP`).
- Inscription et mot de passe oublié utilisent `utilisateurs.numero`, déjà collecté à l'inscription (le service normalise les formats locaux, ex. `0700000000` → `2250700000000`).
- Les 3 messages au **contributeur** (`proposal_received`, `proposal_published`, `proposal_rejected`) nécessitent un numéro que la table `proposition` ne contient pas (seulement nom et e-mail). Il faudra soit ajouter un champ téléphone au formulaire de proposition, soit retrouver `utilisateurs.numero` via `proposition.user_id` quand le contributeur est connecté.

## Dépannage

| Symptôme | Cause probable / action |
|---|---|
| `401` | Header `x-api-key` absent ou différent de `API_KEY` |
| `wa-service /health` → `ready: false` | QR code non scanné, ou reconnexion en cours. Regardez les logs |
| Messages qui s'accumulent (`queueLength` monte) | WhatsApp déconnecté : ils partiront à la reconnexion |
| Plus de reconnexion après « loggedOut » | Session révoquée : supprimez `auth/` (ou le volume `wa-auth`) et rescannez |
| `400 Numéro de téléphone invalide` | Il faut 8 à 15 chiffres (ou 10 chiffres sans indicatif) |
| `400 Type inconnu` / `Champs manquants` | Voir `GET /templates` |
| `422` sur `/notify`, `/send`, `/upload` | `Idempotency-Key` réutilisée avec un contenu différent |
| `413` sur `/upload` | Fichier > 10 Mo |
| `/upload` renvoie `provider: "cloudinary"`, `fallback: true` | L'upload Supabase a échoué : voir les logs (bucket inexistant, clé invalide, quota…) |
| `502` sur `/upload` | Supabase **et** Cloudinary indisponibles ou mal configurés |
| `health.supabaseUsageGB` est `null` | Impossible de lister le bucket (nom ou clé invalide) |
| `npm ci` échoue au build Docker | `package-lock.json` désynchronisé du `package.json` : relancez `npm install` |

## Diffusion d'annonces WhatsApp (admins)

Permet à un admin d'envoyer une annonce à un groupe d'étudiants ciblé (tous, par filière, par niveau, contributeurs, ou une liste d'e-mails), avec **historique** : qui a diffusé, quand, vers qui, quel message, et l'état.

```
Interface admin ─► Next  /api/diffusion ─► wa-service  /broadcast ─► file « diffusion » ─► WhatsApp
                   │  contrôle des droits                              (sauvegardée sur disque,
                   │  ciblage dans Supabase                             derrière les messages urgents,
                   └► table « diffusion » (historique)                  3 à 8 s / message)
```

### Mise en place (une fois)

1. **Appliquer la migration** `supabase/migrations/20261002000000_diffusion.sql` (Supabase → SQL Editor → Run). Elle crée la table `diffusion`. **Sans elle, aucune diffusion n'est possible** (on ne diffuse pas sans trace) : l'API répond `503`.
2. **Droits** : dans le `.env` de Next, listez les e-mails des admins (séparés par des virgules, sans tenir compte des majuscules). Liste vide = personne. Le compte doit avoir un e-mail confirmé.

```
BROADCAST_ADMIN_EMAILS=admin1@mail.com,admin2@mail.com
BROADCAST_DAILY_LIMIT=1000      # facultatif : messages max sur 24 h glissantes (défaut 1000)
```

### API Next `/api/diffusion` (pour l'interface)

Toutes les requêtes portent `Authorization: Bearer <token Supabase>` de l'admin connecté.

| Requête | Rôle | Réponse |
|---|---|---|
| `GET /api/diffusion` | Afficher ou non le menu « Diffusion » | non-admin : `{ autorise: false }` ; admin : `{ autorise: true, filieres, niveaux, maxDestinataires, longueurMax, limiteJournaliere }` |
| `POST` `{ action: "apercu", cible }` | Combien de personnes seraient touchées | `{ total, sansNumero, depasseLimite, dureeEstimeeMinutes, exemples[] }` (numéros masqués) |
| `POST` `{ action: "envoyer", message, cible, confirmer, campagneId? }` | Lance la diffusion | `{ campagneId, campagne, message }` (`doublon: true` si déjà lancée) |
| `GET ?historique=1&page=1` | Historique, plus récent d'abord (20 par page) | `{ historique: [campagne…], page, parPage, total }` |
| `GET ?campagne=<id>` | Détail et progression d'une diffusion | `{ campagne }` |
| `DELETE ?campagne=<id>` | Annule ce qui n'est pas encore parti | `{ campagne }` |

Une **campagne** (réponse de l'API) :

```json
{
  "id": "…", "creeLe": "2026-10-02T08:11:05Z", "termineLe": null,
  "admin": "admin1@mail.com", "canal": "whatsapp",
  "type": "filiere",
  "cible": { "filieres": ["MIAGE"], "niveaux": [], "emails": [], "contributeurs": false },
  "message": "Bonjour {prenom}, …",
  "statut": "en_cours",
  "total": 142, "envoyes": 37, "echecs": 1, "annules": 0, "restants": 104,
  "erreurs": { "numero_absent_de_whatsapp": 1 }
}
```

- **`type`** : `tous`, `filiere`, `niveau`, `contributeurs`, `liste` ou `mixte` (plusieurs critères).
- **`statut`** : `en_cours`, `terminee`, `annulee`, `echec` (le service WhatsApp n'a pas accepté la demande), `interrompue` (campagne perdue par le service, par exemple volume supprimé).
- **`cible`** (tous champs facultatifs, vide = tout le monde) : `{ "filieres": ["MIAGE"], "niveaux": ["Licence 1"], "contributeurs": false, "emails": [] }`.
- **`message`** : 1500 caractères max ; `{prenom}` et `{nom}` sont remplacés pour chaque personne.
- **`confirmer`** : le nombre de personnes vu dans l'aperçu. S'il a changé entre-temps, l'envoi est refusé (`409`) : il faut refaire un aperçu.
- **`campagneId`** : identifiant généré par l'interface à l'ouverture du formulaire (8 à 100 caractères). Cliquer deux fois sur « Envoyer » ne lance qu'une campagne.
- **Mise à jour de l'état** : l'historique est synchronisé avec `wa-service` à chaque lecture (`?historique=1` ou `?campagne=`). L'interface doit donc interroger toutes les 5 à 10 s pendant un envoi.

### Protections

- **Une seule diffusion à la fois** (`409` sinon).
- **Plafond sur 24 h** : `BROADCAST_DAILY_LIMIT` messages (défaut 1000) ; au-delà `429`. Protège le numéro d'un blocage.
- Maximum **1000 destinataires** par campagne, **5 diffusions par heure** et par admin.
- **Historique écrit avant l'envoi** ; si l'envoi échoue, la ligne passe en `echec`.
- Numéros **masqués** dans l'aperçu ; invalides et doublons écartés.
- Les messages **urgents** (inscription, mot de passe oublié) passent avant la diffusion.
- La file est **sauvegardée sur disque** : un redémarrage de `wa-service` reprend les envois.

Parcours conseillé pour l'interface : formulaire (cible + message) → **Aperçu** → confirmation (« 142 personnes, environ 13 min ») → **Envoyer** → progression avec bouton **Annuler** → onglet **Historique**.

### À savoir

- **Risque de blocage du numéro** : envoyer la même annonce à des centaines de personnes est ce que WhatsApp surveille sur un compte non officiel. Commencez par de petites cibles (une filière), utilisez un numéro dédié, évitez les envois répétés.
- **Consentement** : les étudiants ont donné leur numéro à l'inscription, pas forcément pour recevoir des annonces. Il est recommandé de l'indiquer dans le formulaire d'inscription ; un mécanisme de désinscription n'est pas implémenté.
- **Durée** : environ 5,5 s par message, soit ~45 min pour 500 personnes.
- **Redémarrage** : un message en cours d'envoi pendant l'arrêt peut être renvoyé une fois. Si le volume `wa-data` est supprimé, les campagnes non terminées passent en `interrompue`.
- L'historique garde les compteurs et les types d'erreur, pas le détail de chaque destinataire.

## Production

Liste de contrôle avant la mise en ligne.

**Hébergement**
- Un serveur toujours allumé (VPS, etc.) avec Docker. Pas de plateforme « serverless » : la session WhatsApp doit rester connectée en permanence.
- Next déployé sur Vercel/Netlify ne peut pas joindre `localhost` : `WA_SERVICE_URL` et `STORAGE_SERVICE_URL` doivent être des URLs **HTTPS publiques**.

**Reverse proxy HTTPS** (exemple Caddy, certificat automatique). Les services écoutent seulement sur `127.0.0.1`, le proxy les expose :

```
wa.mondomaine.com {
    reverse_proxy 127.0.0.1:3001
}
storage.mondomaine.com {
    reverse_proxy 127.0.0.1:3002
}
```

Pare-feu : n'ouvrir que 80 et 443 (et SSH). Les clés `API_KEY` protègent déjà les routes, mais n'exposez jamais 3001/3002 en clair.

**Secrets**
- Générer des clés longues et différentes pour chaque service : `openssl rand -hex 32`.
- Les mêmes valeurs dans `WA_API_KEY` / `STORAGE_API_KEY` côté Next. Ne jamais les commiter.
- `SUPABASE_SERVICE_KEY` est une clé administrateur : uniquement dans `storage-service/.env`.

**Sauvegardes et durabilité**
- Les volumes `wa-auth` et `wa-data` doivent survivre aux mises à jour. Sauvegardez `wa-auth` (sinon : rescanner le QR code).
- Exemple de sauvegarde : `docker run --rm -v services_wa-auth:/d -v "$PWD":/b alpine tar czf /b/wa-auth.tgz -C /d .` (le préfixe `services_` dépend du nom du dossier Compose).

**Surveillance**
- `docker compose ps` indique `healthy` ou `unhealthy` (healthcheck intégré).
- Surveillez `GET /health` de `wa-service` : `ready: false` prolongé = QR code à rescanner ou connexion perdue.
- Logs : `docker compose logs -f`, rotation automatique (3 fichiers de 10 Mo).

**Mises à jour**

```bash
git pull
docker compose up -d --build     # les volumes sont conservés, la file est reprise au démarrage
```

**Avant la première diffusion** : migration appliquée, `BROADCAST_ADMIN_EMAILS` renseigné, test sur une cible d'une ou deux personnes (champ `emails`), puis seulement une vraie filière.

## Consentement aux notifications WhatsApp (opt-in)

Un étudiant ne reçoit un message WhatsApp (notification **ou** diffusion) que s'il a **accepté**. Le choix est stocké dans `utilisateurs.whatsapp_optin` :

| Valeur | Signification |
|---|---|
| `null` | n'a jamais répondu : la fenêtre de consentement lui est proposée une fois à sa prochaine connexion |
| `true` | a accepté : reçoit les notifications et les diffusions |
| `false` | a refusé : ne reçoit rien (il peut changer d'avis depuis son profil) |

**Mise en place** : appliquer `supabase/migrations/20261002020000_whatsapp_consent.sql` (Supabase → SQL Editor → Run). Les comptes existants restent à `null` : ils ne reçoivent plus rien tant qu'ils n'ont pas accepté. Sans la migration, l'option est masquée dans l'interface et les diffusions sont refusées (`503`).

**Où l'étudiant répond**
- **Inscription** : interrupteur « Notifications WhatsApp », désactivé par défaut (le consentement doit être un acte volontaire). Sa réponse (oui/non) est enregistrée.
- **Fenêtre unique** : pour les comptes à `null`, 2,5 s après la connexion. Fermer la fenêtre vaut « Non merci » ; elle ne revient plus, sur aucun appareil.
- **Profil** : carte « Notifications WhatsApp ». Tant que ce n'est pas accepté, elle est mise en avant (bordure verte, « Recommandé », bouton « Activer maintenant »). Une fois accepté, elle devient discrète avec un interrupteur pour désactiver.

**API Next**
- `GET /api/utilisateur` renvoie `whatsapp: { disponible, accepte }`.
- `POST /api/whatsapp` `{ "accepte": true | false }` enregistre la réponse (compte connecté).

**Effets côté envoi**
- Notifications unitaires (`proposal_*`, `signup_confirmation`, `password_reset_requested`) : envoyées seulement si `whatsapp_optin = true`. Le message d'inscription part seulement si l'inscrit a activé l'interrupteur.
- Diffusion : `findRecipients` exclut les étudiants non consentants ; l'aperçu indique combien sont exclus (`sansConsentement`). Pour un test sur votre propre adresse (`emails`), votre compte doit avoir accepté.
- Les messages destinés à l'admin (`ADMIN_WHATSAPP`) ne sont pas concernés.
- Les comptes sans numéro (ex. connexion Google) ne voient pas l'option.

## Sticker ou image dans une diffusion

Une diffusion peut contenir **un sticker** ou **une image**, en plus (ou à la place) du texte.

| Pièce jointe | Format | Taille max | Comment elle part |
|---|---|---|---|
| **Sticker** | WebP 512 × 512 | 500 Ko (l'interface le convertit en < 100 Ko) | Dans un **second message**, juste après le texte (WhatsApp n'accepte pas de légende sur un sticker) ; seul si le texte est vide |
| **Image** | JPEG, PNG ou WebP | 1 Mo (réduite automatiquement par l'interface) | **Un seul message** : le texte devient sa légende |

- **Interface** : dans le formulaire de diffusion, section « Pièce jointe » → « Ajouter un sticker » ou « Ajouter une image ». N'importe quelle image est convertie en vrai sticker 512 × 512 (WebP) dans le navigateur (Chrome, Edge ou Firefox ; Safari ne sait pas encoder le WebP). Le texte devient facultatif quand il y a une pièce jointe (5 caractères minimum s'il est rempli).
- **API Next** : `POST /api/diffusion` `{ action: "envoyer", …, media: { type: "sticker" | "image", data: "<base64>" } }`. L'historique garde seulement le type (« Avec sticker » / « Avec image »), pas le fichier.
- **wa-service** : `POST /broadcast` accepte le même champ `media`. Le **vrai format** est contrôlé par la signature du fichier (un PNG présenté comme sticker est refusé). La pièce jointe est enregistrée **une seule fois par campagne** (fichier dans `DATA_DIR/media/` ou ligne `media:<id>` dans `wa_state`) puis supprimée à la fin de la campagne.
- **Attention** : un sticker ajoute un message par destinataire (donc deux fois plus d'envois). Avec un compte restreint (erreur 463), le sticker est refusé comme le texte. Derrière Caddy, la taille maximale des requêtes est portée à 5 Mo.
