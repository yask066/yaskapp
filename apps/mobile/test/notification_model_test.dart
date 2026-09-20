import 'package:flutter_test/flutter_test.dart';

import 'package:yaskapp_mobile/src/features/notifications/notification_model.dart';

Map<String, dynamic> _json({
  String type = 'comment',
  Object? actor = const <String, dynamic>{
    'id': 'user-1',
    'username': 'alice',
    'displayName': 'Alice',
    'avatarUrl': null,
  },
  Object? targetType = 'comment',
  Object? payload = const <String, dynamic>{'preview': 'Hello'},
  Object createdAt = '2026-09-19T12:00:00.000Z',
}) => {
      'id': 'notification-1',
      'type': type,
      'actor': actor,
      'targetType': targetType,
      'pollId': 'poll-1',
      'commentId': 'comment-1',
      'payload': payload,
      'readAt': null,
      'createdAt': createdAt,
      'isTargetAvailable': true,
    };

void main() {
  test('parses the canonical notification contract', () {
    final item = NotificationItem.tryParse(_json())!;

    expect(item.id, 'notification-1');
    expect(item.actor!.id, 'user-1');
    expect(item.targetType, NotificationTargetType.comment);
    expect(item.payload['preview'], 'Hello');
    expect(item.isUnread, isTrue);
  });

  test('ignores unknown types and malformed timestamps safely', () {
    expect(NotificationItem.tryParse(_json(type: 'message')), isNull);
    expect(NotificationItem.tryParse(_json(createdAt: 'not-a-date')), isNull);
  });

  test('requires actor id and target type when parsing', () {
    expect(NotificationItem.tryParse(_json(actor: {
      'username': 'alice',
      'displayName': 'Alice',
    })), isNull);
    expect(NotificationItem.tryParse(_json(targetType: null)), isNull);
    expect(NotificationItem.tryParse(_json(payload: null)), isNull);
  });
}
