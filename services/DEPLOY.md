# Mise en production — guide pas à pas

Ce guide déploie **wa-service** (notifications et diffusions WhatsApp) sur un serveur, en HTTPS, et le relie au backend Next déjà en ligne.
Pour le détail des fonctionnalités, voir [README.md](README.md).

## 1. Ce qui est déployé

| Élément | Où | Déploiement |
|---|---|---|
| **wa-service** | Un serveur toujours allumé (VPS) | **Oui, obligatoire** pour les notifications et diffusions WhatsApp |
| **storage-service** | Même serveur | **Optionnel** : le backend Next ne l'appelle pas encore (les documents vont directement à Supabase). À déployer seulement quand il sera branché |
| **Backend Next** | Vercel (déjà en ligne) | Il faut y ajouter des variables et appliquer 3 migrations SQL |
| **Frontend** | Netlify (déjà en ligne) | Rien à changer pour le serveur ; la page « Diffusion » et le consentement sont dans le frontend |

> Pourquoi pas sur Vercel ou Netlify ? `wa-service` garde une connexion WhatsApp ouverte en permanence : il lui faut un processus qui tourne en continu, ce que les plateformes « serverless » ne permettent pas.

## 2. Ce qu'il vous faut

- **Un serveur Linux** (Ubuntu 22.04 ou plus récent), 1 vCPU et 1 Go de RAM suffisent, avec une IPv4 publique. N'importe quel fournisseur de VPS convient.
- **Un nom de domaine ou sous-domaine** qui pointera vers le serveur (ex. `wa.mondomaine.com`). Sans domaine à vous, un sous-domaine gratuit (DuckDNS, etc.) fonctionne aussi. HTTPS est indispensable : Vercel appellera ce service sur Internet avec une clé secrète.
- **Un numéro WhatsApp dédié** à l'application, de préférence pas votre numéro personnel : l'usage automatisé d'un compte WhatsApp classique peut mener à son blocage.
- Les accès à **Vercel** (variables d'environnement) et **Supabase** (SQL Editor).

## 3. Préparer le serveur

Connectez-vous en SSH, puis :

```bash
# Mises à jour et Docker
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # reconnectez-vous ensuite à la session SSH

# Pare-feu : seulement SSH, HTTP et HTTPS
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

**DNS** : chez votre gestionnaire de domaine, créez un enregistrement `A` : `wa` → l'adresse IP du serveur. Vérifiez qu'il est actif avant de continuer : `ping wa.mondomaine.com` doit afficher l'IP du serveur (la propagation peut prendre quelques minutes).

## 4. Récupérer le code

```bash
git clone <URL-de-votre-dépôt-backend> backend
cd backend/services
```

Les fichiers `.env` ne sont pas dans Git : on les crée à l'étape suivante.

## 5. Configurer

**a) Le domaine** (lu par Docker Compose) :

```bash
cp .env.example .env
nano .env        # WA_DOMAIN=wa.mondomaine.com
```

**b) wa-service** :

```bash
cp wa-service/.env.example wa-service/.env
nano wa-service/.env
```

| Variable | Valeur en production |
|---|---|
| `PORT` | `3001` (ne pas changer) |
| `API_KEY` | une clé **neuve et longue** : `openssl rand -hex 32`. **Notez-la**, elle sert à l'étape 8 |
| `DEFAULT_COUNTRY_CODE` | `225` |
| `BROADCAST_MAX_RECIPIENTS` | `1000` |
| `DATA_DIR` | `data` (ne pas changer : c'est le volume `wa-data`) |

> N'utilisez pas la clé de développement. Une clé de production différente évite qu'une fuite côté dev expose la production.

## 6. Lancer

```bash
docker compose --profile proxy up -d --build
docker compose ps
```

`wa-service` doit passer à l'état **healthy** en une minute environ, et `caddy` à **running**. En cas de problème : `docker compose logs caddy` (le certificat HTTPS échoue presque toujours à cause du DNS ou d'un port fermé).

## 7. Connecter le numéro WhatsApp (QR code)

```bash
docker compose logs -f wa-service
```

Un QR code s'affiche dans le terminal (agrandissez la fenêtre pour qu'il reste lisible).

1. Sur le téléphone du **numéro dédié** : WhatsApp → **Paramètres → Appareils connectés → Connecter un appareil**.
2. Scannez le QR code. Le log affiche « WhatsApp connecté. ».
3. Si vous aviez connecté ce même numéro sur votre PC de développement, **déconnectez cet ancien appareil** dans la même liste (« Appareils connectés »). Deux instances avec le même numéro finissent par casser les clés de chiffrement.

La session est conservée dans le volume `wa-auth` : plus besoin de rescanner, même après un redémarrage ou une mise à jour.

## 8. Vérifier que tout répond

Depuis votre ordinateur (Git Bash, WSL ou Linux) :

```bash
./scripts/smoke-test.sh https://wa.mondomaine.com <API_KEY>
```

Les 5 vérifications doivent être « OK » et `ready` doit valoir `true`. Sinon, voir « Dépannage » plus bas.

## 9. Base de données : appliquer les migrations (Supabase de production)

Dans **Supabase → SQL Editor**, exécutez ces fichiers **dans cet ordre** (un par un, bouton Run). Ils sont dans `supabase/migrations/` et peuvent être rejoués sans risque :

1. `20261002000000_diffusion.sql` : historique des diffusions
2. `20261002010000_diffusion_echecs.sql` : détail des numéros en échec
3. `20261002020000_whatsapp_consent.sql` : consentement WhatsApp

> **Attention** : après la 3ᵉ migration, personne ne reçoit plus de WhatsApp tant qu'il n'a pas accepté (c'est voulu : consentement explicite). Chaque étudiant verra la fenêtre de consentement à sa prochaine connexion.

## 10. Relier le backend Next (Vercel)

Dans **Vercel → votre projet backend → Settings → Environment Variables** (environnement *Production*), ajoutez :

| Variable | Valeur |
|---|---|
| `WA_SERVICE_URL` | `https://wa.mondomaine.com` |
| `WA_API_KEY` | la même valeur que `API_KEY` de wa-service |
| `ADMIN_WHATSAPP` | numéro WhatsApp de l'admin qui reçoit les alertes (ex. `0700000000`) |
| `BROADCAST_ADMIN_EMAILS` | e-mails des admins autorisés à diffuser, séparés par des virgules |
| `BROADCAST_DAILY_LIMIT` | `1000` (facultatif) |

**Redéployez ensuite** le backend (Deployments → Redeploy) : Vercel ne prend en compte les nouvelles variables qu'à un nouveau déploiement.

## 11. Premiers tests en réel

Faites-les dans cet ordre, avec de petits volumes :

1. **Formulaire de contact** du site : l'admin (`ADMIN_WHATSAPP`) reçoit un WhatsApp.
2. **Consentement** : connectez-vous avec un compte de test, la fenêtre « Restez informé sur WhatsApp » s'affiche ; acceptez.
3. **Diffusion test** : page *Diffusion* → cible = « Liste d'e-mails précise » avec **uniquement votre e-mail** → Vérifier → Envoyer. Le message arrive, l'historique l'enregistre.
4. **Diffusion réelle** seulement ensuite, en commençant par une petite filière.

## 12. Exploitation au quotidien

| Besoin | Commande (dans `services/`) |
|---|---|
| État des conteneurs | `docker compose ps` |
| Logs en direct | `docker compose logs -f wa-service` |
| Redémarrer | `docker compose restart wa-service` |
| Mettre à jour le code | `git pull && docker compose --profile proxy up -d --build` (volumes conservés, file reprise) |
| Arrêter | `docker compose --profile proxy down` (**jamais `-v`** : supprime la session WhatsApp) |

**Sauvegarde de la session WhatsApp** (à faire une fois, et après un nouveau scan) :

```bash
docker run --rm -v services_wa-auth:/d -v "$PWD":/b alpine tar czf /b/wa-auth.tgz -C /d .
```

(Le préfixe `services_` correspond au nom du dossier ; vérifiez avec `docker volume ls`.) Gardez l'archive **hors du serveur** et hors de Git : elle donne accès au compte WhatsApp.

**Surveillance** : un contrôle externe (UptimeRobot, etc.) qui appelle `GET /health` avec l'en-tête `x-api-key` ; alerte si la réponse ne contient pas `"ready":true`.

## 13. Dépannage

| Symptôme | Cause probable et action |
|---|---|
| `caddy` n'obtient pas de certificat | DNS pas encore propagé, ou ports 80/443 fermés : `docker compose logs caddy` |
| `smoke-test` : `401` partout | `WA_API_KEY` / clé passée au script différente de `API_KEY` du serveur |
| `ready: false` | QR code non scanné ou session perdue : `docker compose logs -f wa-service` |
| « loggedOut » dans les logs | Numéro déconnecté depuis le téléphone : arrêtez, supprimez le volume `services_wa-auth`, relancez et rescannez |
| La page Diffusion affiche « Espace réservé » | E-mail absent de `BROADCAST_ADMIN_EMAILS`, ou backend Vercel non redéployé |
| Diffusion refusée, erreur 503 | Migration 1 ou 3 pas appliquée dans Supabase |
| « Aucune personne ne correspond » | Personne n'a encore accepté WhatsApp : testez avec un compte qui a accepté |
| Les messages n'arrivent pas | Numéro absent de WhatsApp, ou wa-service déconnecté : voir les logs et `/health` |

## 14. Liste de contrôle finale

- [ ] DNS du sous-domaine → IP du serveur, HTTPS valide (cadenas)
- [ ] `docker compose ps` : `wa-service` healthy, `caddy` running
- [ ] QR code scanné avec le **numéro dédié**, ancien appareil de dev déconnecté
- [ ] `smoke-test.sh` entièrement « OK » et `ready: true`
- [ ] Clé `API_KEY` de **production** (≠ clé de dev), stockée en lieu sûr
- [ ] 3 migrations appliquées dans le Supabase de production
- [ ] Variables ajoutées dans Vercel **et** backend redéployé
- [ ] Test contact → WhatsApp admin reçu
- [ ] Test de consentement + diffusion à soi-même réussis
- [ ] Sauvegarde de `wa-auth` faite, hors du serveur
- [ ] Contrôle de disponibilité externe en place
