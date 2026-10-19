import 'dart:convert';

import 'package:honto_contracts/honto_contracts.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

http.Response _json(String body, int status) =>
    http.Response.bytes(utf8.encode(body), status, headers: {'content-type': 'application/json; charset=utf-8'});

void main() {
  test('sends bearer token, encodes path/query and decodes models', () async {
    final seen = <http.Request>[];
    final client = MockClient((request) async {
      seen.add(request);
      if (request.url.path == '/api/v1/memories/2026-10-19') return _json(hontoFixtures['getMemoryDay.200']!, 200);
      if (request.url.path == '/api/v1/memories') return _json(hontoFixtures['getMemoriesMonth.200']!, 200);
      if (request.url.path == '/api/v1/couple/join') return _json(hontoFixtures['joinCouple.201']!, 201);
      if (request.url.path == '/api/v1/photos/ph%201') return http.Response('', 204);
      return http.Response('{}', 500);
    });
    final api = HttpHontoApi(HttpHontoTransport(baseUrl: Uri.parse('https://hontogame.com'), token: () async => 'hm_u_abc', client: client));
    final day = await api.getMemoryDay('2026-10-19');
    expect(day.photos, hasLength(3));
    expect(day.photos[1].phrase, '会いたい · I miss you');
    expect((await api.getMemoriesMonth(month: '2026-10')).days, isNotEmpty);
    expect((await api.joinCouple(const JoinRequest(code: 'K7Q2XM'))).id, 'cpl_01');
    await api.deletePhoto('ph 1');
    expect(seen.every((r) => r.headers['Authorization'] == 'Bearer hm_u_abc'), isTrue);
    expect(seen[1].url.queryParameters['month'], '2026-10');
    expect(jsonDecode(seen[2].body), {'code': 'K7Q2XM'});
    expect(seen[2].headers['Content-Type'], startsWith('application/json'));
    expect(seen[3].method, 'DELETE');
  });

  test('maps errors to HontoApiException with code and Retry-After', () async {
    final client = MockClient((_) async => http.Response(hontoFixtures['sendNudge.429']!, 429, headers: {'retry-after': '42'}));
    final api = HttpHontoApi(HttpHontoTransport(baseUrl: Uri.parse('https://hontogame.com'), token: () async => 'hm_u_abc', client: client));
    await expectLater(
        api.sendNudge(const NudgeRequest(source: NudgeSource.widget)),
        throwsA(isA<HontoApiException>()
            .having((e) => e.statusCode, 'status', 429)
            .having((e) => e.code, 'code', ErrorCode.rateLimited)
            .having((e) => e.retryAfter, 'retryAfter', const Duration(seconds: 42))));
  });
}
