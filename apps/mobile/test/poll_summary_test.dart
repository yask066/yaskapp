import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_summary.dart';

void main() {
  test('parses an optional poll image URL', () {
    final poll = PollSummary.fromJson({
      'id': 'poll-1',
      'author': {
        'id': 'user-1',
        'username': 'ada',
        'displayName': 'Ada Lovelace',
        'avatarObjectKey': null,
        'avatarUrl': null,
      },
      'question': 'Which option?',
      'imageUrl': '/media/polls/poll-1',
      'options': [
        {'id': 'option-1', 'text': 'First', 'position': 0, 'votesCount': 0},
        {'id': 'option-2', 'text': 'Second', 'position': 1, 'votesCount': 0},
      ],
      'votesCount': 0,
      'commentsCount': 0,
      'likesCount': 0,
      'viewerHasLiked': false,
      'createdAt': '2026-07-21T10:00:00.000Z',
      'endsAt': null,
    });

    expect(poll.imageUrl, '/media/polls/poll-1');
  });

  test('parses viewer vote and closed state from poll json', () {
    final poll = PollSummary.fromJson({
      'id': 'poll-1',
      'author': {
        'id': 'user-1',
        'username': 'ada',
        'displayName': 'Ada Lovelace',
        'avatarObjectKey': null,
        'avatarUrl': null,
      },
      'question': 'Which option?',
      'options': [
        {'id': 'option-1', 'text': 'First', 'position': 0, 'votesCount': 1},
        {'id': 'option-2', 'text': 'Second', 'position': 1, 'votesCount': 0},
      ],
      'votesCount': 1,
      'commentsCount': 0,
      'likesCount': 0,
      'viewerHasLiked': false,
      'viewerVoteOptionId': 'option-1',
      'createdAt': '2026-07-21T10:00:00.000Z',
      'endsAt': '2020-01-01T00:00:00.000Z',
    });

    expect(poll.viewerVoteOptionId, 'option-1');
    expect(poll.selectedOptionIndex, 0);
    expect(poll.isClosed, isTrue);
  });

  test('parses poll comment summary from json', () {
    final comment = PollCommentSummary.fromJson({
      'id': 'comment-1',
      'pollId': 'poll-1',
      'author': {
        'id': 'user-1',
        'username': 'ada',
        'displayName': 'Ada Lovelace',
        'avatarObjectKey': null,
      },
      'body': 'I would choose the second option.',
      'likesCount': 0,
      'createdAt': '2026-07-21T10:00:00.000Z',
      'updatedAt': '2026-07-21T10:01:00.000Z',
    });

    expect(comment.id, 'comment-1');
    expect(comment.pollId, 'poll-1');
    expect(comment.author.id, 'user-1');
    expect(comment.author.username, 'ada');
    expect(comment.author.displayName, 'Ada Lovelace');
    expect(comment.body, 'I would choose the second option.');
    expect(comment.likesCount, 0);
    expect(comment.createdAt.isUtc, false);
    expect(comment.updatedAt.isUtc, false);
  });
}
