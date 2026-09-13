import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_card.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_summary.dart';

void main() {
  testWidgets('makes selected and unselected poll options explicit', (
    tester,
  ) async {
    final poll = _poll(selectedOptionIndex: 0);

    await tester.pumpWidget(MaterialApp(home: PollCard(poll: poll)));

    expect(find.byIcon(Icons.radio_button_checked), findsOneWidget);
    expect(find.byIcon(Icons.radio_button_unchecked), findsOneWidget);
    expect(find.text('2 votes'), findsOneWidget);
    expect(find.text('1 vote'), findsOneWidget);
  });

  testWidgets('exposes accessible labels for poll actions', (tester) async {
    final poll = _poll(selectedOptionIndex: null);
    var commentsOpened = false;
    var likeToggled = false;

    await tester.pumpWidget(
      MaterialApp(
        home: PollCard(
          poll: poll,
          onOpenComments: () => commentsOpened = true,
          onToggleLike: () => likeToggled = true,
        ),
      ),
    );

    expect(find.byTooltip('Comments'), findsOneWidget);
    expect(find.byTooltip('Like'), findsOneWidget);

    await tester.tap(find.byTooltip('Comments'));
    await tester.tap(find.byTooltip('Like'));

    expect(commentsOpened, isTrue);
    expect(likeToggled, isTrue);
  });
}

PollSummary _poll({required int? selectedOptionIndex}) {
  return PollSummary(
    id: 'poll-1',
    author: const PollAuthorSummary(
      id: 'author-1',
      username: 'author',
      displayName: 'Author',
    ),
    question: 'Проверка уведомлений',
    options: const [
      PollOptionSummary(
        id: 'option-1',
        text: 'Есть',
        position: 0,
        votesCount: 2,
      ),
      PollOptionSummary(
        id: 'option-2',
        text: 'Нет',
        position: 1,
        votesCount: 1,
      ),
    ],
    votesCount: 3,
    commentsCount: 1,
    likesCount: 1,
    viewerHasLiked: false,
    createdAt: DateTime(2026, 7, 17, 12),
    votedOptionIndex: selectedOptionIndex,
  );
}
