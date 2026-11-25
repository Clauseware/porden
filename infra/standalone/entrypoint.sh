#!/bin/sh
set -eu
cd /app
# Local HTTPS verification can explicitly trust Caddy's public test CA without disabling TLS checks.
if [ -n "${PORDEN_EXTRA_CA_BASE64:-}" ]; then
  printf '%s' "$PORDEN_EXTRA_CA_BASE64" | base64 -d > /tmp/porden-extra-ca.pem
  export SSL_CERT_FILE=/tmp/porden-extra-ca.pem
fi
case "${1:-}" in
  platform)
    bun apps/api/src/db/platform-migrate.ts
    exec bun apps/api/src/platform-index.ts
    ;;
  merchant|courier)
    export ORGANIZATION_ROLE="$1"
    bun apps/api/src/db/migrate.ts
    exec bun apps/api/src/index.ts
    ;;
  *)
    echo 'Expected service: platform, merchant, or courier' >&2
    exit 1
    ;;
esac
