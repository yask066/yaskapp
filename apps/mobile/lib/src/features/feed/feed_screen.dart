import 'dart:async';

import 'package:flutter/material.dart';

import '../auth/auth_session.dart';
import '../polls/create_poll_screen.dart';
import '../polls/poll_card.dart';
import '../polls/poll_comments_screen.dart';
import '../polls/poll_summary.dart';
import '../polls/polls_api_client.dart';
import '../polls/poll_state_scope.dart';
import '../polls/poll_state_store.dart';
import '../profile/profiles_api_client.dart';
import '../profile/public_profile_screen.dart';
import '../realtime/realtime_client.dart';
import '../reports/report_dialog.dart';
import '../reports/reports_api_client.dart';
import '../../core/analytics/search_analytics.dart';
import '../../core/motion/entry_motion.dart';
import '../../core/pagination/cursor_list_controller.dart';
import '../../core/pagination/cursor_page.dart';
import '../../core/scroll/list_scroll_anchor_host.dart';
import '../../core/scroll/list_scroll_state.dart';
import '../../core/widgets/content_skeleton.dart';
import '../../core/widgets/pagination_footer.dart';
import '../search/search_api_client.dart';
import '../search/search_screen.dart';

class FeedScreen extends StatefulWidget {
  const FeedScreen({
    required this.session,
    super.key,
    PollsApiClient? pollsApiClient,
    ProfilesApiClient? profilesApiClient,
    RealtimeClient? realtimeClient,
    ReportsApiClient? reportsApiClient,
    SearchApiClient? searchApiClient,
    SearchAnalytics? searchAnalytics,
    this.onPollCreated,
    this.isActive = true,
  })  : _pollsApiClient = pollsApiClient,
        _profilesApiClient = profilesApiClient,
        _realtimeClient = realtimeClient,
        _reportsApiClient = reportsApiClient,
        _searchApiClient = searchApiClient,
        _searchAnalytics = searchAnalytics;

  final AuthSession session;
  final PollsApiClient? _pollsApiClient;
  final ProfilesApiClient? _profilesApiClient;
  final RealtimeClient? _realtimeClient;
  final ReportsApiClient? _reportsApiClient;
  final SearchApiClient? _searchApiClient;
  final SearchAnalytics? _searchAnalytics;
  final ValueChanged<PollSummary>? onPollCreated;
  final bool isActive;

  @override
  State<FeedScreen> createState() => FeedScreenState();
}

class FeedScreenState extends State<FeedScreen> {
  late final PollsApiClient _pollsApiClient;
  late final RealtimeClient _realtimeClient;
  final Map<String, CursorListController<PollSummary>> _feedControllers = {};
  final Map<CursorListController<PollSummary>, VoidCallback>
      _feedControllerListeners = {};
  String _feedSort = 'newest';
  CursorListController<PollSummary> get _pollsController =>
      _feedControllers[_feedSort]!;
  late final bool _ownsPollsApiClient;
  late final ProfilesApiClient _profilesApiClient;
  late final bool _ownsProfilesApiClient;
  late final bool _ownsRealtimeClient;
  late final ReportsApiClient _reportsApiClient;
  late final bool _ownsReportsApiClient;
  StreamSubscription<PollVoteRealtimeEvent>? _pollVoteSubscription;
  StreamSubscription<PollDeletedRealtimeEvent>? _pollDeletedSubscription;
  PollStateStore? _pollStateStore;
  List<PollSummary> _polls = [];
  final Map<String, PollSummary> _localPollOverlays = {};
  final _scrollController = ScrollController();
  int _pollRequestSequence = 0;
  final Set<String> _votingPollIds = {};
  final Set<String> _likingPollIds = {};

