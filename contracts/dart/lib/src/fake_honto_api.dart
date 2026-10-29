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
  pairedRenewing,
  pairedPartnerPremium,

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
    _paired = ![FakeScenario.unpaired, FakeScenario.pendingUnpair].contains(scenario);
    _premium = [FakeScenario.pairedPremium, FakeScenario.pairedRenewing, FakeScenario.pairedPartnerPremium].contains(scenario);
    _today = _json(_premium ? 'getToday.200' : 'getToday.200.free_no_photos');
    final seen = (_json('listMilestones.200')['milestones'] as List<dynamic>).cast<Map<String, dynamic>>();
    final unseen = ((_today['unseenMilestones'] as List<dynamic>?) ?? const []).cast<Map<String, dynamic>>();
    // Premium: first photo + 7-day streak, both seen. Free: first photo seen, 7-day streak not seen yet.
    _milestones.addAll(_premium ? seen : [seen.first, ...unseen]);
  }

  // App compatibility adapter for the account migration UI and its fault injection.
  final linkedProviders = <LinkProvider>[];

  Future<void> linkProvider(LinkProvider provider, String idToken) =>
      _run('linkProvider', () { linkedProviders.add(provider); });

  final FakeScenario scenario;
  final Duration latency;
  final DateTime Function() _clock;
  final Map<String, HontoApiException> _failures = {};
  late bool _paired;
  late bool _premium;
  late Map<String, dynamic> _today;
  ProfileCity? _city;
  DateTime? _lastNudge;
  final Map<String, Map<String, dynamic>> _pendingPhotos = {};
  final List<Map<String, dynamic>> _milestones = [];

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

  List<Map<String, dynamic>> get _unseen => [for (final m in _milestones) if (m['seenAt'] == null) m];

  /// Records a milestone (unseen) like the server would, e.g. to preview the CelebrationSheet from a debug
  /// menu. Same `type` + `value` twice is a no-op (milestones are recorded once per couple).
  Milestone simulateMilestone(MilestoneType type, {int? value, String? localDay, bool preview = false}) {
    final existing = _milestones.where((m) => m['type'] == type.wire && m['value'] == value);
    if (existing.isNotEmpty) {
      // App-only gallery preview: seeded milestones can be made unseen explicitly.
      if (preview) existing.first['seenAt'] = null;
      return Milestone.fromJson(existing.first);
    }
    final now = _clock();
    final json = <String, dynamic>{
      'id': 'ms_fake_${type.wire}_${value ?? 0}',
      'type': type.wire,
      'value': value,
      'localDay': localDay ?? (_today['me'] as Map<String, dynamic>)['localDay'],
      'achievedAt': _iso(now),
      'seenAt': null,
    };
    _milestones.add(json);
    return Milestone.fromJson(json);
  }

  Map<String, dynamic> _meJson() {
    final me = _json(switch (scenario) {
      FakeScenario.pendingUnpair => 'getMe.200.pending_unpair',
      _ => 'getMe.200',
    });
    me['couple'] = _paired ? _coupleJson() : null;
    if (scenario == FakeScenario.pairedRenewing || scenario == FakeScenario.pairedPartnerPremium) {
      (me['entitlement'] as Map<String, dynamic>)
        ..['periodType'] = 'normal'
        ..['grantedBy'] = scenario == FakeScenario.pairedPartnerPremium ? 'partner' : 'me';
    }
    (me['user'] as Map<String, dynamic>)
      ..['displayName'] = _displayName ?? (me['user'] as Map<String, dynamic>)['displayName']
      ..['avatar'] = _avatar?.toJson()
      ..['city'] = _city?.toJson();
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
  Future<ProviderLinkResult> linkProviderIdentity(String provider, ProviderLinkRequest body) => _run('linkProviderIdentity', () {
        // Any token containing "taken" simulates an identity that belongs to another account.
        if (body.idToken.contains('taken')) {
          throw HontoApiException(409, ApiError.fromJson(_json('linkProviderIdentity.409')));
        }
        return ProviderLinkResult.fromJson(_json('linkProviderIdentity.201')..['provider'] = provider);
      });

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
  Future<AuthSession> refreshSession(RefreshRequest body) => _run('refreshSession', () {
        // Any token containing "reused" simulates a revoked or reused refresh token.
        if (body.refreshToken.contains('reused')) {
          throw HontoApiException(401, ApiError.fromJson(_json('refreshSession.401')));
        }
        return AuthSession.fromJson(_json('refreshSession.200'));
      });

  @override
  Future<LogoutResponse> logout() => _run('logout', () => LogoutResponse.fromJson(_json('logout.200')));

  // ---- me ------------------------------------------------------------------------------------
  @override
  Future<Me> getMe() => _run('getMe', () => Me.fromJson(_meJson()));

  String? _displayName;
  Avatar? _avatar;
  final _avatarUploads = <String, Avatar>{};
  final _avatarReservations = <DateTime>[];

  @override
  Future<User> updateProfile(ProfilePatch body) => _run('updateProfile', () {
    final name = body.displayName.trim().replaceAll(RegExp(r'\s+'), ' ');
    if (name.isEmpty || name.runes.length > 80) {
      throw HontoApiException(400, const ApiError(error: 'Use 1–80 characters.', code: ErrorCode.badRequest));
    }
    _displayName = name;
    return User.fromJson(_meJson()['user'] as Map<String, dynamic>);
  });

  @override
  Future<AvatarUploadResponse> createAvatarUpload(AvatarUploadRequest body) => _run('createAvatarUpload', () {
    if (body.bytes < 1 || body.bytes > 1048576 || body.thumbBytes < 1 || body.thumbBytes > 131072 ||
        body.width < 1 || body.width > 2048 || body.height < 1 || body.height > 2048) {
      throw HontoApiException(400, const ApiError(error: 'Photo exceeds limits.', code: ErrorCode.badRequest));
    }
    _avatarReservations.removeWhere((at) => _clock().difference(at) >= const Duration(hours: 1));
    if (_avatarReservations.length >= 20) {
      throw HontoApiException(429, const ApiError(error: 'Try again later.', code: ErrorCode.rateLimited));
    }
    _avatarReservations.add(_clock());
    final id = 'av_fake_${_avatarReservations.length}_${_clock().microsecondsSinceEpoch}';
    final result = AvatarUploadResponse.fromJson(_json('createAvatarUpload.201')..['avatarId'] = id);
    _avatarUploads[id] = Avatar.fromJson(_json('completeAvatar.200')..['id'] = id);
    return result;
  });

  @override
  Future<Avatar> completeAvatar(AvatarCompleteRequest body) => _run('completeAvatar', () {
    final avatar = _avatarUploads[body.avatarId];
    if (avatar == null) {
      throw HontoApiException(404, const ApiError(error: 'Photo not found.', code: ErrorCode.notFound));
    }
    _avatar = avatar;
    (_today['me'] as Map<String, dynamic>)['avatar'] = avatar.toJson();
    return avatar;
  });

  @override
  Future<void> deleteAvatar() => _run('deleteAvatar', () {
    _avatar = null;
    (_today['me'] as Map<String, dynamic>)['avatar'] = null;
  });

  @override
  Future<void> deleteMe() => _run('deleteMe', () {
        _paired = false;
      });

  @override
  Future<TimeZoneResult> updateTimeZone(TimeZoneUpdate body) =>
      _run('updateTimeZone', () => TimeZoneResult(timeZone: body.timeZone, updatedAt: _clock()));

  /// Last weather reported through [reportWeather] (null after [clearWeather]).
  WeatherSummary? reportedWeather;

  @override
  Future<WeatherSummary> reportWeather(WeatherSummary body) => _run('reportWeather', () => reportedWeather = body);

  @override
  Future<void> clearWeather() => _run('clearWeather', () {
        reportedWeather = null;
      });

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
        // The chat is shared history: removed at unpair, like the server.
        _chat.clear();
        _chatReadId = null;
        final now = _clock();
        return UnpairResult(unpairedAt: now, photosAvailableUntil: now.add(const Duration(days: 30)));
      }, needsCouple: true);

  // ---- today / photos / memories -------------------------------------------------------------
  @override
  Future<Today> getToday() => _run('getToday', () => Today.fromJson({..._today, 'unseenMilestones': _unseen}), needsCouple: true);

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
        if (me['dailyPhoto'] == null) {
          me['dailyPhoto'] = photo;
          _markMeDoneToday(me['localDay'] as String);
        }
        me['photoCount'] = (me['photoCount'] as int) + 1;
        return Photo.fromJson(photo);
      }, needsCouple: true);

  /// My first photo of the day: updates the streak like the server (complete when both posted).
  void _markMeDoneToday(String day) {
    final streak = _today['streak'] as Map<String, dynamic>?;
    if (streak == null || streak['meDoneToday'] == true) return;
    streak['meDoneToday'] = true;
    if (streak['partnerDoneToday'] != true) return;
    streak['todayComplete'] = true;
    final current = (streak['current'] as int) + 1;
    streak
      ..['current'] = current
      ..['best'] = current > (streak['best'] as int) ? current : streak['best']
      ..['lastCompleteDay'] = day;
    if (const [7, 30, 100].contains(current)) simulateMilestone(MilestoneType.streak, value: current, localDay: day);
  }

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

  // ---- milestones ----------------------------------------------------------------------------
  @override
  Future<MilestoneList> listMilestones({String? unseen}) => _run('listMilestones', () {
        final list = unseen == 'true' ? _unseen : _milestones;
        final sorted = [...list]..sort((a, b) => (a['localDay'] as String).compareTo(b['localDay'] as String));
        return MilestoneList.fromJson({'milestones': sorted});
      }, needsCouple: true);

  /// Idempotent: the first `seenAt` is kept.
  @override
  Future<Milestone> markMilestoneSeen(String milestoneId) => _run('markMilestoneSeen', () {
        final match = _milestones.where((m) => m['id'] == milestoneId);
        if (match.isEmpty) throw HontoApiException(404, ApiError.fromJson(_json('markMilestoneSeen.404')));
        final milestone = match.first;
        milestone['seenAt'] ??= _iso(_clock());
        return Milestone.fromJson(milestone);
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
  @override
  Future<ProfileCity> updateProfileCity(ProfileCity body) =>
      _run('updateProfileCity', () => _city = body);
  @override
  Future<void> deleteProfileCity() => _run('deleteProfileCity', () {
    _city = null;
  });
  final _media = <String, PrivateMediaItem>{};
  final _mediaRequests = <String, PrivateMediaUploadRequest>{};
  void _requirePrivatePremium() {
    if (!_premium) {
      throw _premiumRequired('Premium is required.', statusCode: 402);
    }
  }

  @override
  Future<PrivateMediaFeed> getPrivateMedia() => _run('getPrivateMedia', () {
    _requirePrivatePremium();
    final videos = _media.values
        .where((m) => m.kind == PrivateMediaKind.dailyVideo)
        .toList();
    return PrivateMediaFeed(
      meVideo: videos.isEmpty ? null : videos.last,
      partnerVideo: null,
      inbox: const [],
    );
  }, needsCouple: true);
  @override
  Future<PrivateMediaUpload> createPrivateMediaUpload(
    PrivateMediaUploadRequest body,
  ) => _run('createPrivateMediaUpload', () {
    _requirePrivatePremium();
    _mediaRequests[body.clientId] = body;
    return PrivateMediaUpload.fromJson(
      _json('createPrivateMediaUpload.201')..['id'] = body.clientId,
    );
  }, needsCouple: true);
  @override
  Future<PrivateMediaItem> completePrivateMedia(String mediaId) =>
      _run('completePrivateMedia', () {
        _requirePrivatePremium();
        final request = _mediaRequests[mediaId]!;
        final now = _clock();
        final item = PrivateMediaItem(
          id: mediaId,
          kind: request.kind,
          author: PhotoAuthor.me,
          localDay: now.toIso8601String().substring(0, 10),
          createdAt: now,
          expiresAt: request.kind == PrivateMediaKind.viewOnce
              ? now.add(const Duration(hours: 24))
              : null,
          durationMs: request.durationMs,
        );
        if (item.kind == PrivateMediaKind.dailyVideo) {
          _media.removeWhere(
            (_, old) => old.kind == item.kind && old.localDay == item.localDay,
          );
        }
        _media[mediaId] = item;
        // Like the server: a ready disappearing photo becomes a view_once chat message (once per media id).
        if (item.kind == PrivateMediaKind.viewOnce && !_chat.any((m) => m['clientId'] == mediaId)) {
          _chat.insert(0, _chatMessage(
            id: 'msg_fake_${_chat.length + 1}_${now.microsecondsSinceEpoch}',
            clientId: mediaId,
            mine: true,
            kind: ChatMessageKind.viewOnce,
            body: null,
            createdAt: now,
          )..['viewOnce'] = {'mediaId': mediaId, 'status': 'unopened', 'expiresAt': _iso(item.expiresAt!), 'isRecipient': false});
        }
        return item;
      }, needsCouple: true);
  @override
  Future<PrivateMediaPlayback> getPrivateMediaPlayback(String mediaId) =>
      _run('getPrivateMediaPlayback', () {
        _requirePrivatePremium();
        return PrivateMediaPlayback.fromJson(
          _json('getPrivateMediaPlayback.200'),
        );
      }, needsCouple: true);
  @override
  Future<PrivatePhotoOpened> openPrivatePhoto(String mediaId) =>
      _run('openPrivatePhoto', () {
        _requirePrivatePremium();
        // A partner's unopened disappearing photo in the chat opens once; the message stays as a tombstone.
        _expireChatViewOnce();
        for (final m in _chat) {
          final ref = m['viewOnce'] as Map<String, dynamic>?;
          if (ref == null || ref['mediaId'] != mediaId || ref['isRecipient'] != true || ref['status'] != 'unopened') continue;
          ref
            ..['status'] = 'opened'
            ..['mediaId'] = null;
          return PrivatePhotoOpened.fromJson(_json('openPrivatePhoto.200'));
        }
        throw HontoApiException(
          410,
          ApiError(
            error: 'This photo is no longer available.',
            code: ErrorCode.mediaUnavailable,
          ),
        );
      }, needsCouple: true);

  // ---- chat ----------------------------------------------------------------------------------
  // In-memory couple chat, newest first. Seeded from listChatMessages.200 (text, photo comment, video comment,
  // and an unopened disappearing photo from Kenji), re-dated to just before the clock so it reads as "today".
  static const _meUserId = 'usr_ana';
  static const _partnerUserId = 'usr_kenji';
  static const _partnerVideoId = 'pm_kenji_video';
  static final _uuid = RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', caseSensitive: false);
  late final List<Map<String, dynamic>> _chat = _seedChat();
  String? _chatReadId;

  List<Map<String, dynamic>> _seedChat() {
    final seed = (_json('listChatMessages.200')['messages'] as List<dynamic>).cast<Map<String, dynamic>>();
    final latest = DateTime.parse(seed.first['createdAt'] as String);
    final shift = _clock().toUtc().subtract(const Duration(minutes: 2)).difference(latest);
    String moved(Object? iso) => _iso(DateTime.parse(iso as String).add(shift));
    for (final m in seed) {
      m['createdAt'] = moved(m['createdAt']);
      for (final key in ['photo', 'viewOnce']) {
        final ref = m[key] as Map<String, dynamic>?;
        if (ref != null && ref['expiresAt'] != null) ref['expiresAt'] = moved(ref['expiresAt']);
      }
    }
    _chatReadId = (_json('getChatSummary.200')['lastReadMessageId'] as String?);
    return seed;
  }

  Map<String, dynamic> _chatMessage({
    required String id,
    required String clientId,
    required bool mine,
    required ChatMessageKind kind,
    required String? body,
    required DateTime createdAt,
  }) =>
      {
        'id': id,
        'clientId': clientId,
        'author': mine ? 'me' : 'partner',
        'authorUserId': mine ? _meUserId : _partnerUserId,
        'kind': kind.wire,
        'body': body,
        'createdAt': _iso(createdAt),
        'photo': null,
        'video': null,
        'viewOnce': null,
      };

  /// Unopened disappearing photos past their 24 h become "expired" tombstones (no media id).
  void _expireChatViewOnce() {
    final now = _clock();
    for (final m in _chat) {
      final ref = m['viewOnce'] as Map<String, dynamic>?;
      if (ref == null || ref['status'] != 'unopened' || ref['expiresAt'] == null) continue;
      if (!DateTime.parse(ref['expiresAt'] as String).isAfter(now)) {
        ref
          ..['status'] = 'expired'
          ..['mediaId'] = null;
      }
    }
  }

  HontoApiException _chatBadRequest(String message) =>
      HontoApiException(400, ApiError(error: message, code: ErrorCode.badRequest));

  ChatSummary _chatSummary() {
    _expireChatViewOnce();
    final readIndex = _chatReadId == null ? _chat.length : _chat.indexWhere((m) => m['id'] == _chatReadId);
    final newer = _chat.take(readIndex < 0 ? _chat.length : readIndex);
    return ChatSummary(
      unreadCount: newer.where((m) => m['author'] == 'partner').length,
      lastReadMessageId: _chatReadId,
      latest: _chat.isEmpty ? null : ChatMessage.fromJson(_chat.first),
    );
  }

  @override
  Future<ChatMessagePage> listChatMessages({String? before, String? limit}) => _run('listChatMessages', () {
        final size = limit == null ? 30 : int.tryParse(limit);
        if (size == null || size < 1 || size > 100) throw _chatBadRequest('limit must be between 1 and 100.');
        _expireChatViewOnce();
        var start = 0;
        if (before != null && before.isNotEmpty) {
          final index = _chat.indexWhere((m) => m['id'] == before);
          if (index < 0) throw _chatBadRequest('Unknown before cursor.');
          start = index + 1;
        }
        final page = _chat.skip(start).take(size).toList();
        final more = start + page.length < _chat.length;
        return ChatMessagePage(
          messages: [for (final m in page) ChatMessage.fromJson(m)],
          nextBefore: more && page.isNotEmpty ? page.last['id'] as String : null,
        );
      }, needsCouple: true);

  /// Free. Comments only on the partner's photo of the day (`ph_kenji_...`) or daily video (`pm_kenji_video`).
  @override
  Future<ChatMessage> sendChatMessage(ChatMessageRequest body) => _run('sendChatMessage', () {
        if (!_uuid.hasMatch(body.clientId)) throw _chatBadRequest('clientId must be a UUID.');
        final text = body.body.trim();
        if (text.isEmpty || text.runes.length > 2000) throw _chatBadRequest('Write 1 to 2000 characters.');
        if (body.photoId != null && body.privateMediaId != null) throw _chatBadRequest('Comment on a photo or a video, not both.');
        final clientId = body.clientId.toLowerCase();
        final existing = _chat.where((m) => m['author'] == 'me' && m['clientId'] == clientId);
        if (existing.isNotEmpty) return ChatMessage.fromJson(existing.first);
        final photoRef = body.photoId == null ? null : _partnerPhotoRef(body.photoId!);
        if (body.photoId != null && photoRef == null) {
          throw HontoApiException(422, const ApiError(error: "You can comment on your partner's photos only.", code: ErrorCode.mediaUnavailable));
        }
        if (body.privateMediaId != null && body.privateMediaId != _partnerVideoId) {
          throw HontoApiException(422, const ApiError(error: "You can comment on your partner's videos only.", code: ErrorCode.mediaUnavailable));
        }
        final now = _clock();
        final kind = body.photoId != null
            ? ChatMessageKind.photoComment
            : body.privateMediaId != null
                ? ChatMessageKind.videoComment
                : ChatMessageKind.text;
        final message = _chatMessage(
            id: 'msg_fake_${_chat.length + 1}_${now.microsecondsSinceEpoch}', clientId: clientId, mine: true, kind: kind, body: text, createdAt: now);
        if (kind == ChatMessageKind.photoComment) {
          message['photo'] = photoRef;
        }
        if (kind == ChatMessageKind.videoComment) {
          message['video'] = {'mediaId': body.privateMediaId, 'available': true, 'posterUrl': null};
        }
        _chat.insert(0, message);
        return ChatMessage.fromJson(message);
      }, needsCouple: true);

  /// Photo reference for a comment on the partner's photo (Today's daily/latest photo, or one already in the chat).
  Map<String, dynamic>? _partnerPhotoRef(String photoId) {
    final partner = _today['partner'] as Map<String, dynamic>;
    for (final key in ['dailyPhoto', 'latestPhoto']) {
      final photo = partner[key] as Map<String, dynamic>?;
      if (photo?['id'] != photoId) continue;
      final urls = photo!['urls'] as Map<String, dynamic>?;
      return {'photoId': photoId, 'available': true, 'thumbUrl': urls?['thumb'], 'expiresAt': urls?['expiresAt']};
    }
    for (final m in _chat) {
      final ref = m['photo'] as Map<String, dynamic>?;
      if (ref != null && ref['photoId'] == photoId && m['author'] == 'me') return Map<String, dynamic>.of(ref);
    }
    return null;
  }

  /// Moves the read marker forward only.
  @override
  Future<ChatSummary> markChatRead(ChatReadRequest body) => _run('markChatRead', () {
        final index = _chat.indexWhere((m) => m['id'] == body.messageId);
        if (index < 0) throw HontoApiException(404, const ApiError(error: 'Message not found.', code: ErrorCode.notFound));
        final current = _chatReadId == null ? -1 : _chat.indexWhere((m) => m['id'] == _chatReadId);
        if (current < 0 || index < current) _chatReadId = body.messageId;
        return _chatSummary();
      }, needsCouple: true);

  @override
  Future<ChatSummary> getChatSummary() => _run('getChatSummary', _chatSummary, needsCouple: true);
}
