import 'dart:convert';
import 'dart:ui' show FramePhase, FrameTiming;

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:yaskapp_mobile/src/core/pagination/cursor_list_controller.dart';
import 'package:yaskapp_mobile/src/core/pagination/cursor_page.dart';
import 'package:yaskapp_mobile/src/core/scroll/list_scroll_anchor_host.dart';
import 'package:yaskapp_mobile/src/core/scroll/list_scroll_state.dart';
import 'package:yaskapp_mobile/src/core/config/api_config.dart';
import 'package:yaskapp_mobile/src/features/auth/auth_session.dart';
import 'package:yaskapp_mobile/src/features/feed/feed_screen.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_comments_screen.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_state_scope.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_state_store.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_summary.dart';
import 'package:yaskapp_mobile/src/features/polls/polls_api_client.dart';
import 'package:yaskapp_mobile/src/features/realtime/realtime_client.dart';
import 'package:yaskapp_mobile/src/performance/ac12_frame_timing_probe.dart';

const _viewerId = 't27-device-fixture-user';
const _accessToken = 't27-device-fixture-token';
const _pollId = 't27-device-poll-0001';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  Ac12FrameTimingProbe.install();
  runApp(const _T27ProfileApp());
}

class _T27ProfileApp extends StatefulWidget {
  const _T27ProfileApp();

  @override
  State<_T27ProfileApp> createState() => _T27ProfileAppState();
}

class _T27ProfileAppState extends State<_T27ProfileApp> {
  final _api = _T27FixturePollsApiClient();
  final _realtime = _T27NoopRealtimeClient();
  late PollStateStore _pollStateStore;
  final Map<String, List<Map<String, int>>> _frameSamples = {};
  _T27Scenario _scenario = _T27Scenario.home;
  String? _activeScenario;
  int _lifecycleCycle = 0;

  @override
  void initState() {
    super.initState();
    _pollStateStore = PollStateStore(viewerId: _viewerId);
    WidgetsBinding.instance.addTimingsCallback(_captureFrameTimings);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeTimingsCallback(_captureFrameTimings);
    _api.close();
    _realtime.close();
    _pollStateStore.dispose();
    super.dispose();
  }

  void _captureFrameTimings(List<FrameTiming> timings) {
    final scenario = _activeScenario;
    if (scenario == null) return;
    final samples = _frameSamples.putIfAbsent(scenario, () => []);
    samples.addAll(timings.map((timing) => {
          'frame': timing.frameNumber,
          'rasterFinishWallUs':
              timing.timestampInMicroseconds(FramePhase.rasterFinishWallTime),
          'buildDurationUs': timing.buildDuration.inMicroseconds,
          'rasterDurationUs': timing.rasterDuration.inMicroseconds,
          'totalSpanUs': timing.totalSpan.inMicroseconds,
        }));
  }

  void _selectScenario(_T27Scenario next) {
    if (next == _T27Scenario.home) {
      _finishScenario();
      setState(() {
        _activeScenario = null;
        _scenario = next;
      });
      return;
    }
    _api.workloadCount = switch (next) {
      _T27Scenario.feed100 || _T27Scenario.commentsRoots100 => 100,
      _ => 1000,
    };
    _pollStateStore.dispose();
    _pollStateStore = PollStateStore(viewerId: _viewerId);
    final name = next == _T27Scenario.lifecycle
        ? 'lifecycleCycle${++_lifecycleCycle}'
        : next.name;
    _frameSamples[name] = [];
    _activeScenario = name;
    // ignore: avoid_print
    print('T27_ANDROID_SCENARIO_BEGIN $name');
    setState(() => _scenario = next);
  }

