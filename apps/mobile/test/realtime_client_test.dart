import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/features/realtime/realtime_client.dart';

void main() {
  test('decodes versioned notification read events', () {
    final event = decodeNotificationReadRealtimeEvent({
      'version': 1,
      'type': 'notification.read',
      'payload': {
        'notificationId': 'notification-1',
        'readAt': '2026-09-19T12:30:00.000Z',
        'unreadCount': 2,
      },
    });

    expect(event?.notificationId, 'notification-1');
    expect(event?.readAt, DateTime.parse('2026-09-19T12:30:00.000Z'));
    expect(event?.unreadCount, 2);
    expect(
      decodeNotificationReadRealtimeEvent({
        'version': 2,
        'type': 'notification.read',
        'payload': {
          'notificationId': 'notification-1',
          'readAt': '2026-09-19T12:30:00.000Z',
          'unreadCount': 2,
        },
      }),
      isNull,
    );
  });

  test('decodes versioned notifications read-all events', () {
    final event = decodeNotificationsReadAllRealtimeEvent({
      'version': 1,
      'type': 'notifications.read_all',
      'payload': {
        'readAt': '2026-09-19T12:30:00.000Z',
        'unreadCount': 0,
      },
    });

    expect(event?.readAt, DateTime.parse('2026-09-19T12:30:00.000Z'));
    expect(event?.unreadCount, 0);
    expect(
      decodeNotificationsReadAllRealtimeEvent({
        'version': 1,
        'type': 'notifications.read_all',
        'payload': {'readAt': 'invalid', 'unreadCount': 0},
      }),
      isNull,
    );
  });
}
