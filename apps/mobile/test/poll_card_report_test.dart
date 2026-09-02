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
            poll: _poll(allowVoteCancellation: true, selectedOptionIndex: 0),
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

  testWidgets('renders the poll actions with hierarchy and optional edit',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PollCard(
            poll: _poll(allowVoteCancellation: true, selectedOptionIndex: 0),
            onEditPoll: () {},
            onCancelVote: () {},
            onDeletePoll: () {},
            onReport: () {},
          ),
        ),
      ),
    );

    await tester.tap(find.byTooltip('More'));
    await tester.pumpAndSettle();

    expect(find.text('Edit poll'), findsOneWidget);
    expect(find.text('Cancel vote'), findsOneWidget);
    expect(find.text('Delete poll'), findsOneWidget);
    expect(find.text('Report'), findsOneWidget);
    expect(find.byIcon(Icons.edit_outlined), findsOneWidget);
    expect(find.byIcon(Icons.undo), findsOneWidget);
    expect(find.byIcon(Icons.delete_outline), findsOneWidget);
    expect(find.byType(PopupMenuDivider), findsNWidgets(3));
  });

  testWidgets('sends the access token when loading a poll image',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: PollCard(
              poll: _poll(imageUrl: '/media/polls/poll-1'),
              accessToken: 'token-123',
            ),
          ),
        ),
      ),
    );

    final image = tester.widget<Image>(find.byType(Image));
    final provider = image.image as NetworkImage;
    expect(provider.headers?['authorization'], 'Bearer token-123');
  });
}

PollSummary _poll({
  String? imageUrl,
  bool allowVoteCancellation = false,
  int? selectedOptionIndex,
}) =>
    PollSummary.fromJson({
      'id': 'poll-1',
      'question': 'Question',
      'createdAt': '2026-08-25T12:00:00.000Z',
      'isClosed': false,
      'allowVoteCancellation': allowVoteCancellation,
      'selectedOptionIndex': selectedOptionIndex,
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
      'imageUrl': imageUrl,
    });
