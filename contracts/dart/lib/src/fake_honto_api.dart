// Hand-written in-memory fake of the API, seeded from the shared fixtures (contracts/fixtures/*.json).
// Lets the app run end to end without a backend: `HontoApi api = FakeHontoApi();`
import 'dart:convert';

import 'api.g.dart';
import 'fixtures.g.dart';
import 'json_support.dart';
import 'models.g.dart';

enum FakeScenario {
  /// Ana (São Paulo) paired with Kenji (Tokyo), Premium trial, photos today.
  pairedPremium,

  /// Paired, Free, no photo yet today (Memories locked after 7 days, calendar 402).
  pairedFree,

  /// Signed in, not paired (onboarding / pairing screens).
  unpaired,

  /// Unpaired yesterday; own photos kept 30 days (export flow).
  pendingUnpair,
}

class FakeHontoApi implements HontoApi {
  FakeHontoApi({this.scenario = FakeScenario.pairedPremium, DateTime Function()? clock, this.latency = Duration.zero})
      : _clock = clock ?? DateTime.now {
    _paired = scenario == FakeScenario.pairedPremium || scenario == FakeScenario.pairedFree;
    _premium = scenario == FakeScenario.pairedPremium;
    _today = _json(_premium ? 'getToday.200' : 'getToday.200.free_no_photos');
  }

  final FakeScenario scenario;
  final Duration latency;
  final DateTime Function() _clock;
  final Map<String, HontoApiException> _failures = {};
  late bool _paired;
  late bool _premium;
  late Map<String, dynamic> _today;
  DateTime? _lastNudge;
  final Map<String, Map<String, dynamic>> _pendingPhotos = {};

  /// Makes the next call to [operationId] throw, using the error fixture `<operationId>.<status>` if present.
  void failNext(String operationId, int status) {
    final key = '$operationId.$status';
    final raw = hontoFixtures[key];
    final error = raw == null
        ? ApiError(error: 'Injected failure', code: ErrorCode.internal)
        : ApiError.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    _failures[operationId] = HontoApiException(status, error,
        retryAfter: error.retryAfterSeconds == null ? null : Duration(seconds: error.retryAfterSeconds!));
  }

  // ---- helpers -------------------------------------------------------------------------------
  static Map<String, dynamic> _json(String key) {
    final raw = hontoFixtures[key];
    if (raw == null) throw StateError('No fixture $key');
    return jsonDecode(raw) as Map<String, dynamic>;
  }

  Future<T> _run<T>(String op, T Function() body, {bool needsCouple = false}) async {
    if (latency > Duration.zero) await Future<void>.delayed(latency);
    final failure = _failures.remove(op);
    if (failure != null) throw failure;
    if (needsCouple && !_paired) {
      throw HontoApiException(409, ApiError(error: 'Pair with your partner first.', code: ErrorCode.notPaired));
    }
    return body();
  }

  HontoApiException _premiumRequired(String message, {int statusCode = 403}) =>
      HontoApiException(statusCode, ApiError(error: message, code: ErrorCode.premiumRequired));

  String _iso(DateTime d) => d.toUtc().toIso8601String();

  Map<String, dynamic> _meJson() {
    final me = _json(switch (scenario) {
      FakeScenario.pendingUnpair => 'getMe.200.pending_unpair',
      _ => 'getMe.200',
    });
    if (!_paired) me['couple'] = null;
    if (!_premium) me['entitlement'] = _json('getMe.200.unpaired')['entitlement'];
    return me;
  }

  // ---- auth ----------------------------------------------------------------------------------
  @override
  Future<AuthSession> signInWithGoogle(GoogleSignInRequest body) =>
      _run('signInWithGoogle', () => AuthSession.fromJson(_json('signInWithGoogle.200')));

  @override
  Future<AuthSession> signInWithApple(AppleSignInRequest body) =>
      _run('signInWithApple', () => AuthSession.fromJson(_json('signInWithApple.201')));

