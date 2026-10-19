import 'dart:convert';

import 'package:http/http.dart' as http;

import 'json_support.dart';
import 'models.g.dart';

/// [HontoTransport] over `package:http` with an `hm_u_` bearer token.
class HttpHontoTransport implements HontoTransport {
  HttpHontoTransport({
    required this.baseUrl,
    required this.token,
    http.Client? client,
    this.userAgent,
    this.timeout = const Duration(seconds: 20),
  }) : _client = client ?? http.Client();

  /// e.g. `https://hontogame.com` or `http://10.0.2.2:4010` (mock server from the Android emulator).
  final Uri baseUrl;

  /// Returns the current `hm_u_…` token (from secure storage), or null when signed out.
  final Future<String?> Function() token;
  final String? userAgent;
  final Duration timeout;
  final http.Client _client;

  @override
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body}) async {
    final uri = baseUrl.replace(path: '${baseUrl.path.replaceAll(RegExp(r'/$'), '')}$path', queryParameters: query);
    final request = http.Request(method, uri)..headers['Accept'] = 'application/json';
    final bearer = await token();
    if (bearer != null && bearer.isNotEmpty) request.headers['Authorization'] = 'Bearer $bearer';
    if (userAgent != null) request.headers['User-Agent'] = userAgent!;
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    final response = await http.Response.fromStream(await _client.send(request).timeout(timeout));
    if (response.statusCode == 204 || response.statusCode == 304) return null;
    final decoded = response.body.isEmpty ? null : jsonDecode(utf8.decode(response.bodyBytes));
    if (response.statusCode >= 200 && response.statusCode < 300) return decoded;
    ApiError? error;
    if (decoded is Map<String, dynamic> && decoded['code'] is String) {
      try {
        error = ApiError.fromJson(decoded);
      } on Object {
        error = null;
      }
    }
    final retry = int.tryParse(response.headers['retry-after'] ?? '');
    throw HontoApiException(response.statusCode, error, retryAfter: retry == null ? null : Duration(seconds: retry));
  }
}
