import 'dart:convert';
import 'dart:io';

import 'package:yaskapp_mobile/src/features/polls/poll_summary.dart';

// Shared input adapter. Adds M03 test revisions without changing source fixtures;
// no merge behavior lives here.
final motionScrollFixture = jsonDecode(
  File('../../test/fixtures/t02-motion-scroll-loading-polls.json')
      .readAsStringSync(),
) as Map<String, dynamic>;

PollSummary motionRacePoll([String? kind]) {
  final race = motionScrollFixture['race'] as Map<String, dynamic>;
  final baseline = (motionScrollFixture['cards'] as List<dynamic>)
      .cast<Map<String, dynamic>>()
      .singleWhere((poll) => poll['id'] == race['pollId']);
  final patches = race['snapshots'] as Map<String, dynamic>;
  final snapshot = <String, dynamic>{
    ...baseline,
    if (kind != null) ...patches[kind] as Map<String, dynamic>,
  };
  snapshot['stateRevisions'] = {
    'votes': kind == 'vote' || kind == 'realtime' ? '2' : '1',
    'likes': kind == 'like' ? '2' : '1',
    'comments': '0',
  };
  return PollSummary.fromJson(snapshot);
}

List<PollSummary> motionProfilingPolls({int? seed}) {
  final actualSeed = seed ?? motionScrollFixture['seed'] as int;
  final config = motionScrollFixture['profiling'] as Map<String, dynamic>;
  final cards = (motionScrollFixture['cards'] as List<dynamic>)
      .cast<Map<String, dynamic>>();
  return List.generate(config['count'] as int, (index) {
    final card = cards[(actualSeed + index) % cards.length];
    final id =
        '${config['idPrefix']}-$actualSeed-${(index + 1).toString().padLeft(3, '0')}';
    return PollSummary.fromJson({
      ...card,
      'id': id,
      'options': [
        for (final (optionIndex, option)
            in (card['options'] as List<dynamic>).indexed)
          {...option as Map<String, dynamic>, 'id': '$id-option-$optionIndex'},
      ],
    });
  });
}

// Dart has no expected-failure test modifier; opt in to the recorded red cases.
const runMotionKnownFailures = bool.fromEnvironment('M02_RUN_KNOWN_FAILURES');