  @override
  Future<EmailStartResponse> startEmailSignIn(EmailStartRequest body) =>
      _run('startEmailSignIn', () => EmailStartResponse.fromJson(_json('startEmailSignIn.202')));

  @override
  Future<AuthSession> verifyEmailSignIn(EmailVerifyRequest body) => _run('verifyEmailSignIn', () {
        // Code 999999 simulates an expired/invalid code.
        if (body.code == '999999') {
          throw HontoApiException(401, ApiError.fromJson(_json('verifyEmailSignIn.401')));
        }
        return AuthSession.fromJson(_json(body.platform == Platform.web ? 'verifyEmailSignIn.200.web' : 'verifyEmailSignIn.200'));
      });

  @override
  Future<LogoutResponse> logout() => _run('logout', () => LogoutResponse.fromJson(_json('logout.200')));

  // ---- me ------------------------------------------------------------------------------------
  @override
  Future<Me> getMe() => _run('getMe', () => Me.fromJson(_paired ? _meJson() : _json(scenario == FakeScenario.pendingUnpair ? 'getMe.200.pending_unpair' : 'getMe.200.unpaired')));

  @override
  Future<void> deleteMe() => _run('deleteMe', () {
        _paired = false;
      });

  @override
  Future<TimeZoneResult> updateTimeZone(TimeZoneUpdate body) =>
      _run('updateTimeZone', () => TimeZoneResult(timeZone: body.timeZone, updatedAt: _clock()));

  @override
  Future<ExportStatus> getExport() => _run('getExport',
      () => ExportStatus.fromJson(_json(scenario == FakeScenario.pendingUnpair ? 'getExport.200.ready' : 'getExport.200')));

  @override
  Future<ExportStatus> requestExport() => _run('requestExport', () => ExportStatus.fromJson(_json('requestExport.202')));

  // ---- couple --------------------------------------------------------------------------------
  @override
  Future<Invite> getInvite() => _run('getInvite', () {
        if (_paired) throw HontoApiException(409, ApiError.fromJson(_json('createInvite.409')));
        return Invite.fromJson(_json('getInvite.200'));
      });

  @override
  Future<Invite> createInvite() => _run('createInvite', () {
        if (_paired) throw HontoApiException(409, ApiError.fromJson(_json('createInvite.409')));
        return Invite.fromJson(_json('createInvite.201'));
      });

  /// Any 6-character code pairs, except `EXPIRD` (410) and `000000` (404).
  @override
  Future<Couple> joinCouple(JoinRequest body) => _run('joinCouple', () {
        final code = body.code.toUpperCase().replaceAll(RegExp(r'[\s-]'), '');
        if (_paired) throw HontoApiException(409, ApiError.fromJson(_json('joinCouple.409')));
        if (code == 'EXPIRD') throw HontoApiException(410, ApiError.fromJson(_json('joinCouple.410')));
        if (code.length != 6 || code == '000000') throw HontoApiException(404, ApiError.fromJson(_json('joinCouple.404')));
        _paired = true;
        return Couple.fromJson(_json('joinCouple.201'));
      });

  @override
  Future<Couple> getCouple() => _run('getCouple', () => Couple.fromJson(_coupleJson()), needsCouple: true);

  Map<String, dynamic> _coupleJson() => _json('getCouple.200')
    ..['premium'] = _premium
    ..['startedOn'] = _today['startedOn']
    ..['daysTogether'] = _today['daysTogether']
    ..['reunion'] = _today['reunion'];

  @override
  Future<Couple> updateCouple(CouplePatch body) => _run('updateCouple', () {
        if (body.startedOn != null) {
          _today['startedOn'] = body.startedOn!.value;
          _today['daysTogether'] = body.startedOn!.value == null
              ? null
              : _clock().toUtc().difference(DateTime.parse('${body.startedOn!.value}T00:00:00Z')).inDays;
        }
        if (body.reunion != null) {
          final r = body.reunion!.value;
          _today['reunion'] = r == null
              ? null
              : {'at': _iso(r.at), 'city': r.city, 'timeZone': r.timeZone, 'daysUntil': r.at.difference(_clock()).inDays};
        }
        return Couple.fromJson(_coupleJson());
      }, needsCouple: true);

