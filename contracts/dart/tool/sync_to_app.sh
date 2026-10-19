#!/usr/bin/env bash
# Copies the generated contracts into the Flutter app (not in this repo).
#   contracts/dart/tool/sync_to_app.sh [APP_DIR]      default APP_DIR=~/dev/honto-app
#   DRY_RUN=1 contracts/dart/tool/sync_to_app.sh      print what would be copied
# Destinations (owned by W0 in PLANO_TECNICO.md):
#   lib/api/*.dart                                   models, HontoApi, HttpHontoApi, FakeHontoApi, fixtures
#   test/api/*_test.dart                             the same tests that run here
#   packages/honto_native/pigeons/honto_native.dart  Pigeon input
#   packages/honto_native/lib/src/honto_native.g.dart, ios/Classes/HontoNative.g.swift,
#   packages/honto_native/android/src/main/kotlin/com/hontogame/honto_native/HontoNative.g.kt
#   contracts/widget-snapshot.v1.json                schema for the native snapshot writers (NSE, FCM service)
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"          # contracts/dart
CONTRACTS="$(cd "$HERE/.." && pwd)"               # contracts
APP="${1:-$HOME/dev/honto-app}"
APP_PKG="${APP_PACKAGE:-honto}"                   # Dart package name of the app (pubspec name)
[ -f "$APP/pubspec.yaml" ] || { echo "No pubspec.yaml in $APP" >&2; exit 1; }

copy() { # src dst
  if [ "${DRY_RUN:-}" = 1 ]; then echo "would copy ${1#$CONTRACTS/} -> ${2#$APP/}"; return; fi
  mkdir -p "$(dirname "$2")" && cp "$1" "$2" && echo "copied ${1#$CONTRACTS/} -> ${2#$APP/}"
}

for f in "$HERE"/lib/src/*.dart; do copy "$f" "$APP/lib/api/$(basename "$f")"; done
# Barrel: same exports as lib/honto_contracts.dart, but flat.
if [ "${DRY_RUN:-}" != 1 ]; then
  sed -e "s#'src/#'#" -e '/^library;$/d' "$HERE/lib/honto_contracts.dart" > "$APP/lib/api/honto_api.dart"
  echo "wrote lib/api/honto_api.dart"
fi
for f in "$HERE"/test/*_test.dart; do
  dst="$APP/test/api/$(basename "$f")"
  copy "$f" "$dst"
  [ "${DRY_RUN:-}" = 1 ] || sed -i.bak "s#package:honto_contracts/honto_contracts.dart#package:$APP_PKG/api/honto_api.dart#" "$dst" && rm -f "$dst.bak"
done

P="$CONTRACTS/pigeon"
copy "$P/pigeons/honto_native.dart" "$APP/packages/honto_native/pigeons/honto_native.dart"
copy "$P/pigeons/copyright.txt" "$APP/packages/honto_native/pigeons/copyright.txt"
copy "$P/generated/dart/honto_native.g.dart" "$APP/packages/honto_native/lib/src/honto_native.g.dart"
copy "$P/generated/swift/HontoNative.g.swift" "$APP/packages/honto_native/ios/Classes/HontoNative.g.swift"
copy "$P/generated/kotlin/HontoNative.g.kt" "$APP/packages/honto_native/android/src/main/kotlin/com/hontogame/honto_native/HontoNative.g.kt"
copy "$CONTRACTS/widget-snapshot.v1.json" "$APP/contracts/widget-snapshot.v1.json"

grep -q "^  http:" "$APP/pubspec.yaml" || echo "NOTE: add 'http: ^1.2.0' to $APP/pubspec.yaml dependencies"
echo "Done. Run: (cd $APP && flutter pub get && flutter analyze && flutter test test/api)"
