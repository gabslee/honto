// Pigeon contract between Flutter and the native side of Honto (packages/honto_native).
// Regenerate: cd contracts/pigeon && dart run pigeon --input pigeons/honto_native.dart
// Copy into the app with contracts/dart/tool/sync_to_app.sh.
//
// Data that native code also produces WITHOUT Flutter (widget snapshot written by the NSE / FCM service,
// Live Activity content-state sent by APNs) keeps the JSON shape defined in contracts/openapi.yaml
// (WidgetSnapshot, TripActivityAttributes, TripActivityContentState). Field names below match it.
import 'package:pigeon/pigeon.dart';

@ConfigurePigeon(PigeonOptions(
  dartOut: 'generated/dart/honto_native.g.dart',
  dartPackageName: 'honto_native',
  swiftOut: 'generated/swift/HontoNative.g.swift',
  swiftOptions: SwiftOptions(errorClassName: 'HontoNativeError'),
  kotlinOut: 'generated/kotlin/HontoNative.g.kt',
  kotlinOptions: KotlinOptions(package: 'com.hontogame.honto_native', errorClassName: 'HontoNativeError'),
  copyrightHeader: 'pigeons/copyright.txt',
))

// ===================================================================================================
// 1. Shell: native tab bar, glass buttons and native menus (iOS UIKit over the Flutter view).
//    Android: Material 3 is drawn in Flutter, so the Kotlin side implements these as no-ops.
// ===================================================================================================

enum HontoTab { today, calendar, memories }

class TabBarItem {
  TabBarItem({required this.tab, required this.title, required this.sfSymbol, this.selectedSfSymbol});
  HontoTab tab;
  String title;

  /// SF Symbol name (iOS). Icons are SVG/SF Symbols only, never emoji.
  String sfSymbol;
  String? selectedSfSymbol;
}

class NativeAction {
  NativeAction({required this.id, required this.title, this.destructive = false, this.sfSymbol});
  String id;
  String title;
  bool destructive;
  String? sfSymbol;
}

class NativeActionsRequest {
  NativeActionsRequest({this.title, this.message, required this.actions, required this.cancelTitle, this.style = NativeActionsStyle.sheet});
  String? title;
  String? message;
  List<NativeAction> actions;
  String cancelTitle;
  NativeActionsStyle style;
}

enum NativeActionsStyle { sheet, alert }

@HostApi()
abstract class ShellHostApi {
  void configureTabBar(List<TabBarItem> items, HontoTab selected);
  void selectTab(HontoTab tab);
  void setTabBarHidden(bool hidden, bool animated);

  /// Height (logical px) covered by native chrome at the bottom, so Flutter can pad its content.
  double bottomInset();

  /// Floating glass capture button on Today (UIButton.Configuration.glass() on iOS 26).
  void setCaptureButtonVisible(bool visible);

  /// Glass Settings button at the top.
  void setSettingsButtonVisible(bool visible);

  /// UIMenu / UIAlertController. Returns the chosen action id, or null when cancelled.
  @async
  String? showActions(NativeActionsRequest request);
}

@FlutterApi()
abstract class ShellFlutterApi {
  void onTabSelected(HontoTab tab);
  void onCaptureTap();
  void onSettingsTap();
  void onBottomInsetChanged(double inset);
}

// ===================================================================================================
// 2. Shared session: lets the widget extension (nudge App Intent), the NSE and the Android
//    NudgeReceiver / FirebaseMessagingService call the API without Flutter.
//    iOS: keychain access group 4AW8H42XNA.com.hontogame.shared. Android: EncryptedSharedPreferences.
// ===================================================================================================

class SharedSession {
  SharedSession({required this.token, required this.apiBaseUrl, required this.userId});

  /// `hm_u_…` bearer token.
  String token;

  /// e.g. https://hontogame.com
  String apiBaseUrl;
  String userId;
}

@HostApi()
abstract class SessionHostApi {
  void setSharedSession(SharedSession session);
  void clearSharedSession();

  /// Logout / unpair / delete account: clears the App Group (snapshot + images), ends Live Activities,
  /// removes delivered notifications and the shared session (NativeAccountDataCleaner).
  @async
  void clearAllNativeData();
}

// ===================================================================================================
// 3. Widgets (WidgetKit + App Group group.com.hontogame.app / Android Glance + filesDir/widget/).
// ===================================================================================================

enum HontoWidgetKind { photo, countdown }

class InstalledWidget {
  InstalledWidget({required this.kind, required this.family});
  HontoWidgetKind kind;

  /// iOS: systemSmall | systemMedium | accessoryRectangular | ... ; Android: size class.
  String family;
}

@HostApi()
abstract class WidgetsHostApi {
  /// Atomically writes `snapshot.v1.json` (must validate against contracts/widget-snapshot.v1.json).
  @async
  void writeSnapshot(String snapshotJson);

  /// Stores an image next to the snapshot (e.g. `partner_thumb.jpg`, ≤ 480 px). Returns the file name.
  @async
  String saveImage(String fileName, Uint8List bytes);

  /// Reloads the given widget kinds (empty = all). iOS: WidgetCenter.reloadTimelines(ofKind:).
  void reload(List<HontoWidgetKind> kinds);

  List<InstalledWidget> installedWidgets();

  /// iOS 26 widget push token (WidgetPushHandler), hex. Null below iOS 26 / on Android.
  @async
  String? widgetPushToken();
}

@FlutterApi()
abstract class WidgetsFlutterApi {
  /// iOS 26: WidgetPushHandler.pushTokenDidChange -> register with POST /api/v1/devices (kind apns_widget).
  void onWidgetPushToken(String tokenHex);

