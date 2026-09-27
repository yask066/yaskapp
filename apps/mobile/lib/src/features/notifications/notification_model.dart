enum NotificationType { pollVote, comment, commentReply, like, follow }

extension NotificationTypeWire on NotificationType {
  String get wireName => switch (this) {
        NotificationType.pollVote => 'poll_vote',
        NotificationType.comment => 'comment',
        NotificationType.commentReply => 'comment_reply',
        NotificationType.like => 'like',
        NotificationType.follow => 'follow',
      };

  static NotificationType? fromWire(Object? value) => switch (value) {
        'poll_vote' => NotificationType.pollVote,
        'comment' => NotificationType.comment,
        'comment_reply' => NotificationType.commentReply,
        'like' => NotificationType.like,
        'follow' => NotificationType.follow,
        _ => null,
      };
}

enum NotificationTargetType { poll, comment, profile }

extension NotificationTargetTypeWire on NotificationTargetType {
  String get wireName => name;

  static NotificationTargetType? fromWire(Object? value) => switch (value) {
        'poll' => NotificationTargetType.poll,
        'comment' => NotificationTargetType.comment,
        'profile' => NotificationTargetType.profile,
        _ => null,
      };
}

class NotificationActor {
  const NotificationActor({
    required this.id,
    required this.username,
    required this.displayName,
    this.avatarUrl,
  });

  final String id;
  final String username;
  final String displayName;
  final String? avatarUrl;
}

class NotificationTarget {
  const NotificationTarget({
    required this.type,
    this.pollId,
    this.commentId,
  });

  final NotificationTargetType type;
  final String? pollId;
  final String? commentId;
}

class NotificationItem {
  const NotificationItem({
    required this.id,
    required this.type,
    required this.actor,
    required this.target,
    required this.payload,
    required this.readAt,
    required this.createdAt,
    required this.isTargetAvailable,
  });

  final String id;
  final NotificationType type;
  final NotificationActor? actor;
  final NotificationTarget target;
  final Map<String, dynamic> payload;
  final DateTime? readAt;
  final DateTime createdAt;
  final bool isTargetAvailable;

  NotificationTargetType get targetType => target.type;
  String? get pollId => target.pollId;
  String? get commentId => target.commentId;
  bool get isUnread => readAt == null;

  Map<String, dynamic> toJson() => {
        'id': id,
        'type': type.wireName,
        'actor': actor == null
            ? null
            : {
                'id': actor!.id,
                'username': actor!.username,
                'displayName': actor!.displayName,
                'avatarUrl': actor!.avatarUrl,
              },
        'targetType': target.type.wireName,
        'pollId': pollId,
        'commentId': commentId,
        'payload': payload,
        'readAt': readAt?.toUtc().toIso8601String(),
        'createdAt': createdAt.toUtc().toIso8601String(),
        'isTargetAvailable': isTargetAvailable,
      };

  static NotificationItem? tryParse(Map<String, dynamic> json) {
    try {
      final id = json['id'];
      final type = NotificationTypeWire.fromWire(json['type']);
      final targetType = NotificationTargetTypeWire.fromWire(json['targetType']);
      final createdAt = DateTime.tryParse(json['createdAt'] as String? ?? '');
      final payload = json['payload'];
      if (id is! String || type == null || targetType == null ||
          createdAt == null || payload is! Map) {
        return null;
      }

      final actorJson = json['actor'];
      NotificationActor? actor;
      if (actorJson != null) {
        if (actorJson is! Map || actorJson['id'] is! String ||
            actorJson['username'] is! String || actorJson['displayName'] is! String) {
          return null;
        }
        actor = NotificationActor(
          id: actorJson['id'] as String,
          username: actorJson['username'] as String,
          displayName: actorJson['displayName'] as String,
          avatarUrl: actorJson['avatarUrl'] as String?,
        );
      }

      final readAtJson = json['readAt'];
      final readAt = readAtJson == null
          ? null
          : DateTime.tryParse(readAtJson as String);
      if (readAtJson != null && readAt == null) return null;

      return NotificationItem(
        id: id,
        type: type,
        actor: actor,
        target: NotificationTarget(
          type: targetType,
          pollId: json['pollId'] as String?,
          commentId: json['commentId'] as String?,
        ),
        payload: Map<String, dynamic>.from(payload),
        readAt: readAt,
        createdAt: createdAt,
        isTargetAvailable: json['isTargetAvailable'] as bool? ?? true,
      );
    } on Object {
      return null;
    }
  }

  NotificationItem copyWith({
    DateTime? readAt,
    bool clearReadAt = false,
    bool? isTargetAvailable,
  }) => NotificationItem(
        id: id,
        type: type,
        actor: actor,
        target: target,
        payload: payload,
        readAt: clearReadAt ? null : (readAt ?? this.readAt),
        createdAt: createdAt,
        isTargetAvailable: isTargetAvailable ?? this.isTargetAvailable,
      );

  String get title {
    final actorName = actor?.displayName ?? 'Someone';
    return switch (type) {
      NotificationType.pollVote => '$actorName voted in your poll',
      NotificationType.comment => '$actorName commented on your poll',
      NotificationType.commentReply => '$actorName replied to your comment',
      NotificationType.follow => '$actorName started following you',
      NotificationType.like => '$actorName liked your poll',
    };
  }

  String get detail => switch (type) {
        NotificationType.pollVote => 'Open the poll to view the updated results',
        NotificationType.comment => 'Open the comment to view the discussion',
        NotificationType.commentReply => 'Open the discussion to view the reply',
        NotificationType.follow => 'View this profile to see more details',
        NotificationType.like => 'Open the poll to view its activity',
      };

  String get targetLabel {
    if (!isTargetAvailable) return 'Content unavailable';
    if (commentId != null) return 'Poll and comment';
    if (pollId != null) return 'Poll';
    return 'Profile';
  }
}
