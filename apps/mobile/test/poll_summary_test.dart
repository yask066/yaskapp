import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_summary.dart';

void main() {
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
