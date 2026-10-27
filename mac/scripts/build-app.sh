#!/usr/bin/env bash
# Builds OpenZen.app, signs it, installs it at a stable path, and (unless OPENZEN_NO_LAUNCH=1)
# restarts it. The lessons from Scrawl's install-app.sh:
#  - TCC (microphone, system audio, notifications) ties a grant to the bundle's path and code
#    identity. Ad-hoc signing changes the identity every build, so macOS asks again each time.
#    Sign with a stable certificate: OPENZEN_SIGN_ID, else a self-signed "OpenZen Dev" code-signing
#    certificate in the login keychain, else "Scrawl Dev" if this Mac has it, else ad hoc (warned).
#  - Install at one path (~/Applications/OpenZen.app) and never run .build/ directly: cleaning
#    .build unlinks the binary and tccd drops the grants.
#  - Build the bundle beside its final place and swap it in whole (App Management refuses writes
#    inside an existing bundle from a terminal that lacks that permission).
set -euo pipefail
export LC_ALL=C

MAC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${OPENZEN_CONFIG:-debug}"
FINAL_APP_DIR="${OPENZEN_APP_DIR:-${HOME}/Applications/OpenZen.app}"
APP_DIR="${FINAL_APP_DIR%.app}.staging.app"
BUNDLE_ID="com.everyapp.openzen"

cd "${MAC_DIR}"
swift build -c "${CONFIG}" --product OpenZen
BIN="$(swift build -c "${CONFIG}" --show-bin-path)/OpenZen"

rm -rf "${APP_DIR}"
mkdir -p "${APP_DIR}/Contents/MacOS" "${APP_DIR}/Contents/Resources" "$(dirname "${FINAL_APP_DIR}")"
cp -f "${BIN}" "${APP_DIR}/Contents/MacOS/OpenZen"
cp -f "${MAC_DIR}/Resources/Info.plist" "${APP_DIR}/Contents/Info.plist"
printf 'APPL????' > "${APP_DIR}/Contents/PkgInfo"

IDENTITIES="$(security find-identity -v -p codesigning 2>/dev/null || true)"
IDENTITY="-"
for candidate in "${OPENZEN_SIGN_ID:-}" "OpenZen Dev" "Scrawl Dev"; do
  if [[ -n "${candidate}" ]] && grep -q "\"${candidate}\"" <<<"${IDENTITIES}"; then
    IDENTITY="${candidate}"
    break
  fi
done
if [[ "${IDENTITY}" == "-" ]]; then
  echo "no signing identity; signing ad hoc (macOS will ask for permissions again after each rebuild)" >&2
fi
codesign --force --options runtime --timestamp=none \
  --entitlements "${MAC_DIR}/Resources/OpenZen.entitlements" \
  --identifier "${BUNDLE_ID}" --sign "${IDENTITY}" "${APP_DIR}"
codesign --verify --strict "${APP_DIR}"
echo "signed with: ${IDENTITY}"

pkill -f "OpenZen.app/Contents/MacOS/OpenZen" 2>/dev/null || true
for _ in {1..40}; do
  pgrep -f "OpenZen.app/Contents/MacOS/OpenZen" >/dev/null || break
  sleep 0.05
done
rm -rf "${FINAL_APP_DIR}"
mv "${APP_DIR}" "${FINAL_APP_DIR}"
echo "installed: ${FINAL_APP_DIR}"

if [[ "${OPENZEN_NO_LAUNCH:-0}" != "1" ]]; then
  open -a "${FINAL_APP_DIR}"
  sleep 1
  pgrep -fl "OpenZen.app/Contents/MacOS/OpenZen" || { echo "OpenZen didn't start" >&2; exit 1; }
fi
