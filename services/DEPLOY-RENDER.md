# Mise en production sur Render (gratuit) — guide pas à pas

Ce guide déploie **wa-service** sur **Render**, sans serveur à gérer et sans payer, en gardant la session WhatsApp même après un redémarrage.
(Pour un VPS avec Docker, voir plutôt [DEPLOY.md](DEPLOY.md).)

## Comment ça marche, et pourquoi c'est fiable malgré le plan gratuit

Render a deux contraintes sur le plan gratuit :

| Contrainte | Conséquence | Notre réponse |
|---|---|---|
| **Mise en veille après 15 min sans requête** | Un service endormi ne peut ni envoyer ni recevoir | Un contrôle **UptimeRobot** appelle `/ping` toutes les 5 minutes : le service ne s'endort jamais |
| **Disque éphémère** (perdu à chaque redémarrage, que Render peut décider « à tout moment ») | La session WhatsApp et la file d'attente disparaîtraient, avec un QR code à rescanner | La session et la file sont stockées dans **Supabase** (table `wa_state`). Après un redémarrage, le service se reconnecte tout seul |

Budget d'heures : Render offre 750 heures gratuites par mois et par compte. Un service allumé en permanence en consomme environ 744 : **un seul service gratuit allumé en continu** par compte Render.

> Si un jour vous passez à un plan payant (« Starter »), rien ne change dans le code : la session reste dans Supabase et le service ne s'endort plus.

## 1. Avant de commencer

- Le code du **backend est poussé sur GitHub** (le dépôt contient `render.yaml` à la racine et le dossier `services/`).
  **Un seul dépôt et une seule branche suffisent** : Render ne construit que `services/wa-service` (`rootDir`), Vercel continue de déployer le backend Next depuis le même dépôt (il ignore `services/`). Grâce au `buildFilter` de `render.yaml`, Render ne redéploie, donc ne redémarre WhatsApp, que lorsque des fichiers de `services/wa-service/` changent : un commit qui ne touche que le backend Next ou le frontend ne le dérange pas.
- Un compte **Render** (render.com) relié à votre GitHub.
- Un compte **UptimeRobot** gratuit (uptimerobot.com).
- Un **numéro WhatsApp dédié** et son téléphone à portée (QR code).
- Votre projet **Supabase** de production.

## 2. Supabase : appliquer les migrations

Dans **Supabase → SQL Editor**, exécutez dans cet ordre (bouton Run, chacune peut être rejouée sans risque) les fichiers de `supabase/migrations/` :

1. `20261002000000_diffusion.sql`
2. `20261002010000_diffusion_echecs.sql`
3. `20261002020000_whatsapp_consent.sql`
4. **`20261002030000_wa_state.sql`** : table qui stocke la session WhatsApp et la file (spécifique à ce guide)

> La table `wa_state` contient des **secrets** (les clés de la session WhatsApp). Elle est protégée par RLS : seule la clé `service_role` y accède. Ne partagez jamais cette clé.

