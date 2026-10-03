import 'package:flutter/foundation.dart';

import 'poll_summary.dart';

enum PollOrigin { http, mutation, realtime }

enum PollAction { vote, like }

enum PollStateGroup { votes, likes, comments, viewerVote, viewerLike }

class PollIngress {
  const PollIngress({
    required this.origin,
    required this.sessionEpoch,
    required this.viewerId,
    required this.expectedPollId,
    required this.requestId,
    required this.startedGeneration,
  });

  final PollOrigin origin;
  final int sessionEpoch;
  final String? viewerId;
  final String? expectedPollId;
  final String requestId;
  final int startedGeneration;
}

class PollOperationToken {
  const PollOperationToken({
    required this.sessionEpoch,
    required this.viewerId,
    required this.pollId,
    required this.action,
    required this.operationId,
  });

  final int sessionEpoch;
  final String viewerId;
  final String pollId;
  final PollAction action;
  final String operationId;

  @override
  bool operator ==(Object other) =>
      other is PollOperationToken &&
      sessionEpoch == other.sessionEpoch &&
      viewerId == other.viewerId &&
      pollId == other.pollId &&
      action == other.action &&
      operationId == other.operationId;

  @override
  int get hashCode =>
      Object.hash(sessionEpoch, viewerId, pollId, action, operationId);
}

class PollMergeResult {
  const PollMergeResult({
    required this.state,
    required this.changedGroups,
    required this.needsReconcile,
  });

  final PollSummary? state;
  final Set<PollStateGroup> changedGroups;
  final bool needsReconcile;
}

class _StoredPoll {
  _StoredPoll(this.poll, {required bool viewerConfirmed})
      : votesRevision = poll.stateRevisions?.votesValue,
        likesRevision = poll.stateRevisions?.likesValue,
        commentsRevision = poll.stateRevisions?.commentsValue,
        viewerVoteRevision = viewerConfirmed && poll.hasViewerVoteOptionIdField
            ? poll.stateRevisions?.votesValue
            : null,
        viewerLikeRevision = viewerConfirmed && poll.hasViewerHasLikedField
            ? poll.stateRevisions?.likesValue
            : null;

  PollSummary poll;
  BigInt? votesRevision;
  BigInt? likesRevision;
  BigInt? commentsRevision;
  BigInt? viewerVoteRevision;
  BigInt? viewerLikeRevision;
  bool votesBootstrapped = false;
  bool likesBootstrapped = false;
  bool commentsBootstrapped = false;
  bool viewerVoteBootstrapped = false;
  bool viewerLikeBootstrapped = false;
  int generation = 0;
}

/// Canonical session-owned Poll state shared by loaded Flutter surfaces.
class PollStateStore extends ChangeNotifier {
  PollStateStore({required String? viewerId}) : _viewerId = viewerId;

  final Map<String, _StoredPoll> _polls = {};
  final Map<String, int> _generationByPollId = {};
  final Set<String> _deletedPollIds = {};
  final Map<(String, PollAction), PollOperationToken> _pending = {};
  String? _viewerId;
  int _sessionEpoch = 0;
  int _nextOperationId = 0;

  int get sessionEpoch => _sessionEpoch;
  String? get viewerId => _viewerId;

  PollSummary? pollById(String id) => _polls[id]?.poll;
  bool isDeleted(String id) => _deletedPollIds.contains(id);
  bool isVoting(String id) => _pending.containsKey((id, PollAction.vote));
  bool isLiking(String id) => _pending.containsKey((id, PollAction.like));

  int generationFor(String id) => _generationByPollId[id] ?? 0;
  Map<String, int> get generationSnapshot => Map.unmodifiable({
        ..._generationByPollId,
      });

