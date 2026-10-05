import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:yaskapp_mobile/src/core/read_request_scope.dart';
import 'package:yaskapp_mobile/src/features/notifications/notifications_api_client.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_state_store.dart';
import 'package:yaskapp_mobile/src/features/polls/polls_api_client.dart';
import 'package:yaskapp_mobile/src/features/profile/profiles_api_client.dart';
import 'package:yaskapp_mobile/src/features/search/search_api_client.dart';

Map<String, dynamic> pollJson({int likes = 0, String revision = '1'}) => {
      'id': 'poll-1',
      'author': {'id': 'author', 'username': 'ada', 'displayName': 'Ada'},
      'question': 'Question?',
      'options': [
        {'id': 'option-1', 'text': 'Yes', 'position': 0, 'votesCount': 0},
      ],
      'votesCount': 0,
      'commentsCount': 0,
      'likesCount': likes,
      'viewerHasLiked': likes > 0,
      'viewerVoteOptionId': null,
      'createdAt': '2026-10-01T00:00:00Z',
      'stateRevisions': {'votes': '1', 'likes': revision, 'comments': '1'},
    };

void main() {
  final reads = <String, Future<Object?> Function(http.Client)>{
    'feed': (httpClient) => PollsApiClient(httpClient: httpClient).listPolls(),
    'poll detail': (httpClient) =>
        PollsApiClient(httpClient: httpClient).getPoll(pollId: 'poll-1'),
    'own polls': (httpClient) => PollsApiClient(httpClient: httpClient)
        .listMyPolls(accessToken: 'token'),
    'user polls': (httpClient) =>
        PollsApiClient(httpClient: httpClient).listUserPolls(userId: 'author'),
    'subscriptions': (httpClient) => PollsApiClient(httpClient: httpClient)
        .listSubscriptions(accessToken: 'token'),
    'comments': (httpClient) =>
        PollsApiClient(httpClient: httpClient).listComments(pollId: 'poll-1'),
    'replies': (httpClient) => PollsApiClient(httpClient: httpClient)
        .listCommentReplies(pollId: 'poll-1', rootCommentId: 'comment-1'),
    'comment detail': (httpClient) => PollsApiClient(httpClient: httpClient)
        .getComment(
            pollId: 'poll-1', commentId: 'comment-1', accessToken: 'token'),
    'search': (httpClient) => SearchApiClient(httpClient: httpClient)
        .search(accessToken: 'token', query: 'question'),
    'profile': (httpClient) => ProfilesApiClient(httpClient: httpClient)
        .getPublicProfile(userId: 'author'),
    'followers': (httpClient) => ProfilesApiClient(httpClient: httpClient)
        .listFollowers(userId: 'author'),
    'following': (httpClient) => ProfilesApiClient(httpClient: httpClient)
        .listFollowing(accessToken: 'token'),
    'popular users': (httpClient) =>
        ProfilesApiClient(httpClient: httpClient).listPopularUsers(),
    'notifications': (httpClient) =>
        NotificationsApiClient(httpClient: httpClient)
            .listTyped(accessToken: 'token'),
    'unread count': (httpClient) =>
        NotificationsApiClient(httpClient: httpClient)
            .unreadCount(accessToken: 'token'),
  };

  for (final entry in reads.entries) {
    testWidgets('${entry.key} read finishes at 10 seconds', (tester) async {
      final response = Completer<http.Response>();
      final transport = MockClient((_) => response.future);
      Object? error;
      entry
          .value(transport)
          .then<void>((_) {}, onError: (Object e) => error = e);
      await tester.pump(const Duration(milliseconds: 9999));
      expect(error, isNull);
      await tester.pump(const Duration(milliseconds: 1));
      expect(error, isNotNull,
          reason: 'Read must terminate so Retry is available');
      response.complete(http.Response('{}', 200));
      await tester.pump();
      transport.close();
    });
  }

  testWidgets('read deadline aborts the underlying HTTP request',
      (tester) async {
    final transport = _AbortAwareClient();
    final scope = ReadRequestScope(timeout: const Duration(seconds: 1));
    final request = scope.get(transport, Uri.parse('http://api.test/polls'));
    var timedOut = false;
    request.then<void>((_) {},
        onError: (Object error) => timedOut = error is TimeoutException);
    await tester.pump(const Duration(seconds: 1));
    expect(timedOut, isTrue);
    expect(transport.aborted.isCompleted, isTrue);
    transport.response
        .complete(http.StreamedResponse(const Stream.empty(), 200));
    scope.close();
    transport.close();
  });

  testWidgets('timed out read cannot ingest after successful Retry',
      (tester) async {
    final first = Completer<http.Response>();
    var calls = 0;
    final store = PollStateStore(viewerId: 'viewer');
    final client = PollsApiClient(httpClient: MockClient((_) {
      if (++calls == 1) return first.future;
      return Future.value(http.Response(
          jsonEncode({'poll': pollJson(likes: 2, revision: '2')}), 200));
    }))
      ..bindPollStateStore(store, accessToken: 'token');
    addTearDown(() {
      client.close();
      store.dispose();
    });
    Object? error;
    client
        .getPoll(pollId: 'poll-1')
        .then<void>((_) {}, onError: (Object e) => error = e);
    await tester.pump(const Duration(seconds: 10));
    expect(error, isA<TimeoutException>());
    final retry = client.getPoll(pollId: 'poll-1');
    await tester.pump();
    expect((await retry).likesCount, 2);
    // Even a higher revision from the expired read must not enter the store.
    first.complete(http.Response(
        jsonEncode({'poll': pollJson(likes: 9, revision: '9')}), 200));
    await tester.pump();
    expect(store.pollById('poll-1')!.likesCount, 2);
    expect(calls, 2);
  });

  testWidgets('closed poll client ignores an in-flight read', (tester) async {
    final response = Completer<http.Response>();
    final store = PollStateStore(viewerId: 'viewer');
    final client =
        PollsApiClient(httpClient: MockClient((_) => response.future))
          ..bindPollStateStore(store);
    Object? error;
    client
        .getPoll(pollId: 'poll-1')
        .then<void>((_) {}, onError: (Object e) => error = e);
    await tester.pump();
    client.close();
    response.complete(http.Response(jsonEncode({'poll': pollJson()}), 200));
    await tester.pump();
    expect(store.pollById('poll-1'), isNull);
    expect(error, isNotNull);
    store.dispose();
  });

  for (final failure in ['network', 'server', 'malformed', 'rejected']) {
    testWidgets(
        '$failure mutation clears pending and reconciles when ambiguous',
        (tester) async {
      final store = PollStateStore(viewerId: 'viewer');
      var reads = 0;
      var writes = 0;
      final client = PollsApiClient(httpClient: MockClient((request) async {
        if (request.method == 'GET') {
          reads++;
          return http.Response(
              jsonEncode({'poll': pollJson(likes: 1, revision: '2')}), 200);
        }
        writes++;
        if (failure == 'network') throw http.ClientException('offline');
        return http.Response(
          failure == 'server'
              ? '{"message":"Failed"}'
              : failure == 'rejected'
                  ? '{"message":"Poll closed","error":"poll_closed"}'
                  : '{}',
          failure == 'server'
              ? 503
              : failure == 'rejected'
                  ? 422
                  : 200,
        );
      }))
        ..bindPollStateStore(store, accessToken: 'token');
      final action = client.likePoll(pollId: 'poll-1', accessToken: 'token');
      await expectLater(action, throwsA(anything));
      await tester.pump();
      expect(store.isLiking('poll-1'), isFalse);
      expect(reads, failure == 'rejected' ? 0 : 1);
      expect(writes, 1,
          reason: 'Ambiguous mutation must not be automatically repeated');
      expect(store.pollById('poll-1')?.viewerHasLiked == true,
          failure != 'rejected');
      client.close();
      store.dispose();
    });
  }

  testWidgets('ambiguous poll delete reconciles without repeating the mutation',
      (tester) async {
    var writes = 0;
    var reads = 0;
    final store = PollStateStore(viewerId: 'viewer');
    final client = PollsApiClient(httpClient: MockClient((request) async {
      if (request.method == 'GET') {
        reads++;
        return http.Response(jsonEncode({'poll': pollJson()}), 200);
      }
      writes++;
      return http.Response('{"message":"Server failed"}', 503);
    }))
      ..bindPollStateStore(store, accessToken: 'token');

    await expectLater(
      client.deletePoll(pollId: 'poll-1', accessToken: 'token'),
      throwsA(isA<PollsApiException>()),
    );
    await tester.pump();
    expect(reads, 1);
    expect(writes, 1);
    expect(store.pollById('poll-1')?.id, 'poll-1');
    client.close();
    store.dispose();
  });

  testWidgets('late delete from previous session cannot tombstone current poll',
      (tester) async {
    final response = Completer<http.Response>();
    final store = PollStateStore(viewerId: 'viewer-a');
    final client =
        PollsApiClient(httpClient: MockClient((_) => response.future))
          ..bindPollStateStore(store);
    final deletion =
        client.deletePoll(pollId: 'poll-1', accessToken: 'token-a');
    await tester.pump();
    store.clear(viewerId: 'viewer-b');
    response.complete(http.Response('', 204));
    await deletion;
    expect(store.isDeleted('poll-1'), isFalse);
    client.close();
    store.dispose();
  });
}

class _AbortAwareClient extends http.BaseClient {
  final aborted = Completer<void>();
  final response = Completer<http.StreamedResponse>();

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    expect(request, isA<http.AbortableRequest>());
    (request as http.AbortableRequest).abortTrigger!.then((_) {
      if (!aborted.isCompleted) aborted.complete();
    });
    return response.future;
  }
}