Notez aussi, depuis **Supabase → Project Settings → API** :
- l'**URL du projet** (`https://xxxx.supabase.co`) ;
- la clé **`service_role`** (secrète ; c'est la même que `supabase_service_role_key` de votre `.env` backend).

## 3. Render : créer le service

### Option A : Blueprint (recommandé, le plus rapide)

1. Render → **New → Blueprint** → choisissez le dépôt backend.
2. Render lit `render.yaml` et propose le service **upb-wa-service** (plan *Free*, région *Frankfurt*).
3. Il vous demande les deux variables secrètes : renseignez `SUPABASE_URL` et `SUPABASE_SERVICE_KEY`.
4. Validez : Render construit et démarre le service. `API_KEY` et `QR_KEY` sont générées automatiquement.

### Option B : manuellement

Render → **New → Web Service** → votre dépôt, puis :

| Champ | Valeur |
|---|---|
| Root Directory | `services/wa-service` |
| Runtime | Node |
| Build Command | `npm ci` |
| Start Command | `node src/index.js` |
| Plan | Free |
| Health Check Path | `/ping` |

Variables d'environnement (onglet *Environment*) :

| Variable | Valeur |
|---|---|
| `NODE_VERSION` | `20` |
| `SESSION_STORE` | `supabase` |
| `SUPABASE_URL` | l'URL de votre projet Supabase |
| `SUPABASE_SERVICE_KEY` | la clé `service_role` |
| `API_KEY` | une clé longue : `openssl rand -hex 32` (notez-la) |
| `QR_KEY` | une clé temporaire, différente, pour la page QR |
| `DEFAULT_COUNTRY_CODE` | `225` |

Quand le déploiement est terminé, Render affiche l'adresse du service : `https://upb-wa-service.onrender.com` (votre nom peut varier). Dans la suite, `<URL>` désigne cette adresse.

> Si le build échoue à cause d'une dépendance téléchargée depuis GitHub, choisissez le runtime **Docker** à la place : le `Dockerfile` de `services/wa-service` est prévu pour cela.

## 4. Connecter le numéro WhatsApp (QR code dans le navigateur)

1. Ouvrez dans le navigateur : `<URL>/qr?key=<QR_KEY>` (la valeur de `QR_KEY`, lisible dans Render → *Environment*).
2. Sur le téléphone du **numéro dédié** : WhatsApp → **Paramètres → Appareils connectés → Connecter un appareil**, scannez le QR code affiché (il se renouvelle seul toutes les 20 secondes environ).
3. La page affiche « ✅ WhatsApp est connecté ».
4. **Supprimez la variable `QR_KEY`** dans Render (la page `/qr` redevient inaccessible). Render redémarre le service : il se reconnecte seul, sans nouveau QR code, ce qui confirme que la session est bien conservée dans Supabase.
5. Si ce numéro était connecté sur votre PC de développement, **retirez cet ancien appareil** dans « Appareils connectés » : deux instances sur la même session finissent par casser les clés.

## 5. Garder le service éveillé (UptimeRobot)

1. UptimeRobot → **Add New Monitor** → type **HTTP(s)**.
2. URL : `<URL>/ping`
3. Intervalle : **5 minutes** (la valeur du plan gratuit).
4. Activez les alertes par e-mail : vous serez prévenu si le service tombe.

`/ping` répond simplement `ok`, sans clé et sans aucune donnée : c'est fait pour ça.

## 6. Vérifier

Depuis votre ordinateur (Git Bash, WSL ou Linux) :

```bash
./scripts/smoke-test.sh <URL> <API_KEY>
```

Les vérifications doivent être « OK » et `ready` doit valoir `true`.

## 7. Relier le backend Next (Vercel)

Dans **Vercel → projet backend → Settings → Environment Variables** (*Production*) :

| Variable | Valeur |
|---|---|
| `WA_SERVICE_URL` | `<URL>` (ex. `https://upb-wa-service.onrender.com`) |
| `WA_API_KEY` | la valeur de `API_KEY` de Render |
| `ADMIN_WHATSAPP` | numéro WhatsApp de l'admin qui reçoit les alertes |
| `BROADCAST_ADMIN_EMAILS` | e-mails des admins autorisés à diffuser, séparés par des virgules |
| `BROADCAST_DAILY_LIMIT` | `1000` (facultatif) |

Puis **redéployez** le backend (Deployments → Redeploy) : Vercel ne prend les nouvelles variables en compte qu'à un nouveau déploiement.

## 8. Domaine de la bibliothèque (facultatif)

L'adresse `onrender.com` suffit. Pour une adresse à vous, par exemple `wa.votredomaine.com` :

1. Render → votre service → **Settings → Custom Domains → Add** → `wa.votredomaine.com`.
2. Chez votre gestionnaire de domaine, créez l'enregistrement **CNAME** `wa` → l'adresse `onrender.com` indiquée par Render.
3. Render vérifie le DNS et fournit le certificat HTTPS automatiquement.
4. Mettez alors `https://wa.votredomaine.com` dans `WA_SERVICE_URL` (Vercel) et dans le moniteur UptimeRobot, puis redéployez Vercel.

## 9. Premiers tests en réel

1. **Formulaire de contact** : l'admin (`ADMIN_WHATSAPP`) reçoit un WhatsApp.
2. **Consentement** : avec un compte de test, la fenêtre « Restez informé sur WhatsApp » s'affiche ; acceptez.
3. **Diffusion test** : page *Diffusion* → cible « Liste d'e-mails précise » avec **uniquement votre e-mail** → Vérifier → Envoyer.
4. **Diffusion réelle** ensuite, en commençant par une petite filière.

## 10. À savoir sur le fonctionnement en gratuit

- **Redémarrages** : Render peut redémarrer le service. Pendant 30 secondes à 1 minute, il ne répond pas. La session et la file sont reprises automatiquement ; une diffusion en cours reprend là où elle s'était arrêtée (un message en cours d'envoi peut être renvoyé une fois).
- **Notifications unitaires** (publication d'une proposition, etc.) pendant une coupure : le backend les envoie « au mieux » (4 s d'attente) ; elles peuvent être perdues si le service est injoignable à cet instant. L'e-mail, lui, part toujours.
- **Lancer une diffusion** : si le service redémarre à ce moment, l'interface affiche « Le service WhatsApp ne répond pas » ; réessayez une minute plus tard.
- **Si UptimeRobot s'arrête** (compte suspendu, e-mail non confirmé…), Render endormira le service au bout de 15 minutes et le premier appel sera lent (réveil de 30 à 60 secondes). Gardez les alertes e-mail actives.
- **Conditions de Render** : les offres gratuites peuvent évoluer. Vérifiez-les de temps en temps ; le passage à *Starter* (payant) ne demande aucun changement de code.
- **Sécurité** : la clé `service_role` de Supabase donne un accès complet à la base. Elle n'est saisie que dans Render (et dans votre `.env` privé). Ne la mettez jamais dans le frontend ni dans Git.
- **Un seul service gratuit allumé en continu** par compte Render (750 h par mois).