  /// A "Thinking of you" was sent from the widget while the app was alive (refresh Today state).
  void onNudgeSentFromWidget(int sentAtEpochMs);
}

// ===================================================================================================
// 4. Trip activity: iOS Live Activity + Dynamic Island (ActivityKit, push-to-start iOS 17.2+);
//    Android Live Update (ProgressStyle, API 36.1 promoted) or ongoing notification with chronometer.
//    The server normally starts/updates/ends it by push; these calls are the local path + fallback.
// ===================================================================================================

enum TripActivityPhase { before, inTransit, landed }

/// Same keys as TripActivityAttributes in openapi.yaml (Swift Codable `TripActivityAttributes`).
class TripActivityAttributesMessage {
  TripActivityAttributesMessage({required this.tripId, required this.travelerName, required this.waiterName, this.fromCity, this.toCity});
  String tripId;
  String travelerName;
  String waiterName;
  String? fromCity;
  String? toCity;
}

/// Same keys as TripActivityContentState in openapi.yaml. Epoch seconds, not dates.
class TripActivityStateMessage {
  TripActivityStateMessage({required this.phase, required this.departsAtEpoch, required this.arrivesAtEpoch, required this.partnerName});
  TripActivityPhase phase;
  int departsAtEpoch;
  int arrivesAtEpoch;
  String partnerName;
}

class TripActivityCapabilities {
  TripActivityCapabilities({required this.supported, required this.enabled, required this.pushToStart, required this.promotedNotifications});

  /// iOS: always (app minimum is iOS 17). Android: 8+ (minSdk 26).
  bool supported;

  /// iOS: ActivityAuthorizationInfo.areActivitiesEnabled. Android: notifications allowed.
  bool enabled;

  /// iOS 17.2+ (17.0/17.1 fall back to a local start when the app is opened).
  bool pushToStart;

  /// Android 16 QPR1+: NotificationManager.canPostPromotedNotifications().
  bool promotedNotifications;
}

enum TripActivityStatus { active, stale, ended, dismissed }

class TripActivityInfo {
  TripActivityInfo({required this.activityId, required this.tripId, required this.status});
  String activityId;
  String tripId;
  TripActivityStatus status;
}

@HostApi()
abstract class TripActivityHostApi {
  TripActivityCapabilities capabilities();

  /// Starts locally (app open on trip day, or push-to-start failed). Returns the activity id.
  @async
  String start(TripActivityAttributesMessage attributes, TripActivityStateMessage state, int? staleAtEpoch);

  @async
  void update(String activityId, TripActivityStateMessage state);

  @async
  void end(String activityId, TripActivityStateMessage? finalState, bool dismissImmediately);

  @async
  void endAll();

  List<TripActivityInfo> activities();

  /// Starts emitting push-to-start and per-activity update tokens through TripActivityFlutterApi.
  void observePushTokens();

  /// iOS: local notification "Trip starts today". Android: AlarmManager (inexact) that starts the ongoing notification.
  void scheduleLocalFallback(TripActivityAttributesMessage attributes, TripActivityStateMessage state, int startAtEpoch);
  void cancelLocalFallback(String tripId);
}

@FlutterApi()
abstract class TripActivityFlutterApi {
  /// -> POST /api/v1/live-activity/tokens { kind: push_to_start }
  void onPushToStartToken(String tokenHex);

  /// -> POST /api/v1/live-activity/tokens { kind: update, activityId, tripId }
  void onUpdateToken(String activityId, String tripId, String tokenHex);
  void onActivityStatusChanged(TripActivityInfo info);
}

// ===================================================================================================
// 5. Calendar (EventKit full access on iOS 17+, CalendarContract.Instances on Android).
//    Titles only cross into Dart for calendars the user opted in (titleCalendarIds).
// ===================================================================================================

enum CalendarAuthorization { notDetermined, denied, restricted, fullAccess, writeOnly }

enum EventAvailability { busy, free, tentative, unavailable, notSupported }

class CalendarInfo {
  CalendarInfo({required this.id, required this.ref, required this.title, this.accountName, this.colorHex, required this.isPrimary});

  /// Local identifier (EKCalendar.calendarIdentifier / Calendars._ID). Never sent to the server.
  String id;

  /// Opaque hash sent to the API as `calendarRef`: hex(SHA-256(installationId + ":" + id))[0..16].
  String ref;
  String title;
  String? accountName;
  String? colorHex;
  bool isPrimary;
}

class CalendarEventMessage {
  CalendarEventMessage({
    required this.calendarId,
    required this.calendarRef,
    required this.startEpochMs,
    required this.endEpochMs,
    required this.allDay,
    required this.availability,
    required this.isPrivate,
    this.title,
  });
  String calendarId;
  String calendarRef;
  int startEpochMs;
  int endEpochMs;

  /// All-day events never count as busy; Dart drops them before upload.
  bool allDay;
  EventAvailability availability;

  /// Android ACCESS_LEVEL_PRIVATE / iOS private event: title never shared.
  bool isPrivate;

  /// Only filled for calendars listed in `titleCalendarIds` and when not private. Max 80 chars.
  String? title;
}

@HostApi()
abstract class CalendarHostApi {
  CalendarAuthorization authorizationStatus();

  /// iOS 17: EKEventStore.requestFullAccessToEvents. Android: READ_CALENDAR.
  @async
  CalendarAuthorization requestFullAccess();

  @async
  List<CalendarInfo> calendars();

  /// Expanded instances (recurrences included) in [fromEpochMs, toEpochMs), all calendars unless filtered.
  @async
  List<CalendarEventMessage> events(int fromEpochMs, int toEpochMs, List<String>? calendarIds, List<String> titleCalendarIds);

  void openSystemSettings();
}
