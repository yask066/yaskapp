import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/core/analytics/pagination_analytics.dart';
import 'package:yaskapp_mobile/src/core/pagination/cursor_list_controller.dart';
import 'package:yaskapp_mobile/src/core/pagination/cursor_page.dart';

class _Item {
  const _Item(this.id);

  final String id;
}

void main() {
  test('analytics sink rejects unsafe sort and error metadata', () {
    final events = <Map<String, Object?>>[];
    PaginationAnalytics(sink: events.add).emit(const PaginationAnalyticsEvent(
      event: 'pagination.failure',
      surface: PaginationSurface.comments,
      sort: 'RAW_CURSOR_CANARY',
      pageNumber: 2,
      durationMs: 4,
      itemCount: 0,
      errorCode: 'COMMENT_BODY_CANARY',
      requestId: 'e5b2e8b1-f4c8-44ba-a25f-a63d60058128',
    ));

    expect(events.single['sort'], isNull);
    expect(events.single['errorCode'], 'request_failed');
    expect(events.toString(), isNot(contains('RAW_CURSOR_CANARY')));
    expect(events.toString(), isNot(contains('COMMENT_BODY_CANARY')));
  });

  test(
      'pagination controller emits safe fields and never logs request payloads',
      () async {
    final events = <Map<String, Object?>>[];
    final analytics = PaginationAnalytics(sink: events.add);
    final controller = CursorListController<_Item>(
      contextKey: 'comments:poll-1:newest',
      surface: PaginationSurface.comments,
      sort: 'newest',
      analytics: analytics,
      trackedLoader: (
          {required limit,
          cursor,
          required requestId,
          required pageNumber,
          required action}) async {
        expect(requestId, isNotEmpty);
        expect(pageNumber, cursor == null ? 1 : 2);
        if (cursor == null) {
          return const CursorPage<_Item>(
            items: [_Item('root-1')],
            nextCursor: 'RAW_CURSOR_CANARY',
          );
        }
        throw StateError('COMMENT_BODY_CANARY AUTH_HEADER_CANARY');
      },
      extractId: (item) => item.id,
    );

    await controller.loadInitial();
    await controller.loadMore();

    final serialized = events.toString();
    expect(serialized, isNot(contains('RAW_CURSOR_CANARY')));
    expect(serialized, isNot(contains('COMMENT_BODY_CANARY')));
    expect(serialized, isNot(contains('AUTH_HEADER_CANARY')));
    expect(events.map((event) => event['event']), [
      'pagination.start',
      'pagination.success',
      'pagination.start',
      'pagination.failure',
    ]);
    expect(
        events.first.keys,
        containsAll([
          'surface',
          'sort',
          'pageNumber',
          'durationMs',
          'itemCount',
          'errorCode',
          'requestId',
        ]));
    expect(events.first['pageNumber'], 1);
    expect(events[1]['itemCount'], 1);
    expect(events[3]['pageNumber'], 2);
    controller.dispose();
  });

  test(
      'late append completion does not emit success after refresh changes generation',
      () async {
    final events = <Map<String, Object?>>[];
    final pendingAppend = Completer<CursorPage<_Item>>();
    final appendStarted = Completer<void>();
    final analytics = PaginationAnalytics(sink: events.add);
    var firstPageReads = 0;
    final controller = CursorListController<_Item>(
      contextKey: 'feed:guest:newest',
      surface: PaginationSurface.feed,
      sort: 'newest',
      analytics: analytics,
      trackedLoader: (
          {required limit,
          cursor,
          required requestId,
          required pageNumber,
          required action}) {
        if (cursor == null) {
          firstPageReads++;
          return Future.value(CursorPage<_Item>(
            items: [_Item('poll-$firstPageReads')],
            nextCursor: firstPageReads == 1 ? 'append-cursor' : null,
          ));
        }
        appendStarted.complete();
        return pendingAppend.future;
      },
      extractId: (item) => item.id,
    );

    await controller.loadInitial();
    final append = controller.loadMore();
    await appendStarted.future;
    await controller.refresh();
    final eventsBeforeLateCompletion = events.length;
    pendingAppend.complete(const CursorPage<_Item>(
      items: [_Item('stale-poll')],
      nextCursor: null,
    ));
    await append;

    expect(controller.state.ids, ['poll-2']);
    expect(
        events.skip(eventsBeforeLateCompletion).map((event) => event['event']),
        isEmpty);
    controller.dispose();
  });
}
