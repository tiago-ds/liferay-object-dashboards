#!/usr/bin/env bash
# Local stand-in for the LXC metadata Liferay injects on PaaS/SaaS.
#
# Source this, don't run it:   . ./local-env.sh && npm start
#
# RE-SOURCE AFTER EVERY `blade gw deploy`. A redeploy does not update the
# existing OAuth2 application — it creates a NEW one with a NEW client id and
# moves the scope grants to it. A stale id means auth.ts rejects every call with
# 401 "Invalid authorization", which looks like a token bug and is not.
#
# The client id is read live from Liferay's own lookup endpoint (the same one
# the browser's OAuth2 client uses), so there is nothing to copy by hand.
PORTAL="${PORTAL:-http://localhost:8080}"
ERC="${ERC:-object-aggregator-oaua}"

CLIENT_ID=$(curl -fsS --max-time 10 \
  "${PORTAL}/o/oauth2/application?externalReferenceCode=${ERC}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["client_id"])') || {
    echo "Could not read the OAuth2 application '${ERC}' from ${PORTAL}." >&2
    echo "Is the portal up and the client extension deployed?" >&2
    return 1 2>/dev/null || exit 1
  }

export COM_LIFERAY_LXC_DXP_MAIN_DOMAIN="${PORTAL#*://}"
export COM_LIFERAY_LXC_DXP_DOMAINS="${PORTAL#*://}"
export COM_LIFERAY_LXC_DXP_SERVER_PROTOCOL="${PORTAL%%:*}"
export LIFERAY_OAUTH_APPLICATION_EXTERNAL_REFERENCE_CODES="${ERC}"
export OBJECTAGGREGATOROAUA_OAUTH2_USER_AGENT_CLIENT_ID="${CLIENT_ID}"
export OBJECTAGGREGATOROAUA_OAUTH2_JWKS_URI=/o/oauth2/jwks

echo "object-aggregator env ready — ${ERC} -> ${CLIENT_ID}"