  void _finishScenario() {
    final name = _activeScenario;
    if (name == null) return;
    _activeScenario = null;
    final samples = _frameSamples[name] ?? const <Map<String, int>>[];
    final spans = samples.map((sample) => sample['totalSpanUs']!).toList()
      ..sort();
    final missed = spans.where((span) => span > 16670).length;
    final summary = <String, Object>{
      'scenario': name,
      'frameCount': spans.length,
      'framesOver16670us': missed,
      'overBudgetPercent': spans.isEmpty ? 0 : missed * 100 / spans.length,
      'p95TotalSpanUs':
          spans.isEmpty ? 0 : spans[(spans.length * .95).ceil() - 1],
      'maxTotalSpanUs': spans.isEmpty ? 0 : spans.last,
    };
    // Keep output records small enough for Android logcat and retain every
    // raw frame measurement for the evidence file.
    for (var start = 0; start < samples.length; start += 6) {
      final end = (start + 6).clamp(0, samples.length);
      // ignore: avoid_print
      print('T27_ANDROID_FRAME_BATCH ${jsonEncode({
            'scenario': name,
            'frames': samples.sublist(start, end),
          })}');
    }
    // ignore: avoid_print
    print('T27_ANDROID_SCENARIO_RESULT ${jsonEncode(summary)}');
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'T27 Android Profile Fixture',
      theme: ThemeData(useMaterial3: true),
      home: Scaffold(
        appBar: AppBar(
          title: Text(switch (_scenario) {
            _T27Scenario.home => 'T27 Android Profile',
            _T27Scenario.feed100 => 'Feed · 100 fixture polls',
            _T27Scenario.feed => 'Feed · 1,000 fixture polls',
            _T27Scenario.commentsRoots100 => 'Comments · 100 roots',
            _T27Scenario.commentsRoots => 'Comments · 1,000 roots',
            _T27Scenario.commentsBranches => 'Comments · 3 branches',
            _T27Scenario.lifecycle => 'Lifecycle · cycle $_lifecycleCycle',
            _T27Scenario.anchor => 'Scroll anchor · device',
          }),
          actions: [
            TextButton(
              key: const ValueKey('t27-home-button'),
              onPressed: () => _selectScenario(_T27Scenario.home),
              child: const Text('Home'),
            ),
          ],
        ),
        body: switch (_scenario) {
          _T27Scenario.home => _buildHome(),
          _T27Scenario.feed => PollStateScope(
              store: _pollStateStore,
              child: FeedScreen(
                key: const ValueKey('t27-feed-screen'),
                session: _fixtureSession,
                pollsApiClient: _api,
                realtimeClient: _realtime,
              ),
            ),
          _T27Scenario.feed100 => PollStateScope(
              store: _pollStateStore,
              child: FeedScreen(
                key: const ValueKey('t27-feed-100-screen'),
                session: _fixtureSession,
                pollsApiClient: _api,
                realtimeClient: _realtime,
              ),
            ),
          _T27Scenario.commentsRoots => _buildComments(),
          _T27Scenario.commentsRoots100 => _buildComments(),
          _T27Scenario.commentsBranches => _buildComments(),
          _T27Scenario.lifecycle => _T27LifecycleScenario(
              key: ValueKey('t27-lifecycle-$_lifecycleCycle'),
              cycle: _lifecycleCycle,
            ),
          _T27Scenario.anchor => const _T27AnchorScenario(),
        },
      ),
    );
  }

  Widget _buildComments() => PollStateScope(
        store: _pollStateStore,
        child: PollCommentsScreen(
          key: ValueKey('t27-comments-${_scenario.name}'),
          poll: _profilePoll,
          accessToken: _accessToken,
          currentUserId: _viewerId,
          pollsApiClient: _api,
        ),
      );

  Widget _buildHome() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'All data is synthetic and served by an in-process MockClient. '
              'This profile fixture makes no network or account requests.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            FilledButton(
              key: const ValueKey('t27-open-feed-100'),
              onPressed: () => _selectScenario(_T27Scenario.feed100),
              child: const Text('Profile feed · 100 polls'),
            ),
            const SizedBox(height: 12),
            FilledButton(
              key: const ValueKey('t27-open-feed'),
              onPressed: () => _selectScenario(_T27Scenario.feed),
              child: const Text('Profile feed · 1,000 polls'),
            ),
            const SizedBox(height: 12),
            FilledButton(
              key: const ValueKey('t27-open-comments-100'),
              onPressed: () => _selectScenario(_T27Scenario.commentsRoots100),
              child: const Text('Profile comments · 100 roots'),
            ),
            const SizedBox(height: 12),
            FilledButton(
              key: const ValueKey('t27-open-comments'),
              onPressed: () => _selectScenario(_T27Scenario.commentsRoots),
              child: const Text('Profile comments · 1,000 roots'),
            ),
            const SizedBox(height: 12),
            FilledButton(
              key: const ValueKey('t27-open-comment-branches'),
              onPressed: () => _selectScenario(_T27Scenario.commentsBranches),
              child: const Text('Profile comments · 3 branches'),
            ),
            const SizedBox(height: 12),
            FilledButton(
              key: const ValueKey('t27-open-lifecycle'),
              onPressed: () => _selectScenario(_T27Scenario.lifecycle),
              child: const Text('Lifecycle · 10 pages'),
            ),
            const SizedBox(height: 12),
            FilledButton(
              key: const ValueKey('t27-open-anchor'),
              onPressed: () => _selectScenario(_T27Scenario.anchor),
              child: const Text('Measure scroll anchor'),
            ),
          ],
        ),
      ),
    );
  }
}

