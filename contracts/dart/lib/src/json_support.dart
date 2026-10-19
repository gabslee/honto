// Hand-written support for the generated code. Keep free of Flutter imports (pure Dart).
import 'models.g.dart';

/// Distinguishes "omit" (field is null) from "send null" (`Nullable(null)`) in PATCH bodies.
class Nullable<T> {
  const Nullable(this.value);
  final T? value;
}

/// Sends one request and returns the decoded JSON body (null for 204/304).
/// Throws [HontoApiException] for non-2xx responses.
abstract class HontoTransport {
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body});
}

class HontoApiException implements Exception {
  HontoApiException(this.statusCode, this.error, {this.retryAfter});

  final int statusCode;

  /// Parsed `{ error, code }` body when the server sent one.
  final ApiError? error;

  /// From `Retry-After` (429).
  final Duration? retryAfter;

  ErrorCode? get code => error?.code;

  @override
  String toString() => 'HontoApiException($statusCode, ${error?.code.wire}: ${error?.error})';
}
