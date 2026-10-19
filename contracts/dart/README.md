# honto_contracts (Dart)

Generated models and client for `/api/v1`, plus an in-memory `FakeHontoApi`, for the Flutter app at
`~/dev/honto-app` (not in this repo). Pure Dart (only `package:http`), so it also runs in widget/unit tests.

```dart
import 'package:honto/api/honto_api.dart';

final HontoApi api = const bool.fromEnvironment('HONTO_USE_FAKE_API')
    ? FakeHontoApi(scenario: FakeScenario.pairedFree, latency: const Duration(milliseconds: 300))
    : HttpHontoApi(HttpHontoTransport(baseUrl: Uri.parse(const String.fromEnvironment('HONTO_API_BASE_URL', defaultValue: 'https://hontogame.com')), token: session.readToken));

final today = await api.getToday();
await api.updateCouple(const CouplePatch(reunion: Nullable(null))); // clear the reunion
try { await api.sendNudge(const NudgeRequest(source: NudgeSource.app)); }
on HontoApiException catch (e) { if (e.code == ErrorCode.rateLimited) showWait(e.retryAfter); }
```

- `FakeScenario`: `pairedPremium`, `pairedFree`, `unpaired`, `pendingUnpair`. The fake keeps state (pairing,
  photo upload → daily photo, nudge 60 s rate limit, reunion edits) and `failNext('<operationId>', status)`
  injects the matching error fixture.
- Against the mock server instead: `npm run contracts:mock` in the web repo and use
  `HONTO_API_BASE_URL=http://10.0.2.2:4010` (Android emulator) / `http://localhost:4010` (iOS simulator).

## Sync into the app

From the web repo, on the Mac:

```bash
contracts/dart/tool/sync_to_app.sh ~/dev/honto-app            # DRY_RUN=1 to preview
cd ~/dev/honto-app && flutter pub get && flutter analyze && flutter test test/api
```

It copies `lib/src/*.dart` to `lib/api/` (with a `honto_api.dart` barrel), the tests to `test/api/`
(imports rewritten to `package:honto/...`; override with `APP_PACKAGE=`), the Pigeon input and its generated
Dart/Swift/Kotlin into `packages/honto_native/`, and `widget-snapshot.v1.json` into `contracts/`.
Never edit the copies: change `contracts/openapi.yaml` (or the Pigeon file) here, run
`npm run contracts:generate` (Pigeon: `cd contracts/pigeon && dart run pigeon --input pigeons/honto_native.dart`),
open a PR, then sync.

## Local checks

```bash
cd contracts/dart && dart pub get && dart analyze && dart test   # or: npm run contracts:dart
```