enum _T27Scenario {
  home,
  feed100,
  feed,
  commentsRoots100,
  commentsRoots,
  commentsBranches,
  lifecycle,
  anchor,
}

class _T27CycleItem {
  const _T27CycleItem(this.id);

  final String id;
}

class _T27LifecycleScenario extends StatefulWidget {
  const _T27LifecycleScenario({required this.cycle, super.key});

  final int cycle;

  @override
  State<_T27LifecycleScenario> createState() => _T27LifecycleScenarioState();
}

class _T27LifecycleScenarioState extends State<_T27LifecycleScenario> {
  late final CursorListController<_T27CycleItem> _controller;
  late final VoidCallback _listener;
  var _requests = 0;
  var _activeRequests = 0;
  var _listenerCalls = 0;
  var _listenerRemoved = false;
  var _loaded = false;
  var _loadDurationMs = 0;

  @override
  void initState() {
    super.initState();
    _controller = CursorListController<_T27CycleItem>(
      contextKey: 't27:lifecycle:${widget.cycle}',
      trackedLoader: ({
        required limit,
        cursor,
        required requestId,
        required pageNumber,
        required action,
      }) async {
        _requests++;
        _activeRequests++;
        try {
          await Future<void>.delayed(const Duration(milliseconds: 8));
          final page = cursor == null ? 1 : int.parse(cursor);
          return CursorPage(
            items: List.generate(
              20,
              (index) => _T27CycleItem('cycle-${widget.cycle}-p$page-i$index'),
              growable: false,
            ),
            nextCursor: page < 10 ? '${page + 1}' : null,
          );
        } finally {
          _activeRequests--;
        }
      },
      extractId: (item) => item.id,
    );
    _listener = () => _listenerCalls++;
    _controller.addListener(_listener);
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadTenPages());
  }

  Future<void> _loadTenPages() async {
    final stopwatch = Stopwatch()..start();
    await _controller.loadInitial();
    for (var page = 2; page <= 10; page++) {
      await _controller.loadMore();
    }
    stopwatch.stop();
    _loadDurationMs = stopwatch.elapsedMilliseconds;
    _loaded = true;
    if (mounted) setState(() {});
    // ignore: avoid_print
    print('T27_ANDROID_LIFECYCLE_LOADED ${jsonEncode({
          'cycle': widget.cycle,
          'pages': _controller.state.pages.length,
          'items': _controller.state.items.length,
          'requests': _requests,
          'activeRequests': _activeRequests,
          'durationMs': _loadDurationMs,
        })}');
  }

  @override
  void dispose() {
    final retainedItemsBeforeDispose = _controller.state.items.length;
    _controller.removeListener(_listener);
    _listenerRemoved = true;
    _controller.dispose();
    // ignore: avoid_print
    print('T27_ANDROID_LIFECYCLE_EXIT ${jsonEncode({
          'cycle': widget.cycle,
          'loadedTenPages': _loaded && _requests == 10,
          'requests': _requests,
          'activeRequestsAtExit': _activeRequests,
          'listenerCalls': _listenerCalls,
          'listenersAfterRemoval': _listenerRemoved ? 0 : 1,
          'retainedItemsBeforeDispose': retainedItemsBeforeDispose,
          'retainedItemsAfterDispose': _controller.state.items.length,
        })}');
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = _controller.state;
    return Scaffold(
      backgroundColor: const Color(0xFFF7F8FC),
      body: Center(
        child: Text(
          _loaded
              ? 'Cycle ${widget.cycle}: ${state.pages.length} pages · ${state.items.length} items\nExit with Home, then open the next cycle.'
              : 'Cycle ${widget.cycle}: loading 10 fixture pages…',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.headlineSmall,
        ),
      ),
    );
  }
}

class _T27AnchorScenario extends StatefulWidget {
  const _T27AnchorScenario();

  @override
  State<_T27AnchorScenario> createState() => _T27AnchorScenarioState();
}

class _T27AnchorScenarioState extends State<_T27AnchorScenario> {
  static final _ids = List<String>.generate(
    32,
    (index) => 'anchor-item-$index',
    growable: false,
  );
  static const _context = ListScrollContext(
    userId: _viewerId,
    route: '/t27-anchor-probe',
    list: 'items',
    query: '',
    filter: '',
    sort: 'newest',
  );

