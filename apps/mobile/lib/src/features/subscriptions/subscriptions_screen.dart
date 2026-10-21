import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/motion/entry_motion.dart';
import '../../core/pagination/cursor_list_controller.dart';
import '../../core/pagination/cursor_page.dart';
import '../../core/scroll/list_scroll_anchor_host.dart';
import '../../core/scroll/list_scroll_state.dart';
import '../../core/widgets/content_skeleton.dart';
import '../../core/widgets/pagination_footer.dart';
import '../auth/auth_session.dart';
import '../polls/poll_card.dart';
import '../polls/poll_comments_screen.dart';
import '../polls/poll_summary.dart';
import '../polls/polls_api_client.dart';
import '../polls/poll_state_scope.dart';
import '../polls/poll_state_store.dart';
import '../realtime/realtime_client.dart';
import '../reports/report_dialog.dart';
import '../reports/reports_api_client.dart';

class SubscriptionsScreen extends StatefulWidget {
  const SubscriptionsScreen({
    required this.session,
    super.key,
    PollsApiClient? pollsApiClient,
    RealtimeClient? realtimeClient,
    ReportsApiClient? reportsApiClient,
    this.isActive = true,
  })  : _pollsApiClient = pollsApiClient,
        _realtimeClient = realtimeClient,
        _reportsApiClient = reportsApiClient;

  final AuthSession session;
  final PollsApiClient? _pollsApiClient;
  final RealtimeClient? _realtimeClient;
  final ReportsApiClient? _reportsApiClient;
  final bool isActive;

  @override
  State<SubscriptionsScreen> createState() => _SubscriptionsScreenState();
}

class _SubscriptionsScreenState extends State<SubscriptionsScreen> {
  late final PollsApiClient _pollsApiClient;
  late final RealtimeClient _realtimeClient;
  late final bool _ownsPollsApiClient;
  late final bool _ownsRealtimeClient;
  late final ReportsApiClient _reportsApiClient;
  late final bool _ownsReportsApiClient;
  late CursorListController<PollSummary> _pollsController;
  PollStateStore? _pollStateStore;
  StreamSubscription<PollVoteRealtimeEvent>? _voteSubscription;
  StreamSubscription<PollDeletedRealtimeEvent>? _pollDeletedSubscription;
  List<PollSummary> _polls = [];
  final _scrollController = ScrollController();
  var _observedFollowingGeneration = 0;
  var _followingRefreshPending = false;
  var _followingRefreshInFlight = false;
  final Set<String> _votingPollIds = {};
  final Set<String> _likingPollIds = {};

  @override
  void initState() {
    super.initState();
    _ownsPollsApiClient = widget._pollsApiClient == null;
    _ownsRealtimeClient = widget._realtimeClient == null;
    _ownsReportsApiClient = widget._reportsApiClient == null;
    _pollsApiClient = widget._pollsApiClient ?? PollsApiClient();
    _realtimeClient = widget._realtimeClient ??
        RealtimeClient(accessToken: widget.session.accessToken);
    _reportsApiClient = widget._reportsApiClient ?? ReportsApiClient();
    _scrollController.addListener(_handleScroll);
    _createPaginationController();
    if (widget.isActive) {
      unawaited(_pollsController.loadInitial());
    } else {
      _pollsController.markInactive();
    }
    _voteSubscription = _realtimeClient.pollVotes.listen(_replacePoll);
    _pollDeletedSubscription =
        _realtimeClient.pollDeletions.listen(_removePoll);
    _realtimeClient.connect();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final nextStore = PollStateScope.readOf(context);
    if (identical(nextStore, _pollStateStore)) return;
    _pollStateStore?.removeListener(_handlePollStateChanged);
    _pollStateStore = nextStore;
    _observedFollowingGeneration = nextStore?.followingGeneration ?? 0;
    nextStore?.addListener(_handlePollStateChanged);
  }

