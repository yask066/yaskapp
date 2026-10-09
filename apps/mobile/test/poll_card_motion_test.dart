import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/core/motion/motion_settings.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_card.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_summary.dart';

void main() {
  testWidgets('motion flags off keep values and bars static', (tester) async {
    final key = GlobalKey<_PollCardMotionHarnessState>();
    await tester.pumpWidget(_host(key: key, reactionsMotion: false));
    expect(_firstProgress(tester).value, 0);
    expect(_firstProgress(tester).value!.isFinite, isTrue);

    key.currentState!.show(_poll(votes: 100, optionVotes: 100));
    await tester.pump();
    expect(find.text('100 votes'), findsOneWidget);
    expect(find.text('100%'), findsOneWidget);
    expect(_firstProgress(tester).value, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('count and percent animate only when reactions flag is on', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    final key = GlobalKey<_PollCardMotionHarnessState>();
    await tester.pumpWidget(_host(key: key, reactionsMotion: true));
    key.currentState!.show(_poll(votes: 100, optionVotes: 100));
    await tester.pump();

    expect(
      tester
          .widgetList<Semantics>(find.byType(Semantics))
          .any((semantics) => semantics.properties.label == '100 votes'),
      isTrue,
    );
    expect(
      tester
          .widgetList<Semantics>(find.byType(Semantics))
          .any((semantics) => semantics.properties.label == '100%'),
      isTrue,
    );
    expect(_firstProgress(tester).value, lessThan(1));
    await tester.pump(const Duration(milliseconds: 180));
    expect(_firstProgress(tester).value, lessThan(1));
    await tester.pump(const Duration(milliseconds: 60));
    expect(_firstProgress(tester).value, 1);
    semantics.dispose();
  });

  testWidgets('reduced motion finishes active result transitions immediately', (
    tester,
  ) async {
    final key = GlobalKey<_PollCardMotionHarnessState>();
    await tester.pumpWidget(_host(key: key, reactionsMotion: true));
    key.currentState!.show(_poll(votes: 100, optionVotes: 100));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 80));

    expect(_firstProgress(tester).value, lessThan(1));
    expect(find.text('100%'), findsNothing);

    await tester.pumpWidget(
      _host(key: key, reactionsMotion: true, reduceMotion: true),
    );
    await tester.pump();

    expect(_firstProgress(tester).value, 1);
    expect(find.text('100%'), findsOneWidget);
  });

  testWidgets('like scale is driven by a local pointer press only', (
    tester,
  ) async {
    final key = GlobalKey<_PollCardMotionHarnessState>();
    await tester.pumpWidget(_host(key: key, reactionsMotion: true));
    final initialScale = _likeScale(tester, Icons.favorite_border);
    expect(initialScale, 1);

    key.currentState!.show(_poll(votes: 9, optionVotes: 9, liked: true));
    await tester.pump();
    expect(_likeScale(tester, Icons.favorite), 1);

    final like = find.byTooltip('Unlike');
    final initialActionRect = tester.getRect(like);
    final gesture = await tester.startGesture(tester.getCenter(like));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 60));
    final pressedScale = _likeScale(tester, Icons.favorite);
    expect(pressedScale, greaterThan(1));
    expect(pressedScale, lessThanOrEqualTo(1.08));
    expect(tester.getRect(like), initialActionRect);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump();
    expect(_likeScale(tester, Icons.favorite), 1);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();

    await gesture.up();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 160));
    expect(_likeScale(tester, Icons.favorite), 1);
    expect(tester.takeException(), isNull);
  });
}

Widget _host({
  required GlobalKey<_PollCardMotionHarnessState> key,
  required bool reactionsMotion,
  bool reduceMotion = false,
}) =>
    MaterialApp(
      home: Builder(
        builder: (context) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            disableAnimations: reduceMotion,
          ),
          child: MotionSettingsScope(
            reactionsMotion: reactionsMotion,
            child: Scaffold(
              body: SingleChildScrollView(
                child: _PollCardMotionHarness(key: key),
              ),
            ),
          ),
        ),
      ),
    );

LinearProgressIndicator _firstProgress(WidgetTester tester) =>
    tester.widget<LinearProgressIndicator>(
      find.byType(LinearProgressIndicator).first,
    );

double _likeScale(WidgetTester tester, IconData icon) => tester
    .widget<Transform>(
      find
          .ancestor(
            of: find.byIcon(icon),
            matching: find.byType(Transform),
          )
          .first,
    )
    .transform
    .getMaxScaleOnAxis();

class _PollCardMotionHarness extends StatefulWidget {
  const _PollCardMotionHarness({super.key});

  @override
  State<_PollCardMotionHarness> createState() => _PollCardMotionHarnessState();
}

class _PollCardMotionHarnessState extends State<_PollCardMotionHarness> {
  var poll = _poll(votes: 0, optionVotes: 0);

  void show(PollSummary value) => setState(() => poll = value);

  @override
  Widget build(BuildContext context) => PollCard(
        poll: poll,
        onVote: (_) {},
        onToggleLike: () {},
      );
}

PollSummary _poll({
  required int votes,
  required int optionVotes,
  bool liked = false,
}) =>
    PollSummary(
      id: 'motion-poll',
      author: const PollAuthorSummary(
        id: 'motion-author',
        username: 'author',
        displayName: 'Author',
      ),
      question: 'Question',
      options: [
        PollOptionSummary(
          id: 'option-one',
          text: 'Yes',
          position: 0,
          votesCount: optionVotes,
        ),
        PollOptionSummary(
          id: 'option-two',
          text: 'No',
          position: 1,
          votesCount: votes - optionVotes,
        ),
      ],
      votesCount: votes,
      commentsCount: 0,
      likesCount: liked ? 1 : 0,
      viewerHasLiked: liked,
      createdAt: DateTime(2026, 10, 9),
    );