  @override
  Future<UnpairResult> unpairCouple() => _run('unpairCouple', () {
        _paired = false;
        final now = _clock();
        return UnpairResult(unpairedAt: now, photosAvailableUntil: now.add(const Duration(days: 30)));
      }, needsCouple: true);

  // ---- today / photos / memories -------------------------------------------------------------
  @override
  Future<Today> getToday() => _run('getToday', () => Today.fromJson(_today), needsCouple: true);

  @override
  Future<PhotoCreateResponse> createPhoto(PhotoCreateRequest body) => _run('createPhoto', () {
        final res = _json('createPhoto.201');
        final photo = (res['photo'] as Map<String, dynamic>)
          ..['id'] = 'ph_fake_${body.clientId.substring(0, 8)}'
          ..['localDay'] = body.localDay
          ..['phraseKey'] = body.phraseKey
          ..['phrase'] = body.phrase
          ..['width'] = body.width
          ..['height'] = body.height
          ..['createdAt'] = _iso(_clock());
        _pendingPhotos[photo['id'] as String] = photo;
        return PhotoCreateResponse.fromJson(res);
      }, needsCouple: true);

  @override
  Future<Photo> completePhoto(String photoId) => _run('completePhoto', () {
        final photo = _pendingPhotos.remove(photoId);
        if (photo == null) throw HontoApiException(404, ApiError(error: 'Unknown photo.', code: ErrorCode.notFound));
        final me = _today['me'] as Map<String, dynamic>;
        photo
          ..['status'] = 'ready'
          ..['isDaily'] = me['dailyPhoto'] == null
          ..['urls'] = _json('completePhoto.200')['urls'];
        if (me['dailyPhoto'] == null) me['dailyPhoto'] = photo;
        me['photoCount'] = (me['photoCount'] as int) + 1;
        return Photo.fromJson(photo);
      }, needsCouple: true);

  @override
  Future<void> deletePhoto(String photoId) => _run('deletePhoto', () {
        final me = _today['me'] as Map<String, dynamic>;
        if ((me['dailyPhoto'] as Map<String, dynamic>?)?['id'] == photoId) me['dailyPhoto'] = null;
      }, needsCouple: true);

  @override
  Future<MemoriesMonth> getMemoriesMonth({required String month}) => _run('getMemoriesMonth', () {
        final json = _json(_premium ? 'getMemoriesMonth.200' : 'getMemoriesMonth.200.free')..['month'] = month;
        return MemoriesMonth.fromJson(json);
      }, needsCouple: true);

  @override
  Future<MemoryDay> getMemoryDay(String day) => _run('getMemoryDay', () {
        final cutoff = _clock().toUtc().subtract(const Duration(days: 7));
        if (!_premium && DateTime.parse('${day}T23:59:59Z').isBefore(cutoff)) {
          throw HontoApiException(403, ApiError.fromJson(_json('getMemoryDay.403')));
        }
        return MemoryDay.fromJson(_json('getMemoryDay.200')..['day'] = day);
      }, needsCouple: true);

  // ---- devices -------------------------------------------------------------------------------
  @override
  Future<Device> registerDevice(DeviceRegistration body) => _run('registerDevice', () {
        final now = _clock();
        return Device(id: 'dev_${body.kind.wire}', kind: body.kind, platform: body.platform, env: body.env, createdAt: now, lastSeenAt: now);
      });

  @override
  Future<void> unregisterDevice(String deviceId) => _run('unregisterDevice', () {});

  @override
  Future<LiveActivityToken> registerLiveActivityToken(LiveActivityTokenRequest body) => _run('registerLiveActivityToken',
      () => LiveActivityToken(id: 'lat_${body.kind.wire}', kind: body.kind, activityId: body.activityId, tripId: body.tripId, createdAt: _clock()));

