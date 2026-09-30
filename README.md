# UpB Student's — API

Next.js 15 (routes API uniquement) · Supabase · Nodemailer.

## Variables d'environnement

Voir `.env.example`. À ajouter sur Vercel en plus des variables existantes :

| Variable                   | Rôle                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `DOCUMENT_UPLOAD_PASSWORD` | Mot de passe contributeur (remplace celui qui était écrit dans le code : **choisir une nouvelle valeur**) |
| `FRONTEND_URL`             | URL publique du site (liens des e-mails d'authentification)                                               |
| `GOOGLE_CLIENT_ID`         | Identifiant OAuth du client Web Google                                                                    |
| `GOOGLE_CLIENT_SECRET`     | Secret OAuth du client Web Google (backend uniquement)                                                    |
| `ADMIN_EMAIL`              | Reçoit les propositions de documents (par défaut `EMAIL_RECEIVER`)                                        |
| `ALLOWED_ORIGINS`          | Origines CORS supplémentaires, séparées par des virgules                                                  |

Dans Supabase → Authentication → URL Configuration, ajoutez
`<FRONTEND_URL>/mot-de-passe-oublie` et `<FRONTEND_URL>/` aux « Redirect URLs ».

Pour Google, activez le fournisseur Google dans Supabase → Authentication →
Sign In / Providers et renseignez le même client ID et secret. Dans Google
Cloud Console, ajoutez `https://<DOMAINE_BACKEND>/api/google/callback` aux URI
de redirection autorisées du client Web (et `http://localhost:3000/api/google/callback`
pour le développement local). Définissez également `FRONTEND_URL` vers le site
frontend de l'environnement concerné.

## Base de données

Un seul script à exécuter dans Supabase → SQL Editor :
`supabase/migrations/20260923000000_complements.sql`.

Il est idempotent (ré-exécutable sans erreur) et non destructif : aucune
donnée ni colonne existante n'est modifiée. Il ajoute :

| Élément                     | Rôle                                                                  |
| --------------------------- | --------------------------------------------------------------------- |
| `document.created_at`       | Date d'ajout (vide pour les documents existants, automatique ensuite) |
| `favori`                    | Favoris par compte, synchronisés entre appareils                      |
| `proposition`               | Documents proposés, en attente de validation                          |
| bucket privé `propositions` | Fichiers proposés (20 Mo max, PDF/DOC/DOCX/PNG/JPG)                   |
| index                       | Recherche par filière/type, profil par compte                         |

Sans ce script, l'application fonctionne mais les favoris sont indiqués
comme indisponibles et les propositions ne sont transmises que par e-mail.

## Routes

| Route                  | Méthode             | Accès                                               |
| ---------------------- | ------------------- | --------------------------------------------------- |
| `/api/afficher`        | GET                 | public                                              |
| `/api/connexion`       | POST                | public                                              |
| `/api/session`         | POST                | refresh token                                       |
| `/api/deconnexion`     | POST                | connecté                                            |
| `/api/inscription`     | POST                | public                                              |
| `/api/forgot`          | POST                | public                                              |
| `/api/reset`           | POST                | lien de réinitialisation                            |
| `/api/mot-de-passe`    | POST                | connecté                                            |
| `/api/utilisateur`     | GET                 | connecté                                            |
| `/api/document`        | POST                | connecté + mot de passe contributeur                |
| `/api/supprimer`       | DELETE              | contributeur autorisé                               |
| `/api/proposer`        | POST                | public (mise en attente, jamais publié directement) |
| `/api/propositions`    | GET / POST          | contributeur autorisé                               |
| `/api/favoris`         | GET / POST / DELETE | connecté                                            |
| `/api/contact`         | POST                | public                                              |
| `/api/google`          | GET                 | public (démarrage OAuth Google)                     |
| `/api/google/callback` | GET                 | retour OAuth Google                                 |

Les fichiers sont envoyés directement à Supabase Storage via une URL signée
(la limite de 4,5 Mo des fonctions Vercel ne s'applique donc plus).
