class PollAuthorSummary {
  const PollAuthorSummary({
    required this.id,
    required this.username,
    required this.displayName,
    this.avatarObjectKey,
    this.avatarUrl,
  });

  factory PollAuthorSummary.fromJson(Map<String, dynamic> json) {
    return PollAuthorSummary(
      id: json['id'] as String,
      username: json['username'] as String,
      displayName: json['displayName'] as String,
      avatarObjectKey: json['avatarObjectKey'] as String?,
      avatarUrl: json['avatarUrl'] as String?,
    );
  }

  final String id;
  final String username;
  final String displayName;
  final String? avatarObjectKey;
  final String? avatarUrl;
}

class PollOptionSummary {
  const PollOptionSummary({
    required this.id,
    required this.text,
    required this.position,
    required this.votesCount,
  });

  factory PollOptionSummary.fromJson(Map<String, dynamic> json) {
    return PollOptionSummary(
      id: json['id'] as String,
      text: json['text'] as String,
      position: json['position'] as int,
      votesCount: json['votesCount'] as int,
    );
  }

  final String id;
  final String text;
  final int position;
  final int votesCount;
}

class PollCommentSummary {
  const PollCommentSummary({
    required this.id,
    required this.pollId,
    required this.author,
    required this.body,
    required this.likesCount,
    required this.createdAt,
    required this.updatedAt,
  });

  factory PollCommentSummary.fromJson(Map<String, dynamic> json) {
    return PollCommentSummary(
      id: json['id'] as String,
      pollId: json['pollId'] as String,
      author:
          PollAuthorSummary.fromJson(json['author'] as Map<String, dynamic>),
      body: json['body'] as String,
      likesCount: json['likesCount'] as int,
      createdAt: DateTime.parse(json['createdAt'] as String).toLocal(),
      updatedAt: DateTime.parse(json['updatedAt'] as String).toLocal(),
    );
  }

  final String id;
  final String pollId;
  final PollAuthorSummary author;
  final String body;
  final int likesCount;
  final DateTime createdAt;
  final DateTime updatedAt;

  String get createdLabel {
    final elapsed = DateTime.now().difference(createdAt);

    if (elapsed.inMinutes < 1) {
      return 'now';
    }

    if (elapsed.inHours < 1) {
      return '${elapsed.inMinutes} min';
    }

    if (elapsed.inDays < 1) {
      return '${elapsed.inHours} h';
    }

    return '${elapsed.inDays} d';
  }
}

class PollSummary {
  const PollSummary({
    required this.id,
    required this.author,
    required this.question,
    required this.options,
    required this.votesCount,
    required this.commentsCount,
    required this.likesCount,
    required this.viewerHasLiked,
    required this.createdAt,
    this.viewerVoteOptionId,
    this.endsAt,
    this.votedOptionIndex,
  });

  factory PollSummary.fromJson(Map<String, dynamic> json) {
    final optionsJson = json['options'] as List<dynamic>;

    return PollSummary(
      id: json['id'] as String,
      author:
          PollAuthorSummary.fromJson(json['author'] as Map<String, dynamic>),
      question: json['question'] as String,
      options: optionsJson
          .map(
            (optionJson) => PollOptionSummary.fromJson(
              optionJson as Map<String, dynamic>,
            ),
          )
          .toList(),
      votesCount: json['votesCount'] as int,
      commentsCount: json['commentsCount'] as int,
      likesCount: json['likesCount'] as int,
      viewerHasLiked: json['viewerHasLiked'] as bool? ?? false,
      createdAt: DateTime.parse(json['createdAt'] as String).toLocal(),
      viewerVoteOptionId: json['viewerVoteOptionId'] as String?,
      endsAt: (json['endsAt'] as String?) == null
          ? null
          : DateTime.parse(json['endsAt'] as String).toLocal(),
    );
  }

  final String id;
  final PollAuthorSummary author;
  final String question;
  final List<PollOptionSummary> options;
  final int votesCount;
  final int commentsCount;
  final int likesCount;
  final bool viewerHasLiked;
  final DateTime createdAt;
  final String? viewerVoteOptionId;
  final DateTime? endsAt;
  final int? votedOptionIndex;

  bool get isClosed => endsAt != null && !endsAt!.isAfter(DateTime.now());

  int? get selectedOptionIndex {
    final selectedId = viewerVoteOptionId;

    if (selectedId != null) {
      final index = options.indexWhere((option) => option.id == selectedId);

      if (index >= 0) {
        return index;
      }
    }

    return votedOptionIndex;
  }

  String get createdLabel {
    final elapsed = DateTime.now().difference(createdAt);

    if (elapsed.inMinutes < 1) {
      return 'now';
    }

    if (elapsed.inHours < 1) {
      return '${elapsed.inMinutes} min';
    }

    if (elapsed.inDays < 1) {
      return '${elapsed.inHours} h';
    }

    return '${elapsed.inDays} d';
  }
}