  @override
  Future<void> revokeLiveActivityToken(String tokenId) => _run('revokeLiveActivityToken', () {});

  // ---- calendar ------------------------------------------------------------------------------
  @override
  Future<CalendarBusyResult> uploadCalendarBusy(CalendarBusyUpload body) => _run('uploadCalendarBusy', () {
        final allDay = body.blocks.where((b) => b.allDay == true).length;
        final titled = body.blocks.where((b) => b.allDay != true && b.title != null).length;
        return CalendarBusyResult(
            syncedAt: _clock(), stored: body.blocks.length - allDay, ignoredAllDay: allDay, droppedTitles: _premium ? 0 : titled);
      }, needsCouple: true);

  @override
  Future<CalendarView> getCalendar({required String from, required String to}) => _run('getCalendar', () {
        if (!_premium) throw _premiumRequired('The couple calendar is part of Premium.', statusCode: 402);
        return CalendarView.fromJson(_json('getCalendar.200'));
      }, needsCouple: true);

  @override
  Future<CalendarShares> getCalendarShares() =>
      _run('getCalendarShares', () => CalendarShares.fromJson(_json('getCalendarShares.200')));

  @override
  Future<CalendarShares> updateCalendarShares(CalendarSharesUpdate body) => _run('updateCalendarShares', () {
        if (!_premium && body.calendars.any((c) => c.shareTitles)) throw _premiumRequired('Sharing event titles is part of Premium.');
        return CalendarShares(
            calendars: [for (final c in body.calendars) CalendarShare(calendarRef: c.calendarRef, displayName: c.displayName, shareTitles: c.shareTitles)]);
      });

  // ---- trips ---------------------------------------------------------------------------------
  @override
  Future<TripList> listTrips() => _run('listTrips', () => TripList.fromJson(_json('listTrips.200')), needsCouple: true);

  @override
  Future<Trip> createTrip(TripInput body) => _run('createTrip', () {
        final trip = _json('createTrip.201')
          ..['traveler'] = body.traveler.wire
          ..['departsAt'] = _iso(body.departsAt)
          ..['arrivesAt'] = _iso(body.arrivesAt)
          ..['fromCity'] = body.fromCity
          ..['toCity'] = body.toCity;
        final eightBefore = body.arrivesAt.subtract(const Duration(hours: 8));
        (trip['liveActivity'] as Map<String, dynamic>)
          ..['eligible'] = _premium
          ..['startsAt'] = _iso(eightBefore.isAfter(body.departsAt) ? eightBefore : body.departsAt)
          ..['endsAt'] = _iso(body.arrivesAt.add(const Duration(hours: 1)));
        return Trip.fromJson(trip);
      }, needsCouple: true);

  @override
  Future<Trip> updateTrip(String tripId, TripPatch body) =>
      _run('updateTrip', () => Trip.fromJson(_json('updateTrip.200')..['id'] = tripId), needsCouple: true);

  @override
  Future<void> deleteTrip(String tripId) => _run('deleteTrip', () {}, needsCouple: true);

  // ---- nudges --------------------------------------------------------------------------------
  /// Enforces the 60 s rate limit like the server.
  @override
  Future<NudgeResult> sendNudge(NudgeRequest body) => _run('sendNudge', () {
        final now = _clock();
        if (_lastNudge != null && now.difference(_lastNudge!) < const Duration(seconds: 60)) {
          final wait = const Duration(seconds: 60) - now.difference(_lastNudge!);
          throw HontoApiException(429, ApiError(error: 'You just sent one.', code: ErrorCode.rateLimited, retryAfterSeconds: wait.inSeconds),
              retryAfter: wait);
        }
        _lastNudge = now;
        final next = now.add(const Duration(seconds: 60));
        (_today['nudges'] as Map<String, dynamic>)
          ..['lastSentAt'] = _iso(now)
          ..['nextAllowedAt'] = _iso(next);
        return NudgeResult(id: 'ndg_${now.millisecondsSinceEpoch}', createdAt: now, nextAllowedAt: next);
      }, needsCouple: true);
}
