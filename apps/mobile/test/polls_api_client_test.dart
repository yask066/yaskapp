import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:yaskapp_mobile/src/core/config/api_config.dart';
import 'package:yaskapp_mobile/src/features/polls/polls_api_client.dart';

void main() {
  const config = ApiConfig(baseUrl: 'http://api.test');

  test('maps closed vote errors to a clear user message', () async {
    final client = PollsApiClient(
      config: config,
      httpClient: MockClient((_) async {
        return http.Response(
          jsonEncode({
            'error': 'poll_closed',
            'message': 'Poll is closed.',
          }),
          422,
        );
      }),
    );

    await expectLater(
      client.setVote(
        pollId: 'poll-1',
        optionId: 'option-1',
        accessToken: 'token',
      ),
      throwsA(
        isA<PollsApiException>().having(
          (error) => error.userMessage,
          'userMessage',
          'This poll is closed. Voting changes are no longer available.',
        ),
      ),
    );
  });

  test('lists subscription polls with authorization and limit', () async {
    late http.Request request;
    final client = PollsApiClient(
      config: config,
      httpClient: MockClient((incoming) async {
        request = incoming;
        return http.Response(
          jsonEncode({
            'items': [_pollJson(commentsCount: 2)]
          }),
          200,
        );
      }),
    );

    final polls = await client.listSubscriptions(
      accessToken: 'access-token',
      limit: 10,
    );

    expect(request.method, 'GET');
    expect(request.url.path, '/polls/subscriptions');
    expect(request.url.queryParameters['limit'], '10');
    expect(request.headers['authorization'], 'Bearer access-token');
    expect(polls.single.id, 'poll-1');
  });

  test('lists public polls for a user', () async {
    late http.Request request;
    final client = PollsApiClient(
      config: config,
      httpClient: MockClient((incoming) async {
        request = incoming;
        return http.Response(
          jsonEncode({
            'items': [_pollJson(commentsCount: 0)]
          }),
          200,
        );
      }),
    );

    final polls = await client.listUserPolls(
      userId: 'user-2',
      accessToken: 'access-token',
      limit: 10,
    );

    expect(request.url.path, '/users/user-2/polls');
    expect(request.url.queryParameters['limit'], '10');
    expect(request.headers['authorization'], 'Bearer access-token');
    expect(polls.single.id, 'poll-1');
  });

  test('lists poll comments', () async {
    late Uri requestedUri;
    final client = PollsApiClient(
      config: config,
      httpClient: MockClient((request) async {
        requestedUri = request.url;

        return http.Response(
          jsonEncode({
            'items': [_commentJson()],
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      }),
    );

    final comments = await client.listComments(pollId: 'poll-1', limit: 25);

    expect(requestedUri.path, '/polls/poll-1/comments');
    expect(requestedUri.queryParameters['limit'], '25');
    expect(comments, hasLength(1));
    expect(comments.first.id, 'comment-1');
    expect(comments.first.body, 'A useful comment.');
    expect(comments.first.author.username, 'ada');
  });

  test('creates poll comment', () async {
    late http.Request sentRequest;
    final client = PollsApiClient(
      config: config,
      httpClient: MockClient((request) async {
        sentRequest = request;

        return http.Response(
          jsonEncode({
            'comment': _commentJson(),
            'poll': _pollJson(commentsCount: 1),
          }),
          201,
          headers: {'content-type': 'application/json'},
        );
      }),
    );

    final result = await client.createComment(
      pollId: 'poll-1',
      body: 'A useful comment.',
      accessToken: 'access-token',
    );

    expect(sentRequest.method, 'POST');
    expect(sentRequest.url.path, '/polls/poll-1/comments');
    expect(sentRequest.headers['authorization'], 'Bearer access-token');
    expect(sentRequest.headers['content-type'], 'application/json');
    expect(jsonDecode(sentRequest.body), {'body': 'A useful comment.'});
    expect(result.comment.id, 'comment-1');
    expect(result.poll.id, 'poll-1');
    expect(result.poll.commentsCount, 1);
  });
}

Map<String, dynamic> _commentJson() {
  return {
    'id': 'comment-1',
    'pollId': 'poll-1',
    'author': {
      'id': 'user-1',
      'username': 'ada',
      'displayName': 'Ada Lovelace',
      'avatarObjectKey': null,
    },
    'body': 'A useful comment.',
    'likesCount': 0,
    'createdAt': '2026-07-21T10:00:00.000Z',
    'updatedAt': '2026-07-21T10:00:00.000Z',
  };
}

Map<String, dynamic> _pollJson({required int commentsCount}) {
  return {
    'id': 'poll-1',
    'authorId': 'user-1',
    'author': {
      'id': 'user-1',
      'username': 'ada',
      'displayName': 'Ada Lovelace',
      'avatarObjectKey': null,
    },
    'question': 'Which feature should be next?',
    'description': null,
    'imageObjectKey': null,
    'visibility': 'public',
    'optionsCount': 2,
    'votesCount': 0,
    'commentsCount': commentsCount,
    'likesCount': 0,
    'viewerHasLiked': false,
    'options': [
      {
        'id': 'option-1',
        'text': 'Comments',
        'position': 0,
        'votesCount': 0,
      },
      {
        'id': 'option-2',
        'text': 'Shares',
        'position': 1,
        'votesCount': 0,
      },
    ],
    'createdAt': '2026-07-21T10:00:00.000Z',
    'updatedAt': '2026-07-21T10:00:00.000Z',
    'endsAt': null,
  };
}
