# wa-service

Envoie les notifications WhatsApp via un numéro classique (Baileys, connexion par QR code). Port **3001**.
Installation, Docker, sécurité et intégration dans Next : voir le [README principal](../README.md).

## Fonctionnement

```
POST /notify ─► validation ─► modèle (templates.js) ─► idempotence ─► file d'attente ─► Baileys ─► WhatsApp
```

- **`src/index.js`** : serveur Express, authentification `x-api-key`, routes.
- **`src/whatsapp.js`** : connexion Baileys (`useMultiFileAuthState("auth")`), affichage du QR code, reconnexion automatique sauf `loggedOut`.
- **`src/queue.js`** : deux files (urgents, diffusions) sauvegardées sur disque dans `DATA_DIR/queue.json`. Un envoi toutes les **3 à 8 s** (délai aléatoire), aucun envoi tant que WhatsApp n'est pas connecté (les messages restent en file), **3 essais** par message puis abandon, erreurs loguées sans arrêter le service.
- **`src/templates.js`** : un modèle de message par e-mail existant.
- **`src/idempotency.js`** : anti-doublons (voir [Idempotence](../README.md#idempotence)).

La file est **sauvegardée sur disque** (`DATA_DIR`, par défaut `./data`, volume `wa-data` sous Docker) et rechargée au démarrage : un redémarrage ne perd plus les messages en attente. Un message en cours d'envoi au moment de l'arrêt peut être renvoyé une fois (livraison « au moins une fois »). L'idempotence (anti-doublons), elle, reste en mémoire.

## Numéros de téléphone

Chiffres uniquement, format international sans `+` (ex. `2250700000000`). Les espaces, `+`, points et tirets sont retirés, un préfixe `00` est supprimé, et un numéro de **10 chiffres** reçoit `DEFAULT_COUNTRY_CODE` (`0700000000` → `2250700000000`). Valide : 8 à 15 chiffres, sinon `400`.

**Côte d'Ivoire (ancien et nouveau format)** : les numéros sont passés de 8 à 10 chiffres, mais WhatsApp peut encore enregistrer l'ancien format (`22578304287` au lieu de `2250778304287`). À chaque envoi, le service interroge WhatsApp (`onWhatsApp`) avec les deux formes et utilise celle qui existe. Si aucune n'existe, le message est abandonné sans nouvel essai (log `n'existe pas sur WhatsApp`).

## Routes

Toutes exigent `x-api-key`. Header optionnel sur les `POST` : `Idempotency-Key`.

### `GET /health`
```bash
curl http://localhost:3001/health -H "x-api-key: $KEY"
# {"ready":true,"queueLength":0}
```

### `GET /templates`
Liste des types et des champs de `data` attendus.
```bash
curl http://localhost:3001/templates -H "x-api-key: $KEY"
```

### `POST /notify`
Body : `{ "type": string, "phone": string, "data": object }`.
```bash
curl -X POST http://localhost:3001/notify \
  -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: proposal_published:42" \
  -d '{"type":"proposal_published","phone":"0700000000","data":{"nom":"Awa","matiere":"Algèbre 1"}}'
# 202 {"queued":true,"queueLength":1,"duplicate":false}
```
Même requête rejouée → `202 {"queued":true,"queueLength":1,"duplicate":true}` (rien de nouveau en file).

| Code | Cas |
|---|---|
| `202` | Mis en file (ou doublon) |
| `400` | Type inconnu (la réponse liste les types), numéro invalide, champs requis manquants (`missing`) |
| `401` | Clé API invalide |
| `422` | `Idempotency-Key` réutilisée avec un contenu différent |

### `POST /send`
Texte libre pour les cas non prévus. Body : `{ "phone": string, "message": string }` (4000 caractères max).
```bash
curl -X POST http://localhost:3001/send \
  -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"phone":"2250700000000","message":"Bonjour *test*"}'
```

## Modèles disponibles

| Type | Destinataire | Champs requis | Champs optionnels | E-mail d'origine |
|---|---|---|---|---|
| `contact_message` | admin | `nom`, `email`, `objet`, `message` | — | Formulaire de contact |
| `proposal_admin` | admin | `nom`, `email`, `type`, `filiere`, `niveau`, `matiere`, `annee` | `id`, `session`, `fileName`, `fileSize`, `description`, `downloadUrl`, `reviewUrl` | Nouvelle proposition |
| `proposal_received` | contributeur | `nom`, `matiere`, `type`, `filiere` | — | Accusé de réception |
| `proposal_published` | contributeur | `nom`, `matiere` | — | Document en ligne |
| `proposal_rejected` | contributeur | `nom`, `matiere` | `motif` | Proposition refusée |
| `signup_confirmation` | nouvel inscrit | `prenom`, `email` | — | Confirmation d'inscription (Supabase) |
| `password_reset_requested` | propriétaire du compte | `prenom`, `email` | — | Mot de passe oublié (Supabase) |

Pour ajouter un modèle : ajoutez une entrée `{ description, required, optional, build(data) }` dans `src/templates.js` ; il apparaît automatiquement dans `/notify` et `/templates`. Mise en forme WhatsApp : `*gras*`, `_italique_`.

## Lancement

```bash
cp .env.example .env && npm install
npm run dev      # node --watch src/index.js
npm start
```
Au premier démarrage, scannez le QR code (**WhatsApp → Appareils connectés**). Session conservée dans `auth/` (volume `wa-auth` sous Docker).

## Diffusion de masse

Messages envoyés à plusieurs personnes, dans une file séparée qui passe **après** les messages urgents. Voir la [documentation complète](../README.md#diffusion-dannonces-whatsapp-admins).

```bash
curl -X POST http://localhost:3001/broadcast -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"campaignId":"annonce-2026-10-01","message":"Bonjour {prenom}, la bibliothèque a de nouveaux sujets !","recipients":[{"phone":"0700000001","prenom":"Awa"},{"phone":"0700000002","prenom":"Koffi"}]}'
# 202 {"campaignId":"…","statut":"en_cours","total":2,"restants":2,"invalid":0,"duplicates":0,"duplicate":false}

curl http://localhost:3001/campaigns/annonce-2026-10-01 -H "x-api-key: $KEY"      # progression
curl -X DELETE http://localhost:3001/campaigns/annonce-2026-10-01 -H "x-api-key: $KEY"   # annuler le reste
```

- `campaignId` : 8 à 100 caractères (lettres, chiffres, `-`, `_`, `:`). Le même identifiant rejoué ne remet rien en file (`duplicate: true`).
- `recipients` : jusqu'à `BROADCAST_MAX_RECIPIENTS` (1000). Numéros normalisés ; invalides (`invalid`) et doublons (`duplicates`) écartés.
- `message` : 1500 caractères max ; `{prenom}` et `{nom}` remplacés pour chaque personne.
- Les compteurs `erreurs` détaillent les échecs (`numero_absent_de_whatsapp`, `echec_envoi`).

## Routes publiques et hébergement au disque éphémère

- `GET /ping` : répond `ok`, **sans clé** et sans donnée. Pour un contrôle de disponibilité (UptimeRobot) qui garde un hébergeur gratuit éveillé.
- `GET /qr?key=<QR_KEY>` : page qui affiche le QR code (rafraîchie toute seule). Répond 404 si `QR_KEY` n'est pas défini ou erroné. À utiliser pour la connexion initiale, puis retirer `QR_KEY`.
- `SESSION_STORE=supabase` : la session WhatsApp et la file d'attente sont stockées dans la table `wa_state` de Supabase (migration `20261002030000_wa_state.sql`) au lieu du disque. Le service reprend sa session après n'importe quel redémarrage. Voir [../DEPLOY-RENDER.md](../DEPLOY-RENDER.md).
- Si le numéro est déconnecté depuis le téléphone (`loggedOut`), la session est effacée automatiquement et un nouveau QR code apparaît.
- Si une autre instance reprend la session (code 440), le service patiente 60 s avant de se reconnecter.
