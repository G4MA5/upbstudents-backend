# storage-service

Stocke les documents sur **Supabase Storage** (principal) avec **Cloudinary** en repli. Port **3002**.
Installation, Docker, sécurité : voir le [README principal](../README.md).

## Fonctionnement

- **`src/index.js`** : serveur Express, authentification `x-api-key`, routes, gestion des erreurs.
- **`src/supabase.js`** : client Supabase (clé `service_role`), upload, URL signée, suppression, calcul de l'usage.
- **`src/cloudinary.js`** : upload `raw` (dossier `documents`, type `private`), URL de téléchargement temporaire, suppression.
- **`src/idempotency.js`** : anti-doublons (voir [Idempotence](../README.md#idempotence)).

### Choix du fournisseur à l'upload

1. **Supabase** si `usage + taille du fichier ≤ SUPABASE_LIMIT_GB`.
2. **Cloudinary** si la limite serait dépassée, **ou** si l'upload Supabase échoue (l'erreur est loguée, puis on réessaie sur Cloudinary ; la réponse contient `fallback: true`).
3. `502` si les deux échouent.

**Usage Supabase** : calculé via l'API Storage (liste récursive du bucket, somme de `metadata.size`), mis en cache **5 minutes** et incrémenté localement après chaque upload. Si le calcul est impossible (erreur de liste), l'usage est inconnu et Supabase est tenté quand même. Une suppression force un recalcul au prochain upload.

**Nom du fichier** : `timestamp-nomfichier` (accents retirés, caractères spéciaux remplacés par `_`). Le `contentType` d'origine est conservé sur Supabase.

**Prérequis** : le bucket `SUPABASE_BUCKET` doit exister (le service ne le crée pas).

## Routes

Toutes exigent `x-api-key`.

### `GET /health`
```bash
curl http://localhost:3002/health -H "x-api-key: $KEY"
# {"ok":true,"supabaseUsageGB":0.412,"limitGB":4.5}
```
`supabaseUsageGB` vaut `null` si l'usage n'a pas pu être calculé.

### `POST /upload`
Multipart, champ `file`, **10 Mo max**. Header optionnel : `Idempotency-Key`.
```bash
curl -X POST http://localhost:3002/upload \
  -H "x-api-key: $KEY" -H "Idempotency-Key: proposal:42" \
  -F "file=@./cours.pdf"
# 201 {"provider":"supabase","key":"1700000000000-cours.pdf","fallback":false,"duplicate":false}
```
Même fichier rejoué avec la même clé (ou sans clé dans les 60 s) → `200` avec la réponse initiale et `"duplicate": true`, sans second stockage.

| Code | Cas |
|---|---|
| `201` | Fichier stocké |
| `200` | Doublon : réponse initiale rejouée |
| `400` | Champ `file` manquant |
| `413` | Fichier > 10 Mo |
| `422` | `Idempotency-Key` réutilisée avec un autre fichier |
| `502` | Aucun fournisseur disponible |

**Conservez `provider` et `key`** en base : ils sont nécessaires pour relire ou supprimer le fichier.

### `GET /url?provider=&key=`
URL temporaire valable **1 h** (URL signée Supabase, ou `private_download_url` Cloudinary).
```bash
curl "http://localhost:3002/url?provider=supabase&key=1700000000000-cours.pdf" -H "x-api-key: $KEY"
# {"url":"https://...","expiresIn":3600}
```
`400` si `provider` n'est ni `supabase` ni `cloudinary` ou si `key` manque ; `502` si le lien ne peut être généré.

### `DELETE /file`
Body JSON `{ "provider": "supabase" | "cloudinary", "key": string }`.
```bash
curl -X DELETE http://localhost:3002/file \
  -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"provider":"supabase","key":"1700000000000-cours.pdf"}'
# {"deleted":true}
```
**Idempotent** : supprimer un fichier déjà supprimé renvoie aussi `{"deleted":true}`.

## Erreurs

Toutes les erreurs sont en JSON : `{ "error": "message" }` (codes `400`, `401`, `404`, `413`, `422`, `500`, `502`). Les détails techniques sont dans les logs du service, jamais dans la réponse.

## À vérifier à la première mise en service

Le téléchargement de fichiers `raw` privés Cloudinary (`GET /url?provider=cloudinary`) n'a pas pu être testé avec de vrais identifiants : forcez un envoi sur Cloudinary (par exemple avec `SUPABASE_LIMIT_GB=0`) et ouvrez l'URL obtenue pour valider.

## Lancement

```bash
cp .env.example .env && npm install
npm run dev      # node --watch src/index.js
npm start
```