  @override
  void initState() {
    super.initState();
    _ownsPollsApiClient = widget._pollsApiClient == null;
    _ownsProfilesApiClient = widget._profilesApiClient == null;
    _ownsRealtimeClient = widget._realtimeClient == null;
    _ownsReportsApiClient = widget._reportsApiClient == null;
    _pollsApiClient = widget._pollsApiClient ?? PollsApiClient();
    _profilesApiClient = widget._profilesApiClient ?? ProfilesApiClient();
    _realtimeClient = widget._realtimeClient ??
        RealtimeClient(accessToken: widget.session.accessToken);
    _reportsApiClient = widget._reportsApiClient ?? ReportsApiClient();
    _scrollController.addListener(_handleScroll);
    _createPaginationController(sort: _feedSort);
    if (widget.isActive) {
      unawaited(_pollsController.loadInitial());
    } else {
      _pollsController.markInactive();
    }
    _pollVoteSubscription =
        _realtimeClient.pollVotes.listen(_handleRealtimeVote);
    _pollDeletedSubscription =
        _realtimeClient.pollDeletions.listen(_handleRealtimeDeletion);
    _realtimeClient.connect();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final nextStore = PollStateScope.readOf(context);
    if (identical(nextStore, _pollStateStore)) return;
    _pollStateStore?.removeListener(_handlePollStateChanged);
    _pollStateStore = nextStore;
    _pollStateStore?.addListener(_handlePollStateChanged);
    _handlePollStateChanged();
  }

  void _handlePollStateChanged() {
    if (!mounted) return;
    final store = _pollStateStore;
    if (store == null) return;
    _localPollOverlays.removeWhere((id, _) => store.isDeleted(id));
    final visible = _polls.where((poll) => !store.isDeleted(poll.id)).toList();
    if (visible.length == _polls.length) return;
    setState(() => _polls = visible);
    _scheduleViewportAppend();
  }

  @override
  void didUpdateWidget(covariant FeedScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    final sessionChanged =
        oldWidget.session.user.id != widget.session.user.id ||
            oldWidget.session.accessToken != widget.session.accessToken;
    if (sessionChanged) {
      _disposeFeedControllers();
      _feedSort = 'newest';
      _polls = [];
      _localPollOverlays.clear();
      _createPaginationController(sort: _feedSort);
    }

    if (oldWidget.isActive != widget.isActive || sessionChanged) {
      if (widget.isActive) {
        _activateFeedController(_pollsController);
      } else {
        for (final controller in _feedControllers.values) {
          controller.markInactive();
        }
      }
    }
  }

  void _createPaginationController({required String sort}) {
    final controller = CursorListController<PollSummary>(
      contextKey: 'feed:${widget.session.user.id}:$sort',
      loader: ({required limit, cursor}) =>
          _loadPollPage(limit: limit, sort: sort, cursor: cursor),
      extractId: (poll) => poll.id,
      onInactiveExpired: () {
        listScrollStateStore.clearForContext(_scrollContextFor(sort));
        if (sort == _feedSort && _scrollController.hasClients) {
          _scrollController.jumpTo(0);
        }
      },
    );
    _feedControllers[sort] = controller;
    final listener = () => _handlePaginationChanged(controller);
    _feedControllerListeners[controller] = listener;
    controller.addListener(listener);
  }

  void _disposeFeedControllers() {
    for (final controller in _feedControllers.values) {
      controller.removeListener(_feedControllerListeners.remove(controller)!);
      controller.dispose();
    }
    _feedControllers.clear();
    _feedControllerListeners.clear();
  }

  void _activateFeedController(CursorListController<PollSummary> controller) {
    controller.markActive();
    if (controller.state.pages.isEmpty &&
        !controller.state.initial.pending &&
        controller.state.initial.error == null) {
      unawaited(controller.loadInitial());
    }
  }

  void _setFeedSort(String sort) {
    if (sort == _feedSort) return;
    _pollsController.markInactive();
    var nextController = _feedControllers[sort];
    if (nextController == null) {
      _createPaginationController(sort: sort);
      nextController = _feedControllers[sort]!;
    }
    nextController.markActive();
    setState(() {
      _feedSort = sort;
      _polls = _visiblePolls();
    });
    if (nextController.state.pages.isEmpty &&
        !nextController.state.initial.pending &&
        nextController.state.initial.error == null) {
      unawaited(nextController.loadInitial());
    }
  }

