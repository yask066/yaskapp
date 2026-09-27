import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:yaskapp_mobile/src/core/config/api_config.dart';
import 'package:yaskapp_mobile/src/features/notifications/notification_model.dart';
import 'package:yaskapp_mobile/src/features/notifications/notification_store.dart';
import 'package:yaskapp_mobile/src/features/notifications/notifications_api_client.dart';
import 'package:yaskapp_mobile/src/features/notifications/notifications_screen.dart';

void main() {
  test('formats notification age using the largest suitable unit', () {
    final now = DateTime(2026, 8, 30, 12);

    expect(notificationAgeLabel(now, now: now), '0 seconds ago');
    expect(
        notificationAgeLabel(now.subtract(const Duration(seconds: 12)),
            now: now),
        '12 seconds ago');
    expect(
        notificationAgeLabel(now.subtract(const Duration(minutes: 5)),
            now: now),
        '5 minutes ago');
    expect(
        notificationAgeLabel(now.subtract(const Duration(hours: 2)), now: now),
        '2 hours ago');
    expect(
        notificationAgeLabel(now.subtract(const Duration(days: 3)), now: now),
        '3 days ago');
    expect(
        notificationAgeLabel(now.subtract(const Duration(days: 14)), now: now),
        '2 weeks ago');
    expect(
        notificationAgeLabel(now.subtract(const Duration(days: 60)), now: now),
        '2 months ago');
    expect(
        notificationAgeLabel(now.subtract(const Duration(days: 730)), now: now),
        '2 years ago');
  });

  test('notifications load only when the tab becomes active', () {
    expect(shouldLoadNotifications(isActive: false, wasActive: false), isFalse);
    expect(shouldLoadNotifications(isActive: true, wasActive: false), isTrue);
    expect(shouldLoadNotifications(isActive: true, wasActive: true), isFalse);
  });

  testWidgets(
      'opening inbox preserves unread state and performs no read mutation',
      (tester) async {
    final requests = <http.Request>[];
    final client = _client((request) async {
      requests.add(request);
      return http.Response('{}', 200);
    });
    final store = NotificationStore(apiClient: client, accessToken: 'token');
    addTearDown(store.close);
    store.mergePage(items: [_item('unread')], unreadCount: 1);

    await tester.pumpWidget(MaterialApp(
      home: NotificationsScreen(notificationStore: store, isActive: true),
    ));
    await tester.pumpAndSettle();

    expect(
        find.byKey(const ValueKey('notification-card-unread')), findsOneWidget);
    expect(store.state.itemsById['unread']!.isUnread, isTrue);
    expect(store.state.unreadCount, 1);
    expect(requests, isEmpty);
  });

  testWidgets('Unread filter hides read items and All restores them',
      (tester) async {
    final store = NotificationStore();
    addTearDown(store.close);
    store.mergePage(
      items: [_item('unread-item'), _item('read-item', unread: false)],
      unreadCount: 1,
    );

    await _showScreen(tester, store);

    expect(find.byKey(const ValueKey('notification-card-unread-item')),
        findsOneWidget);
    expect(find.byKey(const ValueKey('notification-card-read-item')),
        findsOneWidget);
    await tester.tap(find.text('Unread'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('notification-card-unread-item')),
        findsOneWidget);
    expect(find.byKey(const ValueKey('notification-card-read-item')),
        findsNothing);
    await tester.tap(find.text('All'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('notification-card-read-item')),
        findsOneWidget);
  });

  testWidgets('Unread filter loads older pages before showing an empty state',
      (tester) async {
    final requests = <http.Request>[];
    final client = _client((request) async {
      requests.add(request);
      if (request.url.queryParameters['cursor'] == 'cursor-1') {
        return _page([_wireItem('older-unread')], unreadCount: 1);
      }
      return _page(
        [_wireItem('newer-read', unread: false)],
        nextCursor: 'cursor-1',
        unreadCount: 1,
      );
    });
    final store = NotificationStore(apiClient: client, accessToken: 'token');
    addTearDown(store.close);

    await tester.pumpWidget(MaterialApp(
      home: NotificationsScreen(notificationStore: store, isActive: true),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Unread'));
    await tester.pumpAndSettle();

    expect(requests.map((request) => request.url.queryParameters['cursor']),
        [null, 'cursor-1']);
    expect(find.byKey(const ValueKey('notification-card-older-unread')),
        findsOneWidget);
    expect(find.text('No unread notifications'), findsNothing);
  });

  testWidgets('Unread keeps filling after it is selected during initial load',
      (tester) async {
    final firstPage = Completer<http.Response>();
    final requests = <http.Request>[];
    final client = _client((request) async {
      requests.add(request);
      if (request.url.queryParameters['cursor'] == 'cursor-1') {
        return _page([_wireItem('initially-hidden-unread')], unreadCount: 1);
      }
      return firstPage.future;
    });
    final store = NotificationStore(apiClient: client, accessToken: 'token');
    addTearDown(store.close);

    await tester.pumpWidget(MaterialApp(
      home: NotificationsScreen(notificationStore: store, isActive: true),
    ));
    await tester.pump();
    await tester.tap(find.text('Unread'));
    await tester.pump();
    firstPage.complete(_page(
      [_wireItem('initially-hidden-read', unread: false)],
      nextCursor: 'cursor-1',
      unreadCount: 1,
    ));
    await tester.pumpAndSettle();

    expect(requests.map((request) => request.url.queryParameters['cursor']),
        [null, 'cursor-1']);
    expect(
      find.byKey(const ValueKey('notification-card-initially-hidden-unread')),
      findsOneWidget,
    );
  });

  testWidgets('Unread filling resumes after a page retry', (tester) async {
    final requests = <http.Request>[];
    final client = _client((request) async {
      requests.add(request);
      final cursor = request.url.queryParameters['cursor'];
      if (cursor == 'cursor-2') {
        return _page([_wireItem('after-retry-unread')], unreadCount: 1);
      }
      if (cursor == 'cursor-1') {
        if (requests.length == 2) {
          return http.Response('{"message":"offline"}', 503);
        }
        return _page(
          [_wireItem('retry-page-read', unread: false)],
          nextCursor: 'cursor-2',
          unreadCount: 1,
        );
      }
      return _page(
        [_wireItem('retry-first-page-read', unread: false)],
        nextCursor: 'cursor-1',
        unreadCount: 1,
      );
    });
    final store = NotificationStore(apiClient: client, accessToken: 'token');
    addTearDown(store.close);

    await tester.pumpWidget(MaterialApp(
      home: NotificationsScreen(notificationStore: store, isActive: true),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Unread'));
    await tester.pumpAndSettle();
    expect(find.text('Could not load notifications'), findsOneWidget);

    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();

    expect(requests.map((request) => request.url.queryParameters['cursor']),
        [null, 'cursor-1', 'cursor-1', 'cursor-2']);
    expect(find.byKey(const ValueKey('notification-card-after-retry-unread')),
        findsOneWidget);
  });

  testWidgets('retry after a failed refresh retries the first page',
      (tester) async {
    final requests = <http.Request>[];
    final client = _client((request) async {
      requests.add(request);
      if (request.url.queryParameters.containsKey('cursor')) {
        return _page([_wireItem('older-page')], unreadCount: 1);
      }
      if (requests.length == 1) {
        return _page(
          [_wireItem('first-page')],
          nextCursor: 'cursor-1',
          unreadCount: 1,
        );
      }
      if (requests.length == 2) {
        return http.Response('{"message":"offline"}', 503);
      }
      return _page([_wireItem('refreshed-first-page')], unreadCount: 1);
    });
    final store = NotificationStore(apiClient: client, accessToken: 'token');
    addTearDown(store.close);

    await tester.pumpWidget(MaterialApp(
      home: NotificationsScreen(notificationStore: store, isActive: true),
    ));
    await tester.pumpAndSettle();
    final refresh = tester
        .state<RefreshIndicatorState>(find.byType(RefreshIndicator))
        .show();
    await tester.pump();
    await tester.pumpAndSettle();
    await refresh;
    expect(find.text('Could not load notifications'), findsOneWidget);

    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();

    expect(
      requests.map((request) => request.url.queryParameters['cursor']),
      [null, null, null],
    );
    expect(
      find.byKey(const ValueKey('notification-card-refreshed-first-page')),
      findsOneWidget,
    );
  });

  testWidgets('actor text meets contrast on read and unread cards',
      (tester) async {
    final store = NotificationStore();
    addTearDown(store.close);
    store.mergePage(items: [
      _item('blue-accent', type: NotificationType.comment),
      _item('pink-accent', type: NotificationType.like),
      _item('green-accent', type: NotificationType.pollVote),
      _item('read-accent', unread: false, type: NotificationType.like),
    ], unreadCount: 3);

    await _showScreen(tester, store);

    for (final id in ['blue-accent', 'pink-accent', 'green-accent']) {
      final actor = tester.widget<Text>(
        find.byKey(ValueKey('notification-actor-$id')),
      );
      expect(
        _contrastRatio(actor.style!.color!, const Color(0xFFEEF4FF)),
        greaterThanOrEqualTo(4.5),
        reason: 'Unread actor text for $id must meet WCAG AA contrast.',
      );
    }
    final readActor = tester.widget<Text>(
      find.byKey(const ValueKey('notification-actor-read-accent')),
    );
    expect(
      _contrastRatio(readActor.style!.color!, Colors.white),
      greaterThanOrEqualTo(4.5),
    );
  });

  testWidgets(
      'groups items and exposes unread, time, contrast, and touch semantics',
      (tester) async {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day, 10);
    final yesterday = today.subtract(const Duration(days: 1));
    final earlier = today.subtract(const Duration(days: 2));
    final store = NotificationStore();
    addTearDown(store.close);
    store.mergePage(
      items: [
        _item('today', createdAt: today, type: NotificationType.comment),
        _item('yesterday', unread: false, createdAt: yesterday),
        _item('earlier', unread: false, createdAt: earlier),
      ],
      unreadCount: 1,
    );

    await _showScreen(tester, store);

    expect(find.text('Today'), findsOneWidget);
    expect(find.text('Yesterday'), findsOneWidget);
    expect(find.text('Earlier'), findsOneWidget);
    final cardSemantics = tester.widget<Semantics>(
      find.byKey(const ValueKey('notification-card-semantics-today')),
    );
    expect(
      cardSemantics.properties.label,
      'Alice commented on your poll, unread notification',
    );
    expect(find.byTooltip(_timestamp(today)), findsOneWidget);

    final card = find.byKey(const ValueKey('notification-card-today'));
    expect(tester.getSize(card).height, greaterThanOrEqualTo(44));
    final backgroundContainer = tester.widget<Container>(
      find.byKey(const ValueKey('notification-card-background-today')),
    );
    final background =
        (backgroundContainer.decoration! as BoxDecoration).color!;
    final title = tester.widget<RichText>(
      find.byKey(const ValueKey('notification-title-today')),
    );
    expect(_contrastRatio(title.text.style!.color!, background),
        greaterThanOrEqualTo(4.5));
    expect(
      tester.getSize(find.widgetWithText(ChoiceChip, 'All')).height,
      greaterThanOrEqualTo(44),
    );
  });

  testWidgets('announces initial loading and retries a failed first page',
      (tester) async {
    final firstResponse = Completer<http.Response>();
    var requests = 0;
    final client = _client((request) async {
      requests++;
      if (requests == 1) return firstResponse.future;
      return _page([_wireItem('recovered')], unreadCount: 1);
    });
    final store = NotificationStore(apiClient: client, accessToken: 'token');
    addTearDown(store.close);

    await tester.pumpWidget(MaterialApp(
      home: NotificationsScreen(notificationStore: store, isActive: true),
    ));
    await tester.pump();
    final loadingSemantics = tester.widget<Semantics>(
      find.byKey(const ValueKey('notifications-loading-semantics')),
    );
    expect(loadingSemantics.properties.label, 'Loading notifications');
    firstResponse.complete(http.Response('{"message":"offline"}', 503));
    await tester.pumpAndSettle();

    expect(find.text('Could not load notifications'), findsOneWidget);
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('notification-card-recovered')),
        findsOneWidget);
    expect(requests, 2);
  });

  testWidgets('empty state stays refreshable with pull-to-refresh',
      (tester) async {
    var requests = 0;
    final client = _client((_) async {
      requests++;
      return _page([], unreadCount: 0);
    });
    final store = NotificationStore(apiClient: client, accessToken: 'token');
    addTearDown(store.close);

    await tester.pumpWidget(MaterialApp(
      home: NotificationsScreen(notificationStore: store, isActive: true),
    ));
    await tester.pumpAndSettle();
    expect(find.text('No notifications yet'), findsOneWidget);
    expect(find.byType(RefreshIndicator), findsOneWidget);
    await tester.drag(find.byType(ListView), const Offset(0, 250));
    await tester.pumpAndSettle();
    expect(requests, 2);
  });

  testWidgets(
      'loads more with the server cursor and deduplicates overlapping ids',
      (tester) async {
    final requests = <http.Request>[];
    final nextPage = Completer<http.Response>();
    final client = _client((request) async {
      requests.add(request);
      if (request.url.queryParameters['cursor'] == 'cursor-1') {
        return nextPage.future;
      }
      return _page(
        List.generate(
          20,
          (index) => _wireItem(
            'page-$index',
            createdAt: DateTime.now().subtract(Duration(minutes: index)),
          ),
        ),
        nextCursor: 'cursor-1',
        unreadCount: 20,
      );
    });
    final store = NotificationStore(apiClient: client, accessToken: 'token');
    addTearDown(store.close);

    await tester.pumpWidget(MaterialApp(
      home: NotificationsScreen(notificationStore: store, isActive: true),
    ));
    await tester.pumpAndSettle();
    expect(store.state.nextCursor, 'cursor-1');

    await tester.drag(find.byType(ListView), const Offset(0, -4000));
    await tester.pump();
    expect(
        tester.state<ScrollableState>(find.byType(Scrollable)).position.pixels,
        greaterThan(0));
    expect(requests, hasLength(2));
    expect(find.byKey(const ValueKey('notifications-loading-more')),
        findsOneWidget);
    nextPage.complete(_page([
      _wireItem('page-0'),
      _wireItem('page-2',
          createdAt: DateTime.now().subtract(const Duration(days: 2))),
    ], unreadCount: 12));
    await tester.pumpAndSettle();

    expect(requests.map((request) => request.url.queryParameters['cursor']),
        [null, 'cursor-1']);
    expect(
        find.byKey(const ValueKey('notification-card-page-0')), findsOneWidget);
    expect(
        find.byKey(const ValueKey('notification-card-page-2')), findsOneWidget);
    expect(store.state.ids.where((id) => id == 'page-0'), hasLength(1));
  });

  testWidgets('pending banner materializes new items once and returns to top',
      (tester) async {
    final createdAt = DateTime.now();
    final items = List.generate(
      20,
      (index) => _item(
        'item-$index',
        createdAt: createdAt.subtract(Duration(minutes: index)),
      ),
    );
    final store = NotificationStore();
    addTearDown(store.close);
    store.mergePage(items: items, unreadCount: items.length);

    await tester.pumpWidget(MaterialApp(
      home: MediaQuery(
        data: const MediaQueryData(disableAnimations: true),
        child: NotificationsScreen(notificationStore: store),
      ),
    ));
    await tester.pumpAndSettle();
    await tester.drag(find.byType(ListView), const Offset(0, -1200));
    await tester.pumpAndSettle();
    expect(store.state.isInboxAtTop, isFalse);

    store.receiveNew(_item('incoming',
        createdAt: createdAt.add(const Duration(minutes: 1))));
    await tester.pump();
    expect(find.text('New notifications (1)'), findsOneWidget);
    expect(
        find.byKey(const ValueKey('notification-card-incoming')), findsNothing);

    await tester.tap(find.text('New notifications (1)'));
    await tester.pumpAndSettle();
    expect(store.state.pendingIds, isEmpty);
    expect(store.state.ids.where((id) => id == 'incoming'), hasLength(1));
    expect(find.byKey(const ValueKey('notification-card-incoming')),
        findsOneWidget);
    expect(
        tester.state<ScrollableState>(find.byType(Scrollable)).position.pixels,
        0);
  });

  testWidgets('new realtime items insert immediately when the inbox is at top',
      (tester) async {
    final store = NotificationStore();
    addTearDown(store.close);
    store.mergePage(items: [_item('older')], unreadCount: 1);
    await _showScreen(tester, store);

    store.receiveNew(_item('newer',
        createdAt: DateTime.now().add(const Duration(minutes: 1))));
    await tester.pump();

    expect(store.state.pendingIds, isEmpty);
    expect(store.state.ids.first, 'newer');
    expect(
        find.byKey(const ValueKey('notification-card-newer')), findsOneWidget);
  });

  testWidgets('read-all is explicit, optimistic, pending, then confirmed',
      (tester) async {
    final readAll = Completer<http.Response>();
    final client = _client((request) async {
      if (request.url.path.endsWith('/read-all')) return readAll.future;
      return http.Response('{}', 200);
    });
    final store = NotificationStore(apiClient: client, accessToken: 'token');
    addTearDown(store.close);
    store.mergePage(items: [_item('to-read')], unreadCount: 1);
    await _showScreen(tester, store);

    expect(store.state.itemsById['to-read']!.isUnread, isTrue);
    await tester.tap(find.byIcon(Icons.more_vert));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Mark all as read'));
    await tester.pump();

    expect(store.state.unreadCount, 0);
    expect(store.state.isMarkAllPending, isTrue);
    expect(find.byKey(const ValueKey('read-all-pending')), findsOneWidget);
    readAll.complete(http.Response(
      jsonEncode({
        'readAt': DateTime.now().toUtc().toIso8601String(),
        'updatedCount': 1,
        'unreadCount': 0,
      }),
      200,
    ));
    await tester.pumpAndSettle();
    expect(store.state.itemsById['to-read']!.isUnread, isFalse);
    expect(store.state.isMarkAllPending, isFalse);
    expect(find.byKey(const ValueKey('read-all-pending')), findsNothing);
  });

  testWidgets('read-all failure rolls back and can be retried', (tester) async {
    var calls = 0;
    final client = _client((request) async {
      if (request.url.path.endsWith('/read-all')) {
        calls++;
        if (calls == 1) return http.Response('{"message":"offline"}', 503);
        return http.Response(
          jsonEncode({
            'readAt': DateTime.now().toUtc().toIso8601String(),
            'updatedCount': 1,
            'unreadCount': 0,
          }),
          200,
        );
      }
      return http.Response('{}', 200);
    });
    final store = NotificationStore(apiClient: client, accessToken: 'token');
    addTearDown(store.close);
    store.mergePage(items: [_item('retry-read')], unreadCount: 1);
    await _showScreen(tester, store);

    await _openReadAllMenu(tester);
    await tester.pumpAndSettle();
    expect(find.text('Could not mark all as read'), findsOneWidget);
    expect(store.state.itemsById['retry-read']!.isUnread, isTrue);
    expect(store.state.unreadCount, 1);
    expect(calls, 1);

    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(calls, 2);
    expect(store.state.itemsById['retry-read']!.isUnread, isFalse);
    expect(store.state.unreadCount, 0);
  });

  testWidgets('tapping a notification reads only that card', (tester) async {
    final client = _client((request) async {
      if (request.url.path.endsWith('/first/read')) {
        return http.Response(
          jsonEncode({
            'notificationId': 'first',
            'readAt': DateTime.now().toUtc().toIso8601String(),
            'unreadCount': 1,
          }),
          200,
        );
      }
      return http.Response('{}', 200);
    });
    final store = NotificationStore(apiClient: client, accessToken: 'token');
    addTearDown(store.close);
    store.mergePage(items: [_item('first'), _item('second')], unreadCount: 2);
    await _showScreen(tester, store);

    await tester.tap(find.byKey(const ValueKey('notification-card-first')));
    await tester.pumpAndSettle();

    expect(store.state.itemsById['first']!.isUnread, isFalse);
    expect(store.state.itemsById['second']!.isUnread, isTrue);
    expect(store.state.unreadCount, 1);
  });
}

Future<void> _showScreen(
  WidgetTester tester,
  NotificationStore store, {
  bool isActive = false,
  MediaQueryData? mediaQueryData,
}) async {
  Widget screen = NotificationsScreen(
    notificationStore: store,
    isActive: isActive,
  );
  if (mediaQueryData != null) {
    screen = MediaQuery(data: mediaQueryData, child: screen);
  }
  await tester.pumpWidget(MaterialApp(home: screen));
  await tester.pumpAndSettle();
}

Future<void> _openReadAllMenu(WidgetTester tester) async {
  await tester.tap(find.byIcon(Icons.more_vert));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Mark all as read'));
}

NotificationsApiClient _client(
        Future<http.Response> Function(http.Request) handler) =>
    NotificationsApiClient(
      config: const ApiConfig(baseUrl: 'http://test'),
      httpClient: MockClient(handler),
    );

http.Response _page(
  List<Map<String, dynamic>> items, {
  String? nextCursor,
  required int unreadCount,
}) =>
    http.Response(
      jsonEncode({
        'items': items,
        'nextCursor': nextCursor,
        'unreadCount': unreadCount,
      }),
      200,
    );

Map<String, dynamic> _wireItem(
  String id, {
  String type = 'follow',
  DateTime? createdAt,
  bool unread = true,
}) {
  final isProfile = type == 'follow';
  final isComment = type == 'comment' || type == 'comment_reply';
  return {
    'id': id,
    'type': type,
    'actor': {
      'id': 'actor-$id',
      'username': 'alice',
      'displayName': 'Alice',
      'avatarUrl': null,
    },
    'targetType': isProfile ? 'profile' : (isComment ? 'comment' : 'poll'),
    'pollId': isProfile ? null : 'poll-$id',
    'commentId': isComment ? 'comment-$id' : null,
    'payload': <String, dynamic>{},
    'readAt': unread ? null : DateTime.utc(2026, 8, 1).toIso8601String(),
    'createdAt': (createdAt ?? DateTime.now()).toUtc().toIso8601String(),
    'isTargetAvailable': true,
  };
}

NotificationItem _item(
  String id, {
  bool unread = true,
  DateTime? createdAt,
  NotificationType type = NotificationType.follow,
}) {
  final targetType = type == NotificationType.follow
      ? NotificationTargetType.profile
      : (type == NotificationType.comment ||
              type == NotificationType.commentReply
          ? NotificationTargetType.comment
          : NotificationTargetType.poll);
  final hasComment = targetType == NotificationTargetType.comment;
  return NotificationItem(
    id: id,
    type: type,
    actor: const NotificationActor(
      id: 'actor-1',
      username: 'alice',
      displayName: 'Alice',
    ),
    target: NotificationTarget(
      type: targetType,
      pollId: targetType == NotificationTargetType.profile ? null : 'poll-$id',
      commentId: hasComment ? 'comment-$id' : null,
    ),
    payload: const <String, dynamic>{},
    readAt: unread ? null : DateTime.utc(2026, 8, 1),
    createdAt: createdAt ?? DateTime.now(),
    isTargetAvailable: true,
  );
}

String _timestamp(DateTime value) {
  final local = value.toLocal();
  return '${local.day.toString().padLeft(2, '0')}.${local.month.toString().padLeft(2, '0')}.${local.year} '
      '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
}

double _contrastRatio(Color first, Color second) {
  final a = first.computeLuminance();
  final b = second.computeLuminance();
  final lighter = a > b ? a : b;
  final darker = a > b ? b : a;
  return (lighter + 0.05) / (darker + 0.05);
}