## 10 bis. Une seule instance à la fois (verrou) et session propre

**Le risque** : pendant un déploiement ou un réveil, Render peut faire tourner **deux copies** du service. Si elles utilisent toutes deux la session WhatsApp, elles s'éjectent mutuellement (log « conflict / replaced », code 440) et mélangent les clés de chiffrement : les destinataires voient alors **« En attente de ce message »**.

**La protection** : un verrou stocké dans Supabase (ligne `lock` de `wa_state`, renouvelée toutes les 10 s) ne laisse qu'**une seule instance** se connecter. L'autre attend (et répond 503 aux envois, que le backend réessaiera). Si la première disparaît, l'autre prend la main en moins de 40 secondes. `GET /health` montre l'état : `whatsapp.verrou`.

**Repartir d'une session propre** (à faire une fois après la mise à jour, ou si les destinataires voient « En attente de ce message ») :

1. Sur le téléphone du numéro dédié : WhatsApp → **Appareils connectés** → retirez les anciens appareils (doublons).
2. Render → *Environment* → ajoutez `QR_KEY` (valeur au choix) et enregistrez.
3. Déclenchez la réinitialisation :

```bash
curl -X POST -H "x-api-key: VOTRE_API_KEY" https://VOTRE-SERVICE.onrender.com/reset-session
```

4. Ouvrez `https://VOTRE-SERVICE.onrender.com/qr?key=VOTRE_QR_KEY` et scannez le QR code.
5. Supprimez la variable `QR_KEY`.

**Contrôler la remise des messages** : après un envoi, `GET /health` (avec la clé) affiche `whatsapp.messages` : `envoyes` (acceptés par le service), `accusesServeur` (reçus par WhatsApp), `accusesLivres` (arrivés sur le téléphone du destinataire), `accusesLus`. Si `accusesLivres` reste à 0 alors que `envoyes` monte, le message n'atteint pas le téléphone.

## 11. Dépannage

| Symptôme | Cause probable et action |
|---|---|
| Le service ne démarre pas : « Impossible de recharger la file d'attente » | Supabase injoignable ou clé erronée : vérifiez `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` et que la migration `wa_state` est appliquée. Render relance le service tout seul |
| `/qr` répond 404 | `QR_KEY` absente ou erronée dans l'adresse (c'est voulu quand elle est supprimée) |
| `/qr` : « Connexion en cours… » qui ne change pas | Patientez 30 s ; regardez les logs Render. Si ça persiste : redémarrez le service |
| `ready: false` après un redémarrage | Reconnexion en cours (30 s). Si ça dure : numéro déconnecté depuis le téléphone → la session est effacée et un nouveau QR apparaît sur `/qr` (ajoutez de nouveau `QR_KEY`) |
| Message « Session reprise par une autre instance » (code 440) | Deux instances utilisent la même session. Le verrou l'évite entre copies Render ; si ça persiste, une autre copie tourne ailleurs (votre PC avec la même session) : arrêtez-la, puis faites la réinitialisation de la section 10 bis |
| Les destinataires voient « En attente de ce message » | Clés de chiffrement abîmées (souvent par deux instances simultanées) : réinitialisez la session (section 10 bis) |
| La page Diffusion affiche « Espace réservé » | E-mail absent de `BROADCAST_ADMIN_EMAILS`, ou backend Vercel non redéployé |
| Diffusion refusée, erreur 503 | Migration 1 ou 3 non appliquée dans Supabase |
| Le premier envoi après une longue pause est lent | UptimeRobot ne fonctionne pas : le service se réveillait. Vérifiez le moniteur |

## 12. Liste de contrôle finale

- [ ] 4 migrations appliquées dans le Supabase de production
- [ ] Service Render créé, déploiement réussi, `<URL>/ping` répond `ok`
- [ ] QR code scanné avec le **numéro dédié**, ancien appareil de dev retiré
- [ ] `QR_KEY` **supprimée** de Render
- [ ] Redémarrage du service testé : il redevient `ready: true` **sans** nouveau QR
- [ ] Moniteur UptimeRobot actif sur `/ping` (toutes les 5 min, alertes e-mail)
- [ ] `smoke-test.sh` entièrement « OK »
- [ ] Variables ajoutées dans Vercel **et** backend redéployé
- [ ] Test contact → WhatsApp admin reçu ; consentement + diffusion à soi-même réussis
