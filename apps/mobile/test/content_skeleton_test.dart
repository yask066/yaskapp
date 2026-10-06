import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/core/widgets/content_skeleton.dart';

void main() {
  testWidgets('skeleton appears at 150ms and exposes one loading label',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: DelayedContentSkeleton(
          kind: ContentSkeletonKind.poll,
          rows: 1,
        ),
      ),
    ));

    await tester.pump(const Duration(milliseconds: 149));
    expect(find.bySemanticsLabel('Loading polls'), findsNothing);

    await tester.pump(const Duration(milliseconds: 1));
    expect(find.bySemanticsLabel('Loading polls'), findsOneWidget);
    expect(
      find.bySemanticsLabel(RegExp('Loading polls')),
      findsOneWidget,
    );
  });

  testWidgets('ready data cancels the delayed skeleton without a minimum time',
      (tester) async {
    var isLoading = true;
    await tester.pumpWidget(MaterialApp(
      home: StatefulBuilder(
        builder: (context, setState) => Scaffold(
          body: Column(
            children: [
              DelayedContentSkeleton(
                kind: ContentSkeletonKind.user,
                rows: 1,
                isLoading: isLoading,
              ),
              if (!isLoading) const Text('Loaded'),
              TextButton(
                onPressed: () => setState(() => isLoading = false),
                child: const Text('Ready'),
              ),
            ],
          ),
        ),
      ),
    ));

    await tester.pump(const Duration(milliseconds: 149));
    await tester.tap(find.text('Ready'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    expect(find.text('Loaded'), findsOneWidget);
    expect(find.bySemanticsLabel('Loading users'), findsNothing);
  });

  testWidgets('all skeleton kinds expose only one status at 200% text scale',
      (tester) async {
    for (final kind in ContentSkeletonKind.values) {
      await tester.pumpWidget(MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: const TextScaler.linear(2),
          ),
          child: child!,
        ),
        home: Scaffold(
          body: ListView(children: [ContentSkeleton(kind: kind, rows: 2)]),
        ),
      ));

      expect(find.bySemanticsLabel(ContentSkeleton.labelFor(kind)),
          findsOneWidget);
      expect(tester.takeException(), isNull);
    }

    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: ContentSkeleton(kind: ContentSkeletonKind.poll, rows: 1),
      ),
    ));
    final mediaSlot = tester.widget<AspectRatio>(find.byType(AspectRatio));
    expect(mediaSlot.aspectRatio, 16 / 9);
  });
}
