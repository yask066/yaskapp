import 'package:firebase_messaging/firebase_messaging.dart';

@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  // The notification tray is handled by Firebase when the app is backgrounded.
  // Keep this handler intentionally data-only; navigation is handled on app open.
}

class FirebasePushService {
  FirebasePushService({FirebaseMessaging? messaging}) : _messaging = messaging;

  final FirebaseMessaging? _messaging;
  FirebaseMessaging get _instance => _messaging ?? FirebaseMessaging.instance;

  Future<void> initialize() async {
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
    await _instance.setAutoInitEnabled(true);
    await _instance.requestPermission(
      alert: true,
      badge: true,
      sound: true,
      provisional: false,
    );
    await _instance.setForegroundNotificationPresentationOptions(
      alert: true,
      badge: true,
      sound: true,
    );
  }

  Future<String?> getToken() => _instance.getToken();

  Stream<String> get onTokenRefresh => _instance.onTokenRefresh;

  Stream<RemoteMessage> get onMessageOpenedApp =>
      FirebaseMessaging.onMessageOpenedApp;
}
