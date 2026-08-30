import '../../features/search/search_result.dart';

abstract class SearchAnalytics {
  const SearchAnalytics();

  void searchOpened();

  void searchSubmitted({
    required int queryLength,
    required SearchType type,
    required SearchSort sort,
  });

  void filterChanged({required SearchType type, required SearchSort sort});

  void resultClicked({required String resultType, required int position});

  void empty({
    required int queryLength,
    required SearchType type,
    required SearchSort sort,
  });

  void error({
    required int queryLength,
    required SearchType type,
    required SearchSort sort,
  });
}

class NoopSearchAnalytics extends SearchAnalytics {
  const NoopSearchAnalytics();

  @override
  void searchOpened() {}

  @override
  void searchSubmitted({
    required int queryLength,
    required SearchType type,
    required SearchSort sort,
  }) {}

  @override
  void filterChanged({required SearchType type, required SearchSort sort}) {}

  @override
  void resultClicked({required String resultType, required int position}) {}

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
