import '../polls/poll_summary.dart';
import '../profile/public_profile.dart';

enum SearchType { all, polls, users }

enum SearchSort { relevance, newest, popular }

abstract class SearchResult {
  const SearchResult({required this.score});

  final double score;

  factory SearchResult.fromJson(Map<String, dynamic> json) {
    final type = json['type'];
    final score = json['score'];

    if (score is! num) {
      throw const FormatException('Search result score is invalid.');
    }

    switch (type) {
      case 'poll':
        final poll = json['poll'];
        if (poll is! Map<String, dynamic>) {
          throw const FormatException('Search poll result is invalid.');
        }
        return PollSearchResult(
          poll: PollSummary.fromJson(poll),
          score: score.toDouble(),
        );
      case 'user':
        final user = json['user'];
        if (user is! Map<String, dynamic>) {
          throw const FormatException('Search user result is invalid.');
        }
        return UserSearchResult(
          user: PublicProfile.fromJson(user),
          score: score.toDouble(),
        );
      default:
        throw const FormatException('Search result type is invalid.');
    }
  }
}

class PollSearchResult extends SearchResult {
  const PollSearchResult({required this.poll, required super.score});

  final PollSummary poll;
}

class UserSearchResult extends SearchResult {
  const UserSearchResult({required this.user, required super.score});

  final PublicProfile user;
}

class SearchPage {
  const SearchPage({required this.items, required this.nextCursor});

  factory SearchPage.fromJson(Map<String, dynamic> json) {
    final itemsJson = json['items'];
    final nextCursor = json['nextCursor'];

    if (itemsJson is! List<dynamic> ||
        (nextCursor != null && nextCursor is! String)) {
      throw const FormatException('Search page response is invalid.');
    }

    return SearchPage(
      items: itemsJson.map((item) {
        if (item is! Map<String, dynamic>) {
          throw const FormatException('Search result is invalid.');
        }
        return SearchResult.fromJson(item);
      }).toList(),
      nextCursor: nextCursor as String?,
    );
  }

  final List<SearchResult> items;
  final String? nextCursor;
}
