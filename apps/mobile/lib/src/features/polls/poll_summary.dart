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
    this.viewerHasLiked = false,
    this.parentCommentId,
    this.repliesCount = 0,
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
      viewerHasLiked: json['viewerHasLiked'] as bool? ?? false,
      parentCommentId: json['parentCommentId'] as String?,
      repliesCount: json['repliesCount'] as int? ?? 0,
      createdAt: DateTime.parse(json['createdAt'] as String).toLocal(),
      updatedAt: DateTime.parse(json['updatedAt'] as String).toLocal(),
    );
  }

  final String id;
  final String pollId;
  final PollAuthorSummary author;
  final String body;
  final int likesCount;
  final bool viewerHasLiked;
  final String? parentCommentId;
  final int repliesCount;
  final DateTime createdAt;
  final DateTime updatedAt;

  PollCommentSummary copyWith({
    int? likesCount,
    bool? viewerHasLiked,
    int? repliesCount,
  }) {
    return PollCommentSummary(
      id: id,
      pollId: pollId,
      author: author,
      body: body,
      likesCount: likesCount ?? this.likesCount,
      viewerHasLiked: viewerHasLiked ?? this.viewerHasLiked,
      parentCommentId: parentCommentId,
      repliesCount: repliesCount ?? this.repliesCount,
      createdAt: createdAt,
      updatedAt: updatedAt,
    );
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

class PollCommentRepliesPage {
  const PollCommentRepliesPage({
    required this.items,
    required this.nextCursor,
  });

  final List<PollCommentSummary> items;
  final String? nextCursor;
}

class PollSummary {
  const PollSummary({
    required this.id,
    required this.author,
    required this.question,
    this.imageUrl,
    required this.options,
    required this.votesCount,
    required this.commentsCount,
    required this.likesCount,
    required this.viewerHasLiked,
    this.allowVoteCancellation = false,
    required this.createdAt,
    this.viewerVoteOptionId,
    this.endsAt,
    this.votedOptionIndex,
    this.stateRevisions,
    this.hasViewerHasLikedField = true,
    this.hasViewerVoteOptionIdField = true,
  });

  factory PollSummary.fromJson(Map<String, dynamic> json) {
    final optionsJson = json['options'] as List<dynamic>;
    final revisionsJson = json['stateRevisions'];

    return PollSummary(
      id: json['id'] as String,
      author:
          PollAuthorSummary.fromJson(json['author'] as Map<String, dynamic>),
      question: json['question'] as String,
      imageUrl: json['imageUrl'] as String?,
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
      allowVoteCancellation: json['allowVoteCancellation'] as bool? ?? false,
      createdAt: DateTime.parse(json['createdAt'] as String).toLocal(),
      viewerVoteOptionId: json['viewerVoteOptionId'] as String?,
      endsAt: (json['endsAt'] as String?) == null
          ? null
          : DateTime.parse(json['endsAt'] as String).toLocal(),
      stateRevisions: revisionsJson == null
          ? null
          : PollStateRevisions.fromJson(
              revisionsJson as Map<String, dynamic>,
            ),
      hasViewerHasLikedField: json.containsKey('viewerHasLiked'),
      hasViewerVoteOptionIdField: json.containsKey('viewerVoteOptionId'),
    );
  }

  final String id;
  final PollAuthorSummary author;
  final String question;
  final String? imageUrl;
  final List<PollOptionSummary> options;
  final int votesCount;
  final int commentsCount;
  final int likesCount;
  final bool viewerHasLiked;
  final bool allowVoteCancellation;
  final DateTime createdAt;
  final String? viewerVoteOptionId;
  final DateTime? endsAt;
  final int? votedOptionIndex;
  final PollStateRevisions? stateRevisions;
  final bool hasViewerHasLikedField;
  final bool hasViewerVoteOptionIdField;

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

  PollSummary copyWith({
    bool? viewerHasLiked,
    int? likesCount,
    int? commentsCount,
    String? viewerVoteOptionId,
    bool clearViewerVoteOptionId = false,
    int? votesCount,
    List<PollOptionSummary>? options,
    PollStateRevisions? stateRevisions,
    bool? hasViewerHasLikedField,
    bool? hasViewerVoteOptionIdField,
  }) {
    return PollSummary(
      id: id,
      author: author,
      question: question,
      imageUrl: imageUrl,
      options: options ?? this.options,
      votesCount: votesCount ?? this.votesCount,
      commentsCount: commentsCount ?? this.commentsCount,
      likesCount: likesCount ?? this.likesCount,
      viewerHasLiked: viewerHasLiked ?? this.viewerHasLiked,
      allowVoteCancellation: allowVoteCancellation,
      createdAt: createdAt,
      viewerVoteOptionId: clearViewerVoteOptionId
          ? null
          : viewerVoteOptionId ?? this.viewerVoteOptionId,
      endsAt: endsAt,
      votedOptionIndex: votedOptionIndex,
      stateRevisions: stateRevisions ?? this.stateRevisions,
      hasViewerHasLikedField:
          hasViewerHasLikedField ?? this.hasViewerHasLikedField,
      hasViewerVoteOptionIdField:
          hasViewerVoteOptionIdField ?? this.hasViewerVoteOptionIdField,
    );
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

class PollStateRevisions {
  const PollStateRevisions({
    required this.votes,
    required this.likes,
    required this.comments,
  });

  factory PollStateRevisions.fromJson(Map<String, dynamic> json) {
    String parse(String key) {
      final value = json[key];
      if (value is! String || !RegExp(r'^(0|[1-9][0-9]*)$').hasMatch(value)) {
        throw FormatException('Invalid Poll $key revision');
      }
      final parsed = BigInt.parse(value);
      if (parsed > BigInt.parse('9223372036854775807')) {
        throw FormatException('Poll $key revision exceeds BIGINT');
      }
      return value;
    }

    return PollStateRevisions(
      votes: parse('votes'),
      likes: parse('likes'),
      comments: parse('comments'),
    );
  }

  final String votes;
  final String likes;
  final String comments;

  BigInt get votesValue => BigInt.parse(votes);
  BigInt get likesValue => BigInt.parse(likes);
  BigInt get commentsValue => BigInt.parse(comments);
}
