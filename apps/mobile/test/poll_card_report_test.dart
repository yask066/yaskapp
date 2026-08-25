import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_card.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_summary.dart';

void main() {
  testWidgets('shows Report in the poll actions menu', (tester) async {
    var reported = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PollCard(
            poll: _poll(),
            onReport: () => reported = true,
          ),
        ),
      ),
    );

    await tester.tap(find.byTooltip('More'));
    await tester.pumpAndSettle();
    expect(find.text('Report'), findsOneWidget);

    await tester.tap(find.text('Report'));
    expect(reported, isTrue);
  });
}

PollSummary _poll() => PollSummary.fromJson({
      'id': 'poll-1',
      'question': 'Question',
      'createdAt': '2026-08-25T12:00:00.000Z',
      'isClosed': false,
      'allowVoteCancellation': false,
      'votesCount': 0,
      'commentsCount': 0,
      'likesCount': 0,
      'viewerHasLiked': false,
      'author': {
        'id': 'author-1',
        'username': 'author',
        'displayName': 'Author',
      },
      'options': [
        {'id': 'option-1', 'text': 'Option', 'position': 0, 'votesCount': 0},
      ],
    });