  @override
  void didUpdateWidget(covariant SubscriptionsScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    final sessionChanged =
        oldWidget.session.user.id != widget.session.user.id ||
            oldWidget.session.accessToken != widget.session.accessToken;
    if (sessionChanged) {
      _pollsController.removeListener(_handlePaginationChanged);
      _pollsController.dispose();
      _polls = [];
      _followingRefreshPending = false;
      _createPaginationController();
    }

    if (oldWidget.isActive != widget.isActive || sessionChanged) {
      if (widget.isActive) {
        _pollsController.markActive();
        if (_followingRefreshPending) {
          _followingRefreshPending = false;
          unawaited(_refreshFollowing());
        } else if (_pollsController.state.pages.isEmpty &&
            !_pollsController.state.initial.pending &&
            _pollsController.state.initial.error == null) {
          unawaited(_pollsController.loadInitial());
        }
      } else {
        _pollsController.markInactive();
      }
    }
  }

  void _createPaginationController() {
    _pollsController = CursorListController<PollSummary>(
      contextKey: 'subscriptions:${widget.session.user.id}:following',
      loader: _loadSubscriptionPage,
      extractId: (poll) => poll.id,
      onInactiveExpired: () {
        listScrollStateStore.clearForContext(_scrollContext);
        if (_scrollController.hasClients) _scrollController.jumpTo(0);
      },
    );
    _pollsController.addListener(_handlePaginationChanged);
  }

  ListScrollContext get _scrollContext => ListScrollContext(
        userId: widget.session.user.id,
        route: '/subscriptions',
        list: 'polls',
        query: '',
        filter: '',
        sort: '',
      );

  Future<CursorPage<PollSummary>> _loadSubscriptionPage({
    required int limit,
    String? cursor,
  }) {
    return _pollsApiClient
        .listSubscriptionsPage(
          accessToken: widget.session.accessToken,
          limit: limit,
          cursor: cursor,
        )
        .timeout(const Duration(seconds: 10));
  }

  List<PollSummary> _visiblePolls() {
    final store = _pollStateStore;
    final visibleById = <String, PollSummary>{};
    for (final poll in _pollsController.state.items) {
      if (store?.isDeleted(poll.id) ?? false) continue;
      visibleById.putIfAbsent(poll.id, () => store?.pollById(poll.id) ?? poll);
    }
    return visibleById.values.toList();
  }

  void _handlePaginationChanged() {
    if (!mounted) return;
    setState(() => _polls = _visiblePolls());
    _scheduleViewportAppend();
    if (_followingRefreshPending &&
        !_followingRefreshInFlight &&
        widget.isActive &&
        !_pollsController.state.refresh.pending) {
      _followingRefreshPending = false;
      unawaited(_refreshFollowing());
    }
  }

