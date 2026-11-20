#!/usr/bin/env bash
# Kod za prijavu organizatora na lokalnom stacku (/organizator, /skener).
#
# Lokalni GoTrue šalje mail u Mailpit (:55324) i to sa zadanim predloškom bez
# koda, pa kod izdajemo admin API-jem (`generate_link` vraća `email_otp`).
# Novi kod poništava prethodni.
#
#   scripts/lokalno/kod-za-prijavu.sh stepanic.ivan@gmail.com
set -euo pipefail
EMAIL="${1:?upotreba: $0 <email>}"
API="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../domovina-api" && pwd)"
eval "$(cd "$API" && supabase status -o env 2>/dev/null)"
: "${SERVICE_ROLE_KEY:?lokalni Supabase ne radi — u ../domovina-api pokreni supabase start}"

curl -s -X POST http://127.0.0.1:55321/auth/v1/admin/generate_link \
  -H "apikey: $SERVICE_ROLE_KEY" -H "authorization: Bearer $SERVICE_ROLE_KEY" \
  -H 'content-type: application/json' \
  -d "{\"type\":\"magiclink\",\"email\":\"$EMAIL\"}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(r.email_otp??JSON.stringify(r))})'
