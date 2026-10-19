#!/usr/bin/env bash
# Dart side of the contracts: analyze + test the honto_contracts package and verify the Pigeon output is
# up to date. Needs a Dart SDK >= 3.5 (or Flutter) on PATH; skipped with a notice otherwise.
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v dart >/dev/null 2>&1; then
  echo "contracts:dart skipped (no dart on PATH)"; exit 0
fi
(cd dart && dart pub get >/dev/null && dart analyze --fatal-infos && dart test)
(cd pigeon && dart pub get >/dev/null \
  && tmp=$(mktemp -d) && cp -r generated "$tmp/before" \
  && dart run pigeon --input pigeons/honto_native.dart >/dev/null \
  && diff -r "$tmp/before" generated && echo "pigeon: generated files are up to date")