  void _scheduleViewportAppend() {
    if (!widget.isActive) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _handleScroll();
    });
  }

  void _handleScroll() {
    if (!widget.isActive || !_scrollController.hasClients) return;
    if (_scrollController.position.extentAfter <= 400) {
      unawaited(_pollsController.loadMore(automatic: true));
    }
  }

  void _handleScrollMetrics(ScrollMetrics metrics) {
    if (widget.isActive && metrics.extentAfter <= 400) _handleScroll();
  }

  void _handlePollStateChanged() {
    final nextGeneration = _pollStateStore?.followingGeneration ?? 0;
    final followingChanged = nextGeneration != _observedFollowingGeneration;
    _observedFollowingGeneration = nextGeneration;
    final store = _pollStateStore;
    if (mounted && store != null) {
      final visible =
          _polls.where((poll) => !store.isDeleted(poll.id)).toList();
      if (visible.length != _polls.length) setState(() => _polls = visible);
    }
    if (!followingChanged) return;
    if (widget.isActive) {
      unawaited(_refreshFollowing());
    } else {
      _followingRefreshPending = true;
    }
  }

  Future<void> _refreshFollowing() async {
    if (_followingRefreshInFlight || _pollsController.state.refresh.pending) {
      _followingRefreshPending = true;
      return;
    }

    _followingRefreshInFlight = true;
    try {
      await _pollsController.refresh();
      if (_pollsController.state.refresh.error != null && mounted) {
        _showError('Could not refresh subscriptions.');
      }
    } finally {
      _followingRefreshInFlight = false;
      if (_followingRefreshPending && widget.isActive && mounted) {
        _followingRefreshPending = false;
        unawaited(_refreshFollowing());
      }
    }
  }

  @override
  void dispose() {
    unawaited(_voteSubscription?.cancel());
    unawaited(_pollDeletedSubscription?.cancel());
    _pollStateStore?.removeListener(_handlePollStateChanged);
    _pollsController.removeListener(_handlePaginationChanged);
    _pollsController.dispose();
    if (_ownsRealtimeClient) {
      unawaited(_realtimeClient.close());
    }
    if (_ownsPollsApiClient) {
      _pollsApiClient.close();
    }
    if (_ownsReportsApiClient) {
      _reportsApiClient.close();
    }
    _scrollController.removeListener(_handleScroll);
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _reportPoll(PollSummary poll) {
    return showReportDialog(
      context: context,
      accessToken: widget.session.accessToken,
      targetType: 'poll',
      targetId: poll.id,
      reportsApiClient: _reportsApiClient,
    );
  }

  Future<void> _refresh() async {
    await _pollsController.refresh();
    if (_pollsController.state.refresh.error != null && mounted) {
      _showError('Could not refresh subscriptions.');
    }
  }

  void _replacePoll(PollVoteRealtimeEvent event) {
    if (!mounted) return;
    final store = _pollStateStore;
    if (store != null) {
      store.ingest(
        event.poll,
        PollIngress(
          origin: PollOrigin.realtime,
          sessionEpoch: store.sessionEpoch,
          viewerId: null,
          expectedPollId: event.poll.id,
          requestId: 'subscriptions-realtime-${event.poll.id}',
          startedGeneration: store.generationFor(event.poll.id),
        ),
      );
      return;
    }
    final index = _polls.indexWhere((poll) => poll.id == event.poll.id);
    if (index < 0) return;
    setState(() {
      _polls[index] = event.poll.copyWith(
        viewerVoteOptionId: _polls[index].viewerVoteOptionId,
      );
    });
  }

  void _removePoll(PollDeletedRealtimeEvent event) {
    if (!mounted) return;
    final store = _pollStateStore;
    if (store != null && !store.isDeleted(event.pollId)) {
      store.markDeleted(
        event.pollId,
        PollIngress(
          origin: PollOrigin.realtime,
          sessionEpoch: store.sessionEpoch,
          viewerId: null,
          expectedPollId: event.pollId,
          requestId: 'subscriptions-realtime-delete-${event.pollId}',
          startedGeneration: store.generationFor(event.pollId),
        ),
      );
      return;
    }
    setState(() {
      _polls.removeWhere((poll) => poll.id == event.pollId);
    });
  }

  void _replacePollValue(PollSummary poll) {
    final index = _polls.indexWhere((current) => current.id == poll.id);
    if (index < 0 || !mounted) return;
    setState(() {
      _polls[index] = poll;
    });
  }

  Future<void> _vote(PollSummary poll, PollOptionSummary option) async {
    if (_votingPollIds.contains(poll.id) || poll.isClosed) return;
    setState(() => _votingPollIds.add(poll.id));
    try {
      final updated = await _pollsApiClient.vote(
        pollId: poll.id,
        optionId: option.id,
        accessToken: widget.session.accessToken,
      );
      _replacePollValue(updated);
    } on PollsApiException catch (error) {
      _showError(error.userMessage);
    } finally {
      if (mounted) setState(() => _votingPollIds.remove(poll.id));
    }
  }

  Future<void> _cancelVote(PollSummary poll) async {
    if (_votingPollIds.contains(poll.id) || poll.isClosed) return;
    setState(() => _votingPollIds.add(poll.id));
    try {
      final updated = await _pollsApiClient.cancelVote(
        pollId: poll.id,
        accessToken: widget.session.accessToken,
      );
      _replacePollValue(updated);
    } on PollsApiException catch (error) {
      _showError(error.userMessage);
    } finally {
      if (mounted) setState(() => _votingPollIds.remove(poll.id));
    }
  }

  Future<void> _deletePoll(PollSummary poll) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete poll?'),
        content: const Text('This poll will be removed from the feed.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    final stateStore = _pollStateStore;
    final startedEpoch = stateStore?.sessionEpoch;
    final startedViewerId = stateStore?.viewerId;

    try {
      await _pollsApiClient.deletePoll(
        pollId: poll.id,
        accessToken: widget.session.accessToken,
      );
      if (!mounted ||
          !identical(stateStore, _pollStateStore) ||
          stateStore != null &&
              (stateStore.sessionEpoch != startedEpoch ||
                  stateStore.viewerId != startedViewerId)) {
        return;
      }
      if (stateStore != null && !stateStore.isDeleted(poll.id)) {
        stateStore.markDeleted(
          poll.id,
          PollIngress(
            origin: PollOrigin.mutation,
            sessionEpoch: startedEpoch!,
            viewerId: startedViewerId,
            expectedPollId: poll.id,
            requestId: 'subscriptions-delete-${poll.id}',
            startedGeneration: stateStore.generationFor(poll.id),
          ),
        );
      }
      setState(() => _polls.removeWhere((item) => item.id == poll.id));
    } on PollsApiException catch (error) {
      _showError(error.userMessage);
    } catch (_) {
      _showError('Could not delete poll.');
    }
  }

  Future<void> _toggleLike(PollSummary poll) async {
    poll = PollStateScope.maybeOf(context)?.pollById(poll.id) ?? poll;
    if (_likingPollIds.contains(poll.id)) return;
    setState(() => _likingPollIds.add(poll.id));
    try {
      final updated = poll.viewerHasLiked
          ? await _pollsApiClient.unlikePoll(
              pollId: poll.id,
              accessToken: widget.session.accessToken,
            )
          : await _pollsApiClient.likePoll(
              pollId: poll.id,
              accessToken: widget.session.accessToken,
            );
      _replacePollValue(updated);
    } on PollsApiException catch (error) {
      _showError(error.message);
    } finally {
      if (mounted) setState(() => _likingPollIds.remove(poll.id));
    }
  }

  Future<void> _openComments(PollSummary poll) async {
    final updated = await Navigator.of(context).push<PollSummary>(
      MaterialPageRoute<PollSummary>(
        builder: (context) => PollCommentsScreen(
          poll: poll,
          accessToken: widget.session.accessToken,
          pollsApiClient: _pollsApiClient,
          currentUserId: widget.session.user.id,
        ),
      ),
    );
    if (updated != null) _replacePollValue(updated);
  }

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final state = _pollsController.state;
    if (state.pages.isEmpty && state.initial.pending) {
      return Scaffold(
        appBar: AppBar(title: const Text('Subscriptions')),
        body: const SingleChildScrollView(
          padding: EdgeInsets.all(16),
          child: DelayedContentSkeleton(
            kind: ContentSkeletonKind.poll,
            rows: 2,
          ),
        ),
      );
    }
    if (state.pages.isEmpty && state.initial.error != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Subscriptions')),
        body: _SubscriptionsError(onRetry: _retry),
      );
    }

    final showEmpty = _polls.isEmpty && !state.canLoadMore;
    final showFooter = state.pages.isNotEmpty &&
        state.paginationSupported &&
        (_polls.isNotEmpty || state.canLoadMore);
    final footer = PaginationFooter(
      hasMore: state.canLoadMore,
      loading: state.append.pending,
      error: state.append.error,
      onLoadMore: () => unawaited(_pollsController.loadMore()),
      onRetry: () => unawaited(_pollsController.loadMore()),
    );

    return Scaffold(
      appBar: AppBar(title: const Text('Subscriptions')),
      body: NotificationListener<ScrollMetricsNotification>(
        onNotification: (notification) {
          if (notification.depth == 0) {
            _handleScrollMetrics(notification.metrics);
          }
          return false;
        },
        child: RefreshIndicator(
          onRefresh: _refresh,
          child: EntryMotionRegistryScope(
            contextKey: 'subscriptions:${widget.session.user.id}',
            child: ListScrollAnchorHost(
              context: _scrollContext,
              store: listScrollStateStore,
              controller: _scrollController,
              itemIds: _polls.map((poll) => 'poll-${poll.id}').toList(),
              child: showEmpty || _polls.isEmpty
                  ? ListView(
                      controller: _scrollController,
                      physics: const AlwaysScrollableScrollPhysics(),
                      children: [
                        const SizedBox(height: 180),
                        if (showEmpty) const _SubscriptionsEmpty(),
                        if (!showEmpty && showFooter) footer,
                      ],
                    )
                  : ListView.separated(
                      controller: _scrollController,
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                      physics: const AlwaysScrollableScrollPhysics(),
                      itemCount: _polls.length + (showFooter ? 1 : 0),
                      separatorBuilder: (_, __) => const SizedBox(height: 12),
                      itemBuilder: (context, index) {
                        if (index == _polls.length) return footer;
                        final poll = _polls[index];
                        return ListScrollAnchorItem(
                          id: 'poll-${poll.id}',
                          child: EntryMotion(
                            key: ValueKey('entry-poll-${poll.id}'),
                            contextKey:
                                'subscriptions:${widget.session.user.id}',
                            itemId: poll.id,
                            visible: true,
                            indexInBatch: index,
                            child: PollCard(
                              key: ValueKey('poll-${poll.id}'),
                              poll: poll,
                              accessToken: widget.session.accessToken,
                              onVote: poll.isClosed ||
                                      poll.selectedOptionIndex != null ||
                                      _votingPollIds.contains(poll.id)
                                  ? null
                                  : (option) => _vote(poll, option),
                              onCancelVote: poll.isClosed ||
                                      _votingPollIds.contains(poll.id)
                                  ? null
                                  : () => _cancelVote(poll),
                              onDeletePoll:
                                  poll.author.id == widget.session.user.id
                                      ? () => _deletePoll(poll)
                                      : null,
                              onReport: poll.author.id == widget.session.user.id
                                  ? null
                                  : () => _reportPoll(poll),
                              isVoting: _votingPollIds.contains(poll.id),
                              onOpenComments: () => _openComments(poll),
                              onToggleLike: _likingPollIds.contains(poll.id)
                                  ? null
                                  : () => _toggleLike(poll),
                              isLiking: _likingPollIds.contains(poll.id),
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ),
        ),
      ),
    );
  }

  void _retry() {
    unawaited(_pollsController.loadInitial());
  }
}

class _SubscriptionsEmpty extends StatelessWidget {
  const _SubscriptionsEmpty();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        child: Column(
          children: [
            Image.asset(
              'assets/branding/subscriptions_icon.png',
              width: 48,
              height: 48,
            ),
            const SizedBox(height: 12),
            Text(
              'No subscription polls yet',
              style: Theme.of(context).textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              'Follow users to see their polls here.',
              textAlign: TextAlign.center,
              style: TextStyle(
                  color: Theme.of(context).colorScheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

class _SubscriptionsError extends StatelessWidget {
  const _SubscriptionsError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('Could not load subscriptions.'),
          const SizedBox(height: 12),
          OutlinedButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}
