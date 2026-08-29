import 'package:flutter_test/flutter_test.dart';

import 'package:yaskapp_mobile/src/features/notifications/notifications_api_client.dart';

void main() {
  test('notification summary exposes readable details for the notification tab', () {
    final item = NotificationSummary.fromJson({
      'id': 'notification-1',
      'type': 'comment',
      'actor': {
        'username': 'alice',
        'displayName': 'Alice',
        'avatarUrl': null,
      },
      'pollId': 'poll-1',
      'commentId': 'comment-1',
      'readAt': null,
      'createdAt': '2026-08-29T10:00:00.000Z',
      'isTargetAvailable': true,
    });

    expect(item.title, 'Alice commented on your poll');
    expect(item.detail, 'Open the comment to view the discussion');
    expect(item.targetLabel, 'Poll and comment');
    expect(item.isUnread, isTrue);
  });
}
