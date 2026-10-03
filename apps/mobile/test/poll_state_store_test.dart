import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_state_store.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_summary.dart';

void main() {
  PollSummary poll({
    String id = 'poll-1',
    int votes = 10,
    int optionA = 6,
    int optionB = 4,
    int likes = 10,
    bool liked = true,
    String? vote = 'option-a',
    String votesRevision = '1',
    String likesRevision = '1',
    String commentsRevision = '1',
    bool versioned = true,
  }) =>
      PollSummary(
        id: id,
        author: const PollAuthorSummary(
            id: 'user-1', username: 'ada', displayName: 'Ada'),
        question: 'Question?',
        options: [
          PollOptionSummary(
              id: 'option-a', text: 'A', position: 0, votesCount: optionA),
          PollOptionSummary(
              id: 'option-b', text: 'B', position: 1, votesCount: optionB),
        ],
        votesCount: votes,
        commentsCount: 0,
        likesCount: likes,
        viewerHasLiked: liked,
        viewerVoteOptionId: vote,
        createdAt: DateTime.utc(2026),
        stateRevisions: versioned
            ? PollStateRevisions(
                votes: votesRevision,
                likes: likesRevision,
                comments: commentsRevision,
              )
            : null,
      );

  PollIngress ingress(
    PollOrigin origin, {
    String? viewerId = 'user-1',
    int sessionEpoch = 0,
  }) =>
      PollIngress(
        origin: origin,
        sessionEpoch: sessionEpoch,
        viewerId: viewerId,
        expectedPollId: 'poll-1',
        requestId: 'request-1',
        startedGeneration: 0,
      );

  group('PollStateStore', () {
    test('merges independent snapshots without losing newer likes', () {
      final store = PollStateStore(viewerId: 'user-1');
      store.ingest(
          poll(), ingress(PollOrigin.http, sessionEpoch: store.sessionEpoch));
      store.ingest(
        poll(likes: 11, liked: true, likesRevision: '2'),
        ingress(PollOrigin.mutation),
      );
      store.ingest(
        poll(
            votes: 11,
            optionA: 7,
            optionB: 4,
            votesRevision: '2',
            likes: 10,
            liked: false),
        ingress(PollOrigin.mutation),
      );

      expect(store.pollById('poll-1')?.votesCount, 11);
      expect(store.pollById('poll-1')?.likesCount, 11);
      expect(store.pollById('poll-1')?.viewerHasLiked, isTrue);
    });

    test(
        'ignores duplicate and stale revisions and ignores viewer fields from realtime',
        () {
      final store = PollStateStore(viewerId: 'user-1');
      store.ingest(poll(), ingress(PollOrigin.http));
      store.ingest(
        poll(
            votes: 11,
            optionA: 7,
            optionB: 4,
            votesRevision: '2',
            liked: false),
        ingress(PollOrigin.realtime, viewerId: null),
      );
      final duplicate = store.ingest(
        poll(votes: 11, optionA: 7, optionB: 4, votesRevision: '2'),
        ingress(PollOrigin.realtime, viewerId: null),
      );
      store.ingest(
          poll(votes: 9, optionA: 5, optionB: 4), ingress(PollOrigin.http));

      expect(duplicate.changedGroups, isEmpty);
      expect(store.pollById('poll-1')?.votesCount, 11);
      expect(store.pollById('poll-1')?.viewerHasLiked, isTrue);
    });

    test('validates totals and option identity before accepting vote group',
        () {
      final store = PollStateStore(viewerId: 'user-1');
      store.ingest(poll(), ingress(PollOrigin.http));
      final result = store.ingest(
        poll(votes: 99, optionA: 90, optionB: 4, votesRevision: '2'),
        ingress(PollOrigin.mutation),
      );

      expect(result.needsReconcile, isTrue);
      expect(store.pollById('poll-1')?.votesCount, 10);
    });

    test('an invalid vote group does not block a valid like revision', () {
      final store = PollStateStore(viewerId: 'user-1');
      store.ingest(poll(), ingress(PollOrigin.http));
      final result = store.ingest(
        poll(
          votes: 99,
          optionA: 90,
          optionB: 4,
          votesRevision: '2',
          likes: 11,
          likesRevision: '2',
        ),
        ingress(PollOrigin.mutation),
      );

      expect(result.needsReconcile, isTrue);
      expect(result.state?.votesCount, 10);
      expect(result.state?.likesCount, 11);
    });

    test('malformed vote revision still accepts valid like revision', () {
      final store = PollStateStore(viewerId: 'user-1');
      store.ingest(poll(), ingress(PollOrigin.http));
      final incoming = poll(likes: 12).copyWith(
        stateRevisions: PollStateRevisions.fromJson({
          'votes': '01',
          'likes': '2',
          'comments': '1',
        }),
      );

      final result = store.ingest(incoming, ingress(PollOrigin.mutation));

      expect(result.needsReconcile, isTrue);
      expect(result.state?.votesCount, 10);
      expect(result.state?.likesCount, 12);
    });

    test('invalid viewer vote field does not block viewer like field', () {
      final store = PollStateStore(viewerId: 'user-1');
      final incoming = poll(vote: 'unknown-option', liked: true);

      final result = store.ingest(incoming, ingress(PollOrigin.http));

      expect(result.needsReconcile, isTrue);
      expect(result.state?.viewerVoteOptionId, isNull);
      expect(result.state?.hasViewerVoteOptionIdField, isFalse);
      expect(result.state?.viewerHasLiked, isTrue);
      expect(result.state?.hasViewerHasLikedField, isTrue);
    });

    test('pending operations are scoped by poll and action and owned by token',
        () {
      final store = PollStateStore(viewerId: 'user-1');
      final vote = store.beginOperation('poll-1', PollAction.vote);
      expect(store.beginOperation('poll-1', PollAction.vote), isNull);
      expect(store.beginOperation('poll-1', PollAction.like), isNotNull);
      expect(store.beginOperation('poll-2', PollAction.vote), isNotNull);
      store.failOperation(vote!, ambiguous: false);
      expect(store.isVoting('poll-1'), isFalse);
      expect(store.isLiking('poll-1'), isTrue);
    });

    test('clear advances session epoch and rejects late completions', () {
      final store = PollStateStore(viewerId: 'user-1');
      store.ingest(poll(), ingress(PollOrigin.http));
      final token = store.beginOperation('poll-1', PollAction.like)!;
      store.clear(viewerId: 'user-2');
      store.completeOperation(token, poll(likes: 12, likesRevision: '2'));

      expect(store.sessionEpoch, 1);
      expect(store.pollById('poll-1'), isNull);
      expect(store.isLiking('poll-1'), isFalse);
    });

    test('deletion tombstone rejects later snapshots until session clear', () {
      final store = PollStateStore(viewerId: 'user-1');
      store.ingest(poll(), ingress(PollOrigin.http));
      store.markDeleted('poll-1', ingress(PollOrigin.mutation));
      store.ingest(poll(votesRevision: '99'), ingress(PollOrigin.http));
      expect(store.pollById('poll-1'), isNull);
      store.clear(viewerId: 'user-1');
      store.ingest(
        poll(),
        ingress(PollOrigin.http, sessionEpoch: store.sessionEpoch),
      );
      expect(store.pollById('poll-1'), isNotNull);
    });

    test(
        'bootstraps one current HTTP legacy snapshot then requests reconciliation',
        () {
      final store = PollStateStore(viewerId: 'user-1');
      final first = store.ingest(
        poll(versioned: false),
        ingress(PollOrigin.http),
      );
      final stale = store.ingest(
        poll(versioned: false, votes: 8, optionA: 4, optionB: 4),
        ingress(PollOrigin.http),
      );

      expect(first.state?.votesCount, 10);
      expect(first.needsReconcile, isFalse);
      expect(stale.needsReconcile, isTrue);
      expect(stale.state?.votesCount, 10);
    });

    test('does not seed state from an unversioned realtime broadcast', () {
      final store = PollStateStore(viewerId: 'user-1');
      final result = store.ingest(
        poll(versioned: false, liked: false),
        ingress(PollOrigin.realtime, viewerId: null),
      );

      expect(result.state, isNull);
      expect(result.needsReconcile, isTrue);
    });

    test('does not bootstrap a legacy response dispatched before an operation',
        () {
      final store = PollStateStore(viewerId: 'user-1');
      final token = store.beginOperation('poll-1', PollAction.vote)!;
      final result = store.ingest(
        poll(versioned: false),
        ingress(PollOrigin.http),
      );

      expect(result.state, isNull);
      expect(result.needsReconcile, isTrue);
      store.failOperation(token, ambiguous: false);
    });

    test(
        'equal revision conflicts request reconciliation without replacing groups',
        () {
      final store = PollStateStore(viewerId: 'user-1');
      store.ingest(poll(), ingress(PollOrigin.http));
      final result = store.ingest(
        poll(likes: 12, likesRevision: '1'),
        ingress(PollOrigin.http),
      );

      expect(result.needsReconcile, isTrue);
      expect(result.state?.likesCount, 10);
    });
  });
}
