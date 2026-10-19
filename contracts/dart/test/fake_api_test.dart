import 'package:honto_contracts/honto_contracts.dart';
import 'package:test/test.dart';

void main() {
  var now = DateTime.utc(2026, 10, 19, 12);
  DateTime clock() => now;

  test('unpaired: pairing flow then Today works', () async {
    final api = FakeHontoApi(scenario: FakeScenario.unpaired, clock: clock);
    expect((await api.getMe()).couple, isNull);
    await expectLater(api.getToday(), throwsA(isA<HontoApiException>().having((e) => e.code, 'code', ErrorCode.notPaired)));
    expect((await api.createInvite()).code, hasLength(6));
    await expectLater(api.joinCouple(const JoinRequest(code: 'expird')),
        throwsA(isA<HontoApiException>().having((e) => e.statusCode, 'status', 410)));
    final couple = await api.joinCouple(const JoinRequest(code: 'k7q-2xm'));
    expect(couple.partner.displayName, 'Kenji');
    expect((await api.getMe()).couple, isNotNull);
    expect((await api.getToday()).partner.timeZone, 'Asia/Tokyo');
  });

  test('free: photo upload becomes the daily photo; calendar and old memories are gated', () async {
    final api = FakeHontoApi(scenario: FakeScenario.pairedFree, clock: clock);
    expect((await api.getToday()).me.dailyPhoto, isNull);
    final created = await api.createPhoto(const PhotoCreateRequest(
        clientId: '6f1c9a3e-6c55-4c0f-9a3e-2b9d7e1a4c10', contentType: PhotoContentType.imageJpeg, bytes: 200000,
        thumbContentType: PhotoContentType.imageJpeg, thumbBytes: 20000, width: 1080, height: 1440,
        localDay: '2026-10-19', timeZone: 'America/Sao_Paulo'));
    expect(created.photo.status, PhotoStatus.pending);
    expect(created.upload.full.method, 'PUT');
    final ready = await api.completePhoto(created.photo.id);
    expect(ready.isDaily, isTrue);
    expect((await api.getToday()).me.dailyPhoto?.id, ready.id);
    await expectLater(api.getCalendar(from: '2026-10-19T00:00:00Z', to: '2026-10-26T00:00:00Z'),
        throwsA(isA<HontoApiException>()
            .having((e) => e.statusCode, 's', 402)
            .having((e) => e.code, 'code', ErrorCode.premiumRequired)));
    await expectLater(api.getMemoryDay('2026-10-01'), throwsA(isA<HontoApiException>().having((e) => e.statusCode, 's', 403)));
    expect((await api.getMemoryDay('2026-10-18')).photos, isNotEmpty);
    expect((await api.getMemoriesMonth(month: '2026-10')).historyLimitDays, 7);
  });

  test('nudge rate limit (60 s) and injected failures', () async {
    final api = FakeHontoApi(clock: clock);
    final first = await api.sendNudge(const NudgeRequest(source: NudgeSource.widget));
    expect(first.nextAllowedAt, now.add(const Duration(seconds: 60)));
    now = now.add(const Duration(seconds: 10));
    await expectLater(api.sendNudge(const NudgeRequest(source: NudgeSource.app)),
        throwsA(isA<HontoApiException>().having((e) => e.retryAfter, 'retryAfter', const Duration(seconds: 50))));
    now = now.add(const Duration(seconds: 60));
    await api.sendNudge(const NudgeRequest(source: NudgeSource.app));
    api.failNext('getToday', 409);
    await expectLater(api.getToday(), throwsA(isA<HontoApiException>()));
    expect((await api.getToday()).nudges.lastSentAt, now);
  });

  test('couple patch updates countdown; unpair keeps photos 30 days', () async {
    final api = FakeHontoApi(clock: clock);
    final c = await api.updateCouple(CouplePatch(reunion: Nullable(ReunionInput(at: DateTime.utc(2026, 12, 24), city: 'Lisbon'))));
    expect(c.reunion?.city, 'Lisbon');
    expect((await api.updateCouple(const CouplePatch(reunion: Nullable(null)))).reunion, isNull);
    final r = await api.unpairCouple();
    expect(r.photosAvailableUntil.difference(r.unpairedAt).inDays, 30);
    expect((await api.getMe()).couple, isNull);
  });

  test('trip Live Activity window = max(departsAt, arrivesAt - 8h) .. arrivesAt + 1h', () async {
    final api = FakeHontoApi(clock: clock);
    final trip = await api.createTrip(TripInput(
        traveler: Grantee.me, departsAt: DateTime.utc(2026, 11, 14, 6), arrivesAt: DateTime.utc(2026, 11, 14, 9, 30)));
    expect(trip.liveActivity.startsAt, DateTime.utc(2026, 11, 14, 6));
    expect(trip.liveActivity.endsAt, DateTime.utc(2026, 11, 14, 10, 30));
  });
}
