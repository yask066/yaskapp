import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_card.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_state_scope.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_state_store.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_summary.dart';

void main() {
  PollSummary poll({int votes = 1, int likes = 0, String voteRevision = '1'}) =>
      PollSummary(
        id: 'poll-1',
        author: const PollAuthorSummary(
            id: 'user-1', username: 'ada', displayName: 'Ada'),
        question: 'Shared state?',
        options: [
          PollOptionSummary(
              id: 'option-1', text: 'Yes', position: 0, votesCount: votes),
        ],
        votesCount: votes,
        commentsCount: 0,
        likesCount: likes,
        viewerHasLiked: likes > 0,
        viewerVoteOptionId: 'option-1',
        createdAt: DateTime.utc(2026),
        stateRevisions: PollStateRevisions(
            votes: voteRevision, likes: likes.toString(), comments: '0'),
      );

  testWidgets('loaded PollCard follows canonical state and per-poll pending',
      (tester) async {
    final store = PollStateStore(viewerId: 'user-1');
    PollIngress ingress(String id) => PollIngress(
          origin: PollOrigin.http,
          sessionEpoch: store.sessionEpoch,
          viewerId: store.viewerId,
          expectedPollId: id,
          requestId: 'initial-$id',
          startedGeneration: store.generationFor(id),
        );
    store.ingest(poll(), ingress('poll-1'));
    await tester.pumpWidget(MaterialApp(
      home: PollStateScope(
        store: store,
        child: Scaffold(
          body: PollCard(
            poll: poll(),
            onVote: (_) {},
            onToggleLike: () {},
          ),
        ),
      ),
    ));
    await tester.pump(const Duration(milliseconds: 300));
    expect(
      PollStateScope.maybeOf(tester.element(find.byType(PollCard))),
      same(store),
    );
    expect(find.text('1 votes'), findsOneWidget);
    expect(find.text('0'), findsNWidgets(2));

    final merged = store.ingest(
      poll(votes: 2, likes: 5, voteRevision: '2'),
      PollIngress(
        origin: PollOrigin.mutation,
        sessionEpoch: store.sessionEpoch,
        viewerId: store.viewerId,
        expectedPollId: 'poll-1',
        requestId: 'mutation',
        startedGeneration: store.generationFor('poll-1'),
      ),
    );
    expect(merged.state?.votesCount, 2);
    expect(merged.state?.likesCount, 5);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('2 votes'), findsOneWidget);
    expect(find.text('5'), findsOneWidget);

    store.beginOperation('poll-1', PollAction.like);
    await tester.pump();
    expect(store.isLiking('poll-1'), isTrue);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    store.dispose();
  });
}