  final _controller = ScrollController();
  final _store = ListScrollStateStore();
  final _anchorKey = GlobalKey();
  var _mediaHeight = 1300.0;
  double? _beforeTop;
  double? _afterTop;
  bool _running = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _measureAnchor());
  }

  double? _anchorTop() {
    final object = _anchorKey.currentContext?.findRenderObject();
    if (object is! RenderBox || !object.attached) return null;
    return object.localToGlobal(Offset.zero).dy;
  }

  Future<void> _measureAnchor() async {
    if (!_controller.hasClients || !mounted) return;
    _controller.jumpTo(1100);
    WidgetsBinding.instance.scheduleFrame();
    await WidgetsBinding.instance.endOfFrame;
    for (var attempt = 0;
        attempt < 5 && _store.read(_context) == null;
        attempt++) {
      WidgetsBinding.instance.scheduleFrame();
      await WidgetsBinding.instance.endOfFrame;
    }
    final before = _anchorTop();
    if (before == null || !mounted) return;
    final savedAnchor = _store.read(_context);
    if (savedAnchor == null) {
      throw StateError('The initial scroll anchor was not captured.');
    }
    // ignore: avoid_print
    print('T27_ANDROID_ANCHOR_BASELINE ${jsonEncode({
          'savedAnchorId': savedAnchor.id,
          'savedAnchorTopLogicalPx': savedAnchor.top,
          'revision': _store.revisionFor(_context),
          'scrollOffsetLogicalPx': _controller.offset,
        })}');
    setState(() {
      _beforeTop = before;
      _running = true;
      _mediaHeight += 96;
    });
    await WidgetsBinding.instance.endOfFrame;
    await Future<void>.delayed(const Duration(milliseconds: 250));
    await WidgetsBinding.instance.endOfFrame;
    final after = _anchorTop();
    if (after == null || !mounted) return;
    final delta = (after - before).abs();
    final savedAfter = _store.read(_context);
    // ignore: avoid_print
    print('T27_ANDROID_ANCHOR_AFTER ${jsonEncode({
          'scrollOffsetLogicalPx': _controller.offset,
          'maxScrollExtentLogicalPx': _controller.position.maxScrollExtent,
          'savedAnchorId': savedAfter?.id,
          'savedAnchorTopLogicalPx': savedAfter?.top,
          'globalAnchorTopLogicalPx': after,
        })}');
    // ignore: avoid_print
    print('T27_ANDROID_ANCHOR_RESULT ${jsonEncode({
          'beforeTopLogicalPx': before,
          'afterTopLogicalPx': after,
          'driftLogicalPx': delta,
          'thresholdLogicalPx': 8,
          'passed': delta <= 8,
          'mediaGrowthLogicalPx': 96,
        })}');
    setState(() {
      _afterTop = after;
      _running = false;
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: NotificationListener<ScrollMetricsNotification>(
        onNotification: (notification) {
          // ignore: avoid_print
          print(
              'T27_ANDROID_ANCHOR_METRICS depth=${notification.depth} max=${notification.metrics.maxScrollExtent}');
          return false;
        },
        child: ListScrollAnchorHost(
          context: _context,
          store: _store,
          controller: _controller,
          itemIds: _ids,
          child: CustomScrollView(
            controller: _controller,
            slivers: [
              SliverToBoxAdapter(
                child: SizedBox(
                  height: _mediaHeight,
                  child: const Center(
                    child: Text('Unanchored media placeholder above the list'),
                  ),
                ),
              ),
              SliverList(
                delegate: SliverChildBuilderDelegate(
                  (context, index) => ListScrollAnchorItem(
                    id: _ids[index],
                    child: SizedBox(
                      key: index == 0 ? _anchorKey : null,
                      height: 160,
                      child: Center(child: Text(_ids[index])),
                    ),
                  ),
                  childCount: _ids.length,
                ),
              ),
            ],
          ),
        ),
      ),
      floatingActionButton: Text(
        _afterTop == null
            ? (_running ? 'Measuring…' : 'Preparing…')
            : 'Drift: ${(_afterTop! - _beforeTop!).abs().toStringAsFixed(1)} logical px',
      ),
    );
  }
}

class _T27FixturePollsApiClient extends PollsApiClient {
  _T27FixturePollsApiClient()
      : super(
          config: const ApiConfig(baseUrl: 'http://fixture.invalid'),
          httpClient: MockClient((_) async => http.Response('{}', 500)),
        );

