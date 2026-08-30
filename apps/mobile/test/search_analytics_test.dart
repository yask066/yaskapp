import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/core/analytics/search_analytics.dart';
import 'package:yaskapp_mobile/src/features/search/search_result.dart';

void main() {
  test('analytics metadata contains no raw query field', () {
    final analytics = _RecordingSearchAnalytics();

    analytics.searchSubmitted(
      queryLength: 12,
      type: SearchType.all,
      sort: SearchSort.relevance,
    );
    analytics.resultClicked(
      resultType: 'poll',
      position: 0,
    );

    expect(analytics.events, [
      {
        'name': 'search_submitted',
        'queryLength': 12,
        'type': 'all',
        'sort': 'relevance',
      },
      {
        'name': 'search_result_clicked',
        'resultType': 'poll',
        'position': 0,
      },
    ]);
    expect(
        analytics.events.every((event) => !event.containsKey('query')), true);
  });
}

class _RecordingSearchAnalytics extends SearchAnalytics {
  final events = <Map<String, Object>>[];

  @override
  void searchSubmitted({
    required int queryLength,
    required SearchType type,
    required SearchSort sort,
  }) {
    events.add({
      'name': 'search_submitted',
      'queryLength': queryLength,
      'type': type.name,
      'sort': sort.name,
    });
  }

  @override
  void resultClicked({required String resultType, required int position}) {
    events.add({
      'name': 'search_result_clicked',
      'resultType': resultType,
      'position': position,
    });
  }

  @override
  void searchOpened() {}

  @override
  void filterChanged({required SearchType type, required SearchSort sort}) {}

  @override
  void empty({
    required int queryLength,
    required SearchType type,
    required SearchSort sort,
  }) {}

  @override
  void error({
    required int queryLength,
    required SearchType type,
    required SearchSort sort,
  }) {}
}