  PollMergeResult ingest(PollSummary incoming, PollIngress ingress) {
    final current = _polls[incoming.id];
    final rejected = PollMergeResult(
      state: current?.poll,
      changedGroups: const {},
      needsReconcile: false,
    );
    if (ingress.sessionEpoch != _sessionEpoch ||
        ingress.expectedPollId != null &&
            ingress.expectedPollId != incoming.id ||
        _viewerId != null &&
            ingress.viewerId != null &&
            ingress.viewerId != _viewerId ||
        _deletedPollIds.contains(incoming.id)) {
      return rejected;
    }
    final validViewer = ingress.origin != PollOrigin.realtime &&
        _viewerId != null &&
        ingress.viewerId == _viewerId;
    if (!_validSnapshot(incoming, validateViewer: validViewer) ||
        current != null && !_samePresentation(current.poll, incoming)) {
      return PollMergeResult(
        state: current?.poll,
        changedGroups: {},
        needsReconcile: true,
      );
    }

    if (current == null &&
        incoming.stateRevisions == null &&
        (ingress.origin != PollOrigin.http ||
            ingress.startedGeneration != generationFor(incoming.id))) {
      return const PollMergeResult(
        state: null,
        changedGroups: {},
        needsReconcile: true,
      );
    }
    final initial = current == null && !validViewer
        ? incoming.copyWith(
            viewerHasLiked: false,
            hasViewerHasLikedField: false,
            clearViewerVoteOptionId: true,
            hasViewerVoteOptionIdField: false,
          )
        : incoming;
    final stored =
        current ?? _StoredPoll(initial, viewerConfirmed: validViewer);
    stored.generation = generationFor(incoming.id);
    final changed = <PollStateGroup>{};
    var needsReconcile = false;
    var next = current?.poll ?? initial;
    final revisions = incoming.stateRevisions;
    final isBootstrap = ingress.origin == PollOrigin.http &&
        ingress.startedGeneration == generationFor(incoming.id);

    BigInt? incomingRevision(String? raw) =>
        raw == null ? null : BigInt.parse(raw);
    void acceptGroup({
      required BigInt? revision,
      required BigInt? watermark,
      required bool bootstrapped,
      required bool bootstrapAllowed,
      required bool equal,
      required void Function() apply,
    }) {
      if (revision != null) {
        if (watermark == null || revision > watermark) {
          apply();
          return;
        }
        if (revision == watermark && !equal) needsReconcile = true;
        return;
      }
      if (watermark == null && !bootstrapped && bootstrapAllowed) {
        apply();
        return;
      }
      needsReconcile = true;
    }

    final voteRevision = incomingRevision(revisions?.votes);
    final likesRevision = incomingRevision(revisions?.likes);
    final commentsRevision = incomingRevision(revisions?.comments);

    acceptGroup(
      revision: voteRevision,
      watermark: stored.votesRevision,
      bootstrapped: stored.votesBootstrapped,
      bootstrapAllowed: isBootstrap,
      equal: _sameVotes(next, incoming),
      apply: () {
        next = next.copyWith(
            votesCount: incoming.votesCount, options: incoming.options);
        stored.votesRevision = voteRevision;
        stored.votesBootstrapped = voteRevision == null;
        changed.add(PollStateGroup.votes);
      },
    );
    acceptGroup(
      revision: likesRevision,
      watermark: stored.likesRevision,
      bootstrapped: stored.likesBootstrapped,
      bootstrapAllowed: isBootstrap,
      equal: next.likesCount == incoming.likesCount,
      apply: () {
        next = next.copyWith(likesCount: incoming.likesCount);
        stored.likesRevision = likesRevision;
        stored.likesBootstrapped = likesRevision == null;
        changed.add(PollStateGroup.likes);
      },
    );
    acceptGroup(
      revision: commentsRevision,
      watermark: stored.commentsRevision,
      bootstrapped: stored.commentsBootstrapped,
      bootstrapAllowed: isBootstrap,
      equal: next.commentsCount == incoming.commentsCount,
      apply: () {
        next = next.copyWith(commentsCount: incoming.commentsCount);
        stored.commentsRevision = commentsRevision;
        stored.commentsBootstrapped = commentsRevision == null;
        changed.add(PollStateGroup.comments);
      },
    );

    if (validViewer && incoming.hasViewerVoteOptionIdField) {
      acceptGroup(
        revision: voteRevision,
        watermark: stored.viewerVoteRevision,
        bootstrapped: stored.viewerVoteBootstrapped,
        bootstrapAllowed: isBootstrap,
        equal: next.viewerVoteOptionId == incoming.viewerVoteOptionId,
        apply: () {
          next = next.copyWith(
            viewerVoteOptionId: incoming.viewerVoteOptionId,
            clearViewerVoteOptionId: incoming.viewerVoteOptionId == null,
            hasViewerVoteOptionIdField: true,
          );
          stored.viewerVoteRevision = voteRevision;
          stored.viewerVoteBootstrapped = voteRevision == null;
          changed.add(PollStateGroup.viewerVote);
        },
      );
    }
    if (validViewer && incoming.hasViewerHasLikedField) {
      acceptGroup(
        revision: likesRevision,
        watermark: stored.viewerLikeRevision,
        bootstrapped: stored.viewerLikeBootstrapped,
        bootstrapAllowed: isBootstrap,
        equal: next.viewerHasLiked == incoming.viewerHasLiked,
        apply: () {
          next = next.copyWith(
            viewerHasLiked: incoming.viewerHasLiked,
            hasViewerHasLikedField: true,
          );
          stored.viewerLikeRevision = likesRevision;
          stored.viewerLikeBootstrapped = likesRevision == null;
          changed.add(PollStateGroup.viewerLike);
        },
      );
    }

    if (current == null || changed.isNotEmpty) {
      if (stored.votesRevision != null &&
          stored.likesRevision != null &&
          stored.commentsRevision != null) {
        next = next.copyWith(
          stateRevisions: PollStateRevisions(
            votes: stored.votesRevision!.toString(),
            likes: stored.likesRevision!.toString(),
            comments: stored.commentsRevision!.toString(),
          ),
        );
      }
      stored.poll = next;
      stored.generation = generationFor(incoming.id) + 1;
      _generationByPollId[incoming.id] = stored.generation;
      _polls[incoming.id] = stored;
      notifyListeners();
    }
    return PollMergeResult(
      state: _polls[incoming.id]?.poll,
      changedGroups: Set.unmodifiable(changed),
      needsReconcile: needsReconcile,
    );
  }

