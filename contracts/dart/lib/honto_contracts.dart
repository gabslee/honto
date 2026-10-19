/// Honto `/api/v1` contracts for the Flutter app.
///
/// - [HontoApi]: interface of every client operation (generated).
/// - [HttpHontoApi] + [HttpHontoTransport]: real client.
/// - [FakeHontoApi]: in-memory fake backed by the shared JSON fixtures.
library;

export 'src/api.g.dart';
export 'src/fake_honto_api.dart';
export 'src/fixtures.g.dart';
export 'src/http_transport.dart';
export 'src/json_support.dart';
export 'src/models.g.dart';
