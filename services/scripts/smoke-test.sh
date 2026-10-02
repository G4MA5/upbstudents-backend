#!/usr/bin/env bash
# Vérifie qu'un wa-service déployé répond correctement (à lancer depuis n'importe où).
#   ./scripts/smoke-test.sh https://wa.mondomaine.com <API_KEY>
set -u
URL="${1:-}"; KEY="${2:-}"
if [ -z "$URL" ] || [ -z "$KEY" ]; then echo "Usage : $0 <URL> <API_KEY>"; exit 2; fi
URL="${URL%/}"; fail=0

check() { # nom, attendu, obtenu
  if [ "$2" = "$3" ]; then echo "  OK    $1"; else echo "  ECHEC $1 (attendu $2, obtenu $3)"; fail=1; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@"; }

echo "Test de $URL"
check "HTTPS valide + /health avec clé"      200 "$(code -H "x-api-key: $KEY" "$URL/health")"
check "Refus sans clé API"                   401 "$(code "$URL/health")"
check "Refus avec une mauvaise clé"          401 "$(code -H "x-api-key: mauvaise" "$URL/health")"
check "Liste des modèles (/templates)"       200 "$(code -H "x-api-key: $KEY" "$URL/templates")"
check "Type de notification inconnu → 400"   400 "$(code -X POST -H "x-api-key: $KEY" -H 'Content-Type: application/json' -d '{"type":"inconnu","phone":"0700000000","data":{}}' "$URL/notify")"

echo "Etat de WhatsApp :"
curl -s --max-time 15 -H "x-api-key: $KEY" "$URL/health"; echo
echo "  (ready doit valoir true ; sinon scannez le QR code : docker compose logs -f wa-service)"

if [ "$fail" -eq 0 ]; then echo "Tout est bon."; else echo "Des vérifications ont échoué."; fi
exit $fail