  PollOperationToken? beginOperation(String pollId, PollAction action) {
    final viewer = _viewerId;
    if (viewer == null || _deletedPollIds.contains(pollId)) return null;
    final key = (pollId, action);
    if (_pending.containsKey(key)) return null;
    final token = PollOperationToken(
      sessionEpoch: _sessionEpoch,
      viewerId: viewer,
      pollId: pollId,
      action: action,
      operationId: 'op-${++_nextOperationId}',
    );
    _pending[key] = token;
    final stored = _polls[pollId];
    final nextGeneration = generationFor(pollId) + 1;
    _generationByPollId[pollId] = nextGeneration;
    if (stored != null) stored.generation = nextGeneration;
    notifyListeners();
    return token;
  }

  void completeOperation(PollOperationToken token, [PollSummary? snapshot]) {
    if (!_owns(token)) return;
    if (snapshot != null) {
      ingest(
          snapshot,
          PollIngress(
            origin: PollOrigin.mutation,
            sessionEpoch: token.sessionEpoch,
            viewerId: token.viewerId,
            expectedPollId: token.pollId,
            requestId: token.operationId,
            startedGeneration: generationFor(token.pollId),
          ));
    }
    _pending.remove((token.pollId, token.action));
    notifyListeners();
  }

  void failOperation(PollOperationToken token, {required bool ambiguous}) {
    if (!_owns(token)) return;
    _pending.remove((token.pollId, token.action));
    final stored = _polls[token.pollId];
    if (ambiguous) {
      final nextGeneration = generationFor(token.pollId) + 1;
      _generationByPollId[token.pollId] = nextGeneration;
      if (stored != null) stored.generation = nextGeneration;
    }
    notifyListeners();
  }

  void markDeleted(String pollId, PollIngress ingress) {
    if ((ingress.origin != PollOrigin.mutation &&
            ingress.origin != PollOrigin.realtime) ||
        ingress.sessionEpoch != _sessionEpoch ||
        _viewerId != null &&
            ingress.viewerId != null &&
            ingress.viewerId != _viewerId) {
      return;
    }
    _deletedPollIds.add(pollId);
    _polls.remove(pollId);
    _pending.remove((pollId, PollAction.vote));
    _pending.remove((pollId, PollAction.like));
    notifyListeners();
  }

  void clear({String? viewerId}) {
    _sessionEpoch++;
    _viewerId = viewerId;
    _polls.clear();
    _generationByPollId.clear();
    _deletedPollIds.clear();
    _pending.clear();
    notifyListeners();
  }

  bool _owns(PollOperationToken token) =>
      token.sessionEpoch == _sessionEpoch &&
      token.viewerId == _viewerId &&
      _pending[(token.pollId, token.action)] == token;

  bool _validSnapshot(PollSummary poll, {required bool validateViewer}) {
    if (poll.votesCount < 0 || poll.likesCount < 0 || poll.commentsCount < 0) {
      return false;
    }
    final ids = poll.options.map((option) => option.id).toSet();
    if (ids.length != poll.options.length ||
        poll.options.any((option) => option.votesCount < 0)) {
      return false;
    }
    if (poll.options.fold<int>(0, (sum, option) => sum + option.votesCount) !=
        poll.votesCount) {
      return false;
    }
    final selected = poll.viewerVoteOptionId;
    return !validateViewer || selected == null || ids.contains(selected);
  }

  bool _samePresentation(PollSummary a, PollSummary b) =>
      a.id == b.id &&
      a.author.id == b.author.id &&
      a.question == b.question &&
      a.imageUrl == b.imageUrl &&
      a.allowVoteCancellation == b.allowVoteCancellation &&
      a.endsAt == b.endsAt &&
      a.createdAt == b.createdAt &&
      a.options.length == b.options.length &&
      List.generate(a.options.length, (i) => i).every((i) =>
          a.options[i].id == b.options[i].id &&
          a.options[i].position == b.options[i].position &&
          a.options[i].text == b.options[i].text);

  bool _sameVotes(PollSummary a, PollSummary b) =>
      a.votesCount == b.votesCount &&
      a.options.length == b.options.length &&
      List.generate(a.options.length, (i) => i).every((i) =>
          a.options[i].id == b.options[i].id &&
          a.options[i].votesCount == b.options[i].votesCount);
}