  int workloadCount = 1000;

  static final _polls = List<PollSummary>.generate(
    1000,
    (index) => PollSummary(
      id: 't27-device-poll-${(index + 1).toString().padLeft(4, '0')}',
      author: const PollAuthorSummary(
        id: _viewerId,
        username: 't27-fixture',
        displayName: 'T27 Fixture',
      ),
      question:
          'T27 Android synthetic poll ${index + 1}: choose an option for this profile workload.',
      options: [
        PollOptionSummary(
          id: 't27-device-option-a-${index + 1}',
          text: 'Option A',
          position: 0,
          votesCount: 12,
        ),
        PollOptionSummary(
          id: 't27-device-option-b-${index + 1}',
          text: 'Option B',
          position: 1,
          votesCount: 8,
        ),
      ],
      votesCount: 20,
      commentsCount: 1000,
      likesCount: index % 31,
      viewerHasLiked: false,
      allowVoteCancellation: true,
      createdAt: DateTime.utc(2026, 10, 1).subtract(Duration(minutes: index)),
    ),
    growable: false,
  );

  static final _roots = List<PollCommentSummary>.generate(
    1000,
    (index) => _comment(index, parentCommentId: null),
    growable: false,
  );

  @override
  Future<CursorPage<PollSummary>> listPollsPage({
    int limit = 20,
    String sort = 'newest',
    String? cursor,
    String? accessToken,
    String? requestId,
    int? pageNumber,
    String? paginationAction,
  }) async {
    // Return the complete deterministic workload to profile row construction
    // and scrolling independently of any API or pagination service.
    return CursorPage(
      items: _polls.take(workloadCount).toList(growable: false),
      nextCursor: null,
    );
  }

  @override
  Future<CursorPage<PollCommentSummary>> listCommentsPage({
    required String pollId,
    int limit = 20,
    String order = 'newest',
    String? cursor,
    String? accessToken,
    String? requestId,
    int? pageNumber,
    String? paginationAction,
  }) async =>
      CursorPage(
        items: _roots.take(workloadCount).toList(growable: false),
        nextCursor: null,
      );

  @override
  Future<PollCommentRepliesPage> listCommentReplies({
    required String pollId,
    required String rootCommentId,
    int limit = 20,
    String? cursor,
    String? accessToken,
    String? requestId,
    int? pageNumber,
    String? paginationAction,
  }) async =>
      PollCommentRepliesPage(
        items: List<PollCommentSummary>.generate(
          65,
          (index) => _comment(
            index,
            parentCommentId: rootCommentId,
            reply: true,
          ),
          growable: false,
        ),
        nextCursor: null,
      );
}

class _T27NoopRealtimeClient extends RealtimeClient {
  _T27NoopRealtimeClient()
      : super(
          config: const ApiConfig(websocketUrl: 'ws://fixture.invalid'),
          accessToken: _accessToken,
        );

  @override
  void connect() {}

  @override
  Future<void> close() async {}
}

PollCommentSummary _comment(
  int index, {
  required String? parentCommentId,
  bool reply = false,
}) {
  final id = reply
      ? '$parentCommentId-reply-${index + 1}'
      : 't27-device-root-${(index + 1).toString().padLeft(4, '0')}';
  return PollCommentSummary(
    id: id,
    pollId: _pollId,
    author: const PollAuthorSummary(
      id: _viewerId,
      username: 't27-fixture',
      displayName: 'T27 Fixture',
    ),
    body: reply
        ? 'T27 Android synthetic reply ${index + 1}: deterministic row data for scrolling.'
        : 'T27 Android synthetic root ${index + 1}: deterministic row data for scrolling and profile timing.',
    likesCount: index % 23,
    parentCommentId: parentCommentId,
    repliesCount: reply ? 0 : 65,
    createdAt: DateTime.utc(2026, 10, 2).subtract(Duration(minutes: index)),
    updatedAt: DateTime.utc(2026, 10, 2).subtract(Duration(minutes: index)),
  );
}

const _fixtureSession = AuthSession(
  user: AuthUser(
    id: _viewerId,
    email: 't27-fixture@example.invalid',
    username: 't27-fixture',
    status: 'active',
    profile: AuthUserProfile(
      displayName: 'T27 Fixture',
      pollsCount: 0,
      followersCount: 0,
      followingCount: 0,
    ),
  ),
  accessToken: _accessToken,
  tokenType: 'Bearer',
  expiresIn: 'fixture',
);

final _profilePoll = _T27FixturePollsApiClient._polls.first;
