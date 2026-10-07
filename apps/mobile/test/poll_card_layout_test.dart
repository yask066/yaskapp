import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_card.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_summary.dart';

void main() {
  testWidgets('M12 option keys use stable poll and option IDs', (tester) async {
    final poll = _poll();
    await tester.pumpWidget(_card(poll));

    expect(
      find.byKey(ValueKey('poll-option-${poll.id}-${poll.options.first.id}')),
      findsOneWidget,
    );
  });

  testWidgets('M10 media failure keeps its reserved 16:9 geometry', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_card(_poll(imageUrl: '/media/polls/layout')));
    await tester.pump();

    final media = find.byType(Image);
    final commentAction = find.byIcon(Icons.mode_comment_outlined);
    expect(media, findsOneWidget);
    final mediaRect = tester.getRect(media);
    final cardRect = tester.getRect(find.byType(PollCard));
    final commentRect = tester.getRect(commentAction);
    expect(mediaRect.width / mediaRect.height, closeTo(16 / 9, 0.01));

    await tester.pumpAndSettle();
    expect(tester.getRect(media), mediaRect);
    _expectSameRect(tester, find.byType(PollCard), cardRect);
    _expectSameRect(tester, commentAction, commentRect);
    await tester.pump(const Duration(seconds: 1));
    expect(tester.getRect(media), mediaRect);
    expect(tester.takeException(), isNull);
  });

  testWidgets('M10 pending and vote transitions keep option/card geometry', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final key = GlobalKey<_PollCardHarnessState>();

    await tester.pumpWidget(_cardHarness(key, _poll()));
    await tester.pumpAndSettle();
    final initialCard = tester.getRect(find.byType(PollCard));
    final commentAction = find.byIcon(Icons.mode_comment_outlined);
    final likeAction = find.byIcon(Icons.favorite_border);
    final initialCommentAction = tester.getRect(commentAction);
    final initialLikeAction = tester.getRect(likeAction);
    final optionCard = find
        .ancestor(
          of: find.text(
              'Yes, this is a long enough poll option to wrap onto another line'),
          matching: find.byType(Material),
        )
        .first;
    final initialOption = tester.getRect(optionCard);

    key.currentState!.showPending(true);
    await tester.pump(const Duration(milliseconds: 400));
    expect(tester.getRect(find.byType(PollCard)).height, initialCard.height);
    expect(
      tester.getRect(optionCard).height,
      initialOption.height,
    );
    _expectSameRect(tester, commentAction, initialCommentAction);
    _expectSameRect(tester, likeAction, initialLikeAction);

    for (final count in [
      0,
      9,
      10,
      99,
      100,
      999,
      1000,
      999,
      100,
      99,
      10,
      9,
      0,
    ]) {
      key.currentState!.showPending(false);
      key.currentState!.showPoll(
        _poll(votes: count, optionVotes: count),
      );
      await tester.pump(const Duration(milliseconds: 400));
      expect(
        tester.getRect(find.byType(PollCard)).height,
        initialCard.height,
        reason: 'Card height changed at count $count',
      );
      _expectSameRect(tester, commentAction, initialCommentAction);
      _expectSameRect(tester, likeAction, initialLikeAction);
      expect(tester.takeException(), isNull);
    }

    key.currentState!.showPoll(
      _poll(
        votes: 9,
        optionVotes: 9,
        selectedOptionIndex: 0,
        allowVoteCancellation: true,
      ),
    );
    await tester.pump(const Duration(milliseconds: 400));
    expect(tester.getRect(find.byType(PollCard)).height, initialCard.height);
    _expectSameRect(tester, commentAction, initialCommentAction);

    await tester.tap(find.byTooltip('More'));
    await tester.pumpAndSettle();
    expect(find.text('Cancel vote'), findsOneWidget);
  });

  testWidgets('M10 long text and 200% scale fit a narrow viewport', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 720);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(2)),
          child: Scaffold(
            body: SingleChildScrollView(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: PollCard(poll: _poll(longText: true, votes: 1000)),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    final card = tester.getRect(find.byType(PollCard));
    expect(card.left, greaterThanOrEqualTo(0));
    expect(card.right, lessThanOrEqualTo(320));
  });

  testWidgets('M10 200% scale keeps poll actions visible and labels author', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final semantics = tester.ensureSemantics();

    await tester.pumpWidget(_card(
      _poll(votes: 1000),
      textScaler: const TextScaler.linear(2),
      onOpenAuthor: () {},
    ));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.byTooltip('Share'), findsOneWidget);
    expect(
      tester.getRect(find.byTooltip('Share')).right,
      lessThanOrEqualTo(tester.getRect(find.byType(PollCard)).right),
    );
    expect(find.bySemanticsLabel('Open Author profile'), findsOneWidget);
    semantics.dispose();
  });
}

Widget _card(
  PollSummary poll, {
  TextScaler? textScaler,
  VoidCallback? onOpenAuthor,
}) =>
    MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(textScaler: textScaler ?? TextScaler.noScaling),
        child: Scaffold(
          body: SingleChildScrollView(
            child: PollCard(poll: poll, onOpenAuthor: onOpenAuthor),
          ),
        ),
      ),
    );

Widget _cardHarness(GlobalKey<_PollCardHarnessState> key, PollSummary poll) =>
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: _PollCardHarness(key: key, initialPoll: poll),
        ),
      ),
    );

class _PollCardHarness extends StatefulWidget {
  const _PollCardHarness({required this.initialPoll, super.key});

  final PollSummary initialPoll;

  @override
  State<_PollCardHarness> createState() => _PollCardHarnessState();
}

class _PollCardHarnessState extends State<_PollCardHarness> {
  late PollSummary _poll = widget.initialPoll;
  bool _pending = false;

  void showPending(bool pending) => setState(() => _pending = pending);
  void showPoll(PollSummary poll) => setState(() => _poll = poll);

  @override
  Widget build(BuildContext context) => PollCard(
        poll: _poll,
        isVoting: _pending,
        onVote: (_) {},
        onCancelVote: () {},
      );
}

PollSummary _poll({
  String? imageUrl,
  int votes = 9,
  int optionVotes = 9,
  bool longText = false,
  bool allowVoteCancellation = false,
  int? selectedOptionIndex,
}) =>
    PollSummary(
      id: 'poll-layout',
      author: const PollAuthorSummary(
        id: 'author-layout',
        username: 'author',
        displayName: 'Author',
      ),
      question: longText
          ? 'A very long question that must wrap cleanly inside a narrow poll card.'
          : 'Question',
      options: [
        PollOptionSummary(
          id: 'option-0',
          text: longText
              ? 'An unusually long poll option that should still fit at two hundred percent text scale'
              : 'Yes, this is a long enough poll option to wrap onto another line',
          position: 0,
          votesCount: optionVotes,
        ),
        const PollOptionSummary(
          id: 'option-1',
          text: 'No',
          position: 1,
          votesCount: 0,
        ),
      ],
      votesCount: votes,
      commentsCount: 999,
      likesCount: 999,
      viewerHasLiked: false,
      allowVoteCancellation: allowVoteCancellation,
      votedOptionIndex: selectedOptionIndex,
      createdAt: DateTime(2026, 10, 5),
      imageUrl: imageUrl,
    );

void _expectSameRect(WidgetTester tester, Finder finder, Rect expected) {
  final actual = tester.getRect(finder);
  expect(actual.left, closeTo(expected.left, 2));
  expect(actual.top, closeTo(expected.top, 2));
  expect(actual.width, closeTo(expected.width, 2));
  expect(actual.height, closeTo(expected.height, 2));
}