  ListScrollContext get _scrollContext => _scrollContextFor(_feedSort);

  ListScrollContext _scrollContextFor(String sort) => ListScrollContext(
        userId: widget.session.user.id,
        route: '/feed',
        list: 'polls',
        query: '',
        filter: '',
        sort: sort,
      );

  Future<CursorPage<PollSummary>> _loadPollPage({
    required int limit,
    required String sort,
    String? cursor,
  }) {
    return _pollsApiClient
        .listPollsPage(
          limit: limit,
          sort: sort,
          cursor: cursor,
          accessToken: widget.session.accessToken,
        )
        .timeout(const Duration(seconds: 10));
  }

  List<PollSummary> _visiblePolls() {
    final store = _pollStateStore;
    final serverIds =
        _pollsController.state.items.map((poll) => poll.id).toSet();
    _localPollOverlays.removeWhere((id, _) => serverIds.contains(id));
    final visibleById = <String, PollSummary>{};
    PollSummary? currentPoll(PollSummary poll) {
      if (store?.isDeleted(poll.id) ?? false) return null;
      return store?.pollById(poll.id) ?? poll;
    }

    for (final poll in _localPollOverlays.values) {
      final current = currentPoll(poll);
      if (current != null) visibleById.putIfAbsent(current.id, () => current);
    }
    for (final poll in _pollsController.state.items) {
      final current = currentPoll(poll);
      if (current != null) visibleById.putIfAbsent(current.id, () => current);
    }
    return visibleById.values.toList();
  }

  void _handlePaginationChanged(CursorListController<PollSummary> controller) {
    if (!mounted || !identical(controller, _pollsController)) return;
    setState(() => _polls = _visiblePolls());
    _scheduleViewportAppend();
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

  @override
  void dispose() {
    unawaited(_pollVoteSubscription?.cancel());
    unawaited(_pollDeletedSubscription?.cancel());
    _pollStateStore?.removeListener(_handlePollStateChanged);

    if (_ownsRealtimeClient) {
      unawaited(_realtimeClient.close());
    }

    if (_ownsPollsApiClient) {
      _pollsApiClient.close();
    }

    if (_ownsProfilesApiClient) {
      _profilesApiClient.close();
    }
    if (_ownsReportsApiClient) {
      _reportsApiClient.close();
    }
    _disposeFeedControllers();
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

  Future<void> _refreshPolls() async {
    await _pollsController.refresh();
    if (_pollsController.state.refresh.error != null && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not refresh the feed.')),
      );
    }
  }

  void _handleRealtimeVote(PollVoteRealtimeEvent event) {
    if (!mounted) {
      return;
    }

    final existingIndex = _polls.indexWhere((poll) => poll.id == event.poll.id);

    if (existingIndex == -1) {
      return;
    }

    final store = PollStateScope.readOf(context);
    final currentPoll = _polls[existingIndex];
    if (store == null) {
      _replacePollInFeedValue(
        event.poll.copyWith(
          viewerVoteOptionId: currentPoll.viewerVoteOptionId,
        ),
      );
      return;
    }
    final result = store.ingest(
      event.poll,
      PollIngress(
        origin: PollOrigin.realtime,
        sessionEpoch: store.sessionEpoch,
        viewerId: null,
        expectedPollId: event.poll.id,
        requestId: 'feed-realtime-${event.poll.id}',
        startedGeneration: store.generationFor(event.poll.id),
      ),
    );
    if (!result.accepted) {
      if (store.isDeleted(event.poll.id)) {
        setState(() {
          _polls.removeWhere((poll) => poll.id == event.poll.id);
        });
      }
      return;
    }
    final updated = result.state;
    if (updated != null) _replacePollInFeedValue(updated);
  }

  void _handleRealtimeDeletion(PollDeletedRealtimeEvent event) {
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
          requestId: 'feed-realtime-delete-${event.pollId}',
          startedGeneration: store.generationFor(event.pollId),
        ),
      );
    }
    setState(() {
      _polls.removeWhere((poll) => poll.id == event.pollId);
      _localPollOverlays.remove(event.pollId);
    });
  }

  Future<void> _vote(PollSummary poll, PollOptionSummary option) async {
    if (_votingPollIds.contains(poll.id) || poll.isClosed) {
      return;
    }

    setState(() {
      _votingPollIds.add(poll.id);
    });

    try {
      final updatedPoll = await _pollsApiClient.vote(
        pollId: poll.id,
        optionId: option.id,
        accessToken: widget.session.accessToken,
      );

      if (!mounted) {
        return;
      }

      _replacePollInFeed(updatedPoll);
    } on PollsApiException catch (error) {
      _showSnackBar(error.userMessage);
    } catch (_) {
      _showSnackBar('Could not submit vote.');
    } finally {
      if (mounted) {
        setState(() {
          _votingPollIds.remove(poll.id);
        });
      }
    }
  }

  Future<void> _cancelVote(PollSummary poll) async {
    if (_votingPollIds.contains(poll.id) || poll.isClosed) {
      return;
    }

    setState(() => _votingPollIds.add(poll.id));

    try {
      final updatedPoll = await _pollsApiClient.cancelVote(
        pollId: poll.id,
        accessToken: widget.session.accessToken,
      );

      if (!mounted) return;
      _replacePollInFeed(updatedPoll);
    } on PollsApiException catch (error) {
      _showSnackBar(error.userMessage);
    } catch (_) {
      _showSnackBar('Could not cancel vote.');
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
            requestId: 'feed-delete-${poll.id}',
            startedGeneration: stateStore.generationFor(poll.id),
          ),
        );
      }
      setState(() {
        _polls.removeWhere((item) => item.id == poll.id);
        _localPollOverlays.remove(poll.id);
      });
      _showSnackBar('Poll deleted.');
    } on PollsApiException catch (error) {
      _showSnackBar(error.userMessage);
    } catch (_) {
      _showSnackBar('Could not delete poll.');
    }
  }

  Future<void> _toggleLike(PollSummary poll) async {
    final store = PollStateScope.readOf(context);
    poll = store?.pollById(poll.id) ?? poll;
    if (store?.isLiking(poll.id) ?? _likingPollIds.contains(poll.id)) {
      return;
    }

    if (store == null) setState(() => _likingPollIds.add(poll.id));

    try {
      final updatedPoll = poll.viewerHasLiked
          ? await _pollsApiClient.unlikePoll(
              pollId: poll.id,
              accessToken: widget.session.accessToken,
            )
          : await _pollsApiClient.likePoll(
              pollId: poll.id,
              accessToken: widget.session.accessToken,
            );

      if (!mounted) {
        return;
      }

      if (store == null) {
        _replacePollInFeed(updatedPoll);
      } else {
        final storedPoll = store.pollById(poll.id);
        if (storedPoll != null &&
            storedPoll.likesCount == updatedPoll.likesCount &&
            storedPoll.viewerHasLiked == updatedPoll.viewerHasLiked) {
          _replacePollInFeedValue(storedPoll, rebuild: false);
        } else {
          _replacePollInFeed(updatedPoll);
        }
      }
    } on PollsApiException catch (error) {
      _showSnackBar(error.message);
    } catch (_) {
      _showSnackBar('Could not update like.');
    } finally {
      if (mounted && store == null) {
        setState(() => _likingPollIds.remove(poll.id));
      }
    }
  }

  void _showSnackBar(String message) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  Future<void> _openCreatePoll() async {
    final createdPoll = await Navigator.of(context).push<PollSummary>(
      MaterialPageRoute(
        builder: (context) => CreatePollScreen(
          accessToken: widget.session.accessToken,
          pollsApiClient: _pollsApiClient,
        ),
      ),
    );

    if (createdPoll == null || !mounted) {
      return;
    }

    _promotePollToTop(createdPoll);
    widget.onPollCreated?.call(createdPoll);

    _showSnackBar('Poll published.');
  }

  Future<void> _openAuthorProfile(PollSummary poll) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (context) => PublicProfileScreen(
          userId: poll.author.id,
          currentUserId: widget.session.user.id,
          accessToken: widget.session.accessToken,
          profilesApiClient: _profilesApiClient,
          pollsApiClient: _pollsApiClient,
          onFollowingChanged: _markFollowingChanged,
        ),
      ),
    );
  }

  Future<void> openCreatePoll() => _openCreatePoll();

  Future<void> _openSearch() async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => SearchScreen(
          session: widget.session,
          searchApiClient: widget._searchApiClient,
          pollsApiClient: _pollsApiClient,
          profilesApiClient: _profilesApiClient,
          reportsApiClient: widget._reportsApiClient,
          analytics: widget._searchAnalytics,
          onFollowingChanged: _markFollowingChanged,
        ),
      ),
    );
  }

  void _markFollowingChanged() {
    if (!mounted) return;
    PollStateScope.readOf(context)?.markFollowingMembershipChanged();
  }

  Future<void> _openComments(PollSummary poll) async {
    final updatedPoll = await Navigator.of(context).push<PollSummary>(
      MaterialPageRoute<PollSummary>(
        builder: (context) => PollCommentsScreen(
          poll: poll,
          accessToken: widget.session.accessToken,
          pollsApiClient: _pollsApiClient,
          currentUserId: widget.session.user.id,
        ),
      ),
    );

    if (updatedPoll == null || !mounted) {
      return;
    }

    _replacePollInFeed(updatedPoll);
  }

  void _replacePollInFeed(PollSummary updatedPoll) {
    final store = PollStateScope.readOf(context);
    if (store != null) {
      final result = store.ingest(
        updatedPoll,
        PollIngress(
          origin: PollOrigin.mutation,
          sessionEpoch: store.sessionEpoch,
          viewerId: store.viewerId,
          expectedPollId: updatedPoll.id,
          requestId: 'feed-operation-${++_pollRequestSequence}',
          startedGeneration: store.generationFor(updatedPoll.id),
        ),
      );
      if (!result.accepted) {
        if (store.isDeleted(updatedPoll.id)) {
          setState(() {
            _polls.removeWhere((poll) => poll.id == updatedPoll.id);
          });
        }
        return;
      }
      updatedPoll = result.state ?? updatedPoll;
    }
    _replacePollInFeedValue(updatedPoll);
  }

  void _replacePollInFeedValue(
    PollSummary updatedPoll, {
    bool rebuild = true,
  }) {
    void replace() {
      _polls = _polls
          .map((currentPoll) =>
              currentPoll.id == updatedPoll.id ? updatedPoll : currentPoll)
          .toList();
      if (_localPollOverlays.containsKey(updatedPoll.id)) {
        _localPollOverlays[updatedPoll.id] = updatedPoll;
      }
    }

    if (rebuild) {
      setState(replace);
    } else {
      replace();
    }
  }

  void _promotePollToTop(PollSummary createdPoll) {
    _localPollOverlays[createdPoll.id] = createdPoll;
    setState(() {
      _polls = [
        createdPoll,
        ..._polls.where((poll) => poll.id != createdPoll.id),
      ];
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = _pollsController.state;
    final polls = _polls;
    final appendError = state.append.error;
    final popularExpired = _feedSort == 'popular' &&
        appendError is PollsApiException &&
        appendError.statusCode == 410 &&
        appendError.code == 'pagination_expired';
    final repeatedCursor =
        appendError is StateError && appendError.message == 'Cursor repeated.';
    final appendErrorMessage = popularExpired
        ? 'This popular feed snapshot expired. Refresh the feed to continue.'
        : repeatedCursor
            ? 'The server returned a repeated cursor. Refresh the feed to continue.'
            : null;
    final content = state.pages.isEmpty && state.initial.pending
        ? const SliverFillRemaining(
            hasScrollBody: false,
            child: _FeedLoadingState(),
          )
        : state.pages.isEmpty && state.initial.error != null
            ? SliverFillRemaining(
                hasScrollBody: false,
                child: _FeedErrorState(
                  onRetry: () => unawaited(_pollsController.loadInitial()),
                ),
              )
            : polls.isEmpty && !state.canLoadMore
                ? const SliverFillRemaining(
                    hasScrollBody: false,
                    child: _FeedEmptyState(),
                  )
                : polls.isEmpty
                    ? const SliverToBoxAdapter(child: SizedBox.shrink())
                    : SliverPadding(
                        padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                        sliver: SliverList.separated(
                          itemBuilder: (context, index) {
                            final poll = polls[index];

                            return ListScrollAnchorItem(
                              id: 'poll-${poll.id}',
                              child: EntryMotion(
                                key: ValueKey('entry-poll-${poll.id}'),
                                contextKey: 'feed:${widget.session.user.id}',
                                itemId: poll.id,
                                visible: true,
                                indexInBatch: index,
                                child: PollCard(
                                  key: ValueKey('poll-${poll.id}'),
                                  poll: poll,
                                  accessToken: widget.session.accessToken,
                                  onOpenAuthor: () => _openAuthorProfile(poll),
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
                                  onReport:
                                      poll.author.id == widget.session.user.id
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
                          separatorBuilder: (context, index) =>
                              const SizedBox(height: 12),
                          itemCount: polls.length,
                        ),
                      );

    return Scaffold(
      backgroundColor: const Color(0xFFF7F8FC),
      body: SafeArea(
        child: NotificationListener<ScrollMetricsNotification>(
          onNotification: (notification) {
            if (notification.depth == 0) {
              _handleScrollMetrics(notification.metrics);
            }
            return false;
          },
          child: RefreshIndicator(
            onRefresh: _refreshPolls,
            child: ListScrollAnchorHost(
              context: _scrollContext,
              store: listScrollStateStore,
              controller: _scrollController,
              itemIds: _polls.map((poll) => 'poll-${poll.id}').toList(),
              child: EntryMotionRegistryScope(
                contextKey: 'feed:${widget.session.user.id}',
                child: CustomScrollView(
                  controller: _scrollController,
                  physics: const AlwaysScrollableScrollPhysics(),
                  slivers: [
                    SliverAppBar(
                      pinned: true,
                      backgroundColor: Colors.white,
                      surfaceTintColor: Colors.transparent,
                      elevation: 0,
                      toolbarHeight: 72,
                      titleSpacing: 20,
                      title: Semantics(
                        label: 'Yaskapp',
                        image: true,
                        child: Image.asset(
                          'assets/branding/yaskapp_logo.png',
                          width: 72,
                          height: 40,
                          fit: BoxFit.contain,
                        ),
                      ),
                      centerTitle: false,
                      actions: [
                        PopupMenuButton<String>(
                          tooltip: 'Feed order',
                          initialValue: _feedSort,
                          onSelected: _setFeedSort,
                          itemBuilder: (context) => const [
                            PopupMenuItem(
                              value: 'newest',
                              child: Text('Newest'),
                            ),
                            PopupMenuItem(
                              value: 'popular',
                              child: Text('Popular'),
                            ),
                          ],
                          icon: const Icon(Icons.sort),
                        ),
                        SizedBox(
                          width: 40,
                          height: 40,
                          child: IconButton(
                            tooltip: 'Search',
                            onPressed: _openSearch,
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints.tightFor(
                              width: 40,
                              height: 40,
                            ),
                            icon: Image.asset(
                              'assets/branding/search_icon.png',
                              width: 28,
                              height: 28,
                              fit: BoxFit.contain,
                            ),
                          ),
                        ),
                        const SizedBox(width: 20),
                      ],
                    ),
                    SliverToBoxAdapter(
                      child: _HomeHeader(onCreatePoll: _openCreatePoll),
                    ),
                    content,
                    if (state.pages.isNotEmpty &&
                        state.paginationSupported &&
                        (polls.isNotEmpty || state.canLoadMore))
                      SliverToBoxAdapter(
                        child: PaginationFooter(
                          hasMore: state.canLoadMore,
                          loading: state.append.pending,
                          error: state.append.error,
                          errorMessage: appendErrorMessage,
                          requiresRefresh: popularExpired || repeatedCursor,
                          onLoadMore: () =>
                              unawaited(_pollsController.loadMore()),
                          onRetry: () => unawaited(_pollsController.loadMore()),
                          onRefresh: () => unawaited(_refreshPolls()),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _HomeHeader extends StatelessWidget {
  const _HomeHeader({required this.onCreatePoll});

  final VoidCallback onCreatePoll;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _CreatePrompt(onCreatePoll: onCreatePoll),
        ],
      ),
    );
  }
}

class _CreatePrompt extends StatelessWidget {
  const _CreatePrompt({required this.onCreatePoll});

  final VoidCallback onCreatePoll;

  @override
  Widget build(BuildContext context) {
    final largeText = MediaQuery.textScalerOf(context).scale(13) >= 24;
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(28),
        boxShadow: const [
          BoxShadow(
            color: Color(0x12050C3F),
            blurRadius: 16,
            offset: Offset(0, 6),
          ),
        ],
      ),
      constraints: const BoxConstraints(minHeight: 64),
      padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
      child: largeText
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Row(
                  children: [
                    Icon(
                      Icons.chat_bubble_outline_rounded,
                      color: Color(0xFF566078),
                      size: 24,
                    ),
                    SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        "What's on your mind?",
                        style: TextStyle(
                          color: Color(0xFF667085),
                          fontSize: 16,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerRight,
                  child: _createPollButton(largeText: true),
                ),
              ],
            )
          : Row(
              children: [
                const Icon(
                  Icons.chat_bubble_outline_rounded,
                  color: Color(0xFF566078),
                  size: 24,
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: Alignment.centerLeft,
                    child: Text(
                      "What's on your mind?",
                      maxLines: 1,
                      style: TextStyle(
                        color: Color(0xFF667085),
                        fontSize: 16,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                _createPollButton(largeText: false),
              ],
            ),
    );
  }

  Widget _createPollButton({required bool largeText}) => FilledButton.icon(
        onPressed: onCreatePoll,
        icon: const Icon(Icons.add, size: 21),
        label: const Text('Create poll'),
        style: FilledButton.styleFrom(
          backgroundColor: const Color(0xFFFA7F2D),
          foregroundColor: Colors.white,
          fixedSize: largeText ? null : const Size(127, 38),
          minimumSize: largeText ? const Size(0, 48) : null,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(28),
          ),
          textStyle: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
      );
}

class _FeedLoadingState extends StatelessWidget {
  const _FeedLoadingState();

  @override
  Widget build(BuildContext context) {
    return const SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 24),
      child: DelayedContentSkeleton(
        kind: ContentSkeletonKind.poll,
        rows: 1,
      ),
    );
  }
}

class _FeedErrorState extends StatelessWidget {
  const _FeedErrorState({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off_outlined, color: colors.onSurfaceVariant),
            const SizedBox(height: 12),
            Text(
              'Could not load polls',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              'Check that the API is running and try again.',
              textAlign: TextAlign.center,
              style: TextStyle(color: colors.onSurfaceVariant),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}

class _FeedEmptyState extends StatelessWidget {
  const _FeedEmptyState();

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.how_to_vote_outlined, color: colors.onSurfaceVariant),
            const SizedBox(height: 12),
            Text(
              'No polls yet',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              'Fresh public polls will appear here.',
              textAlign: TextAlign.center,
              style: TextStyle(color: colors.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}
