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
import '../../core/scroll/list_scroll_anchor_host.dart';
import '../../core/scroll/list_scroll_state.dart';
import '../../core/widgets/content_skeleton.dart';
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

  @override
  State<FeedScreen> createState() => FeedScreenState();
}

class FeedScreenState extends State<FeedScreen> {
  late final PollsApiClient _pollsApiClient;
  late final RealtimeClient _realtimeClient;
  late Future<List<PollSummary>> _pollsFuture;
  late final bool _ownsPollsApiClient;
  late final ProfilesApiClient _profilesApiClient;
  late final bool _ownsProfilesApiClient;
  late final bool _ownsRealtimeClient;
  late final ReportsApiClient _reportsApiClient;
  late final bool _ownsReportsApiClient;
  StreamSubscription<PollVoteRealtimeEvent>? _pollVoteSubscription;
  StreamSubscription<PollDeletedRealtimeEvent>? _pollDeletedSubscription;
  List<PollSummary> _polls = [];
  final _scrollController = ScrollController();
  int _pollRequestSequence = 0;
  var _hasLoadedPolls = false;
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
    _pollsFuture = _loadPolls();
    _pollVoteSubscription =
        _realtimeClient.pollVotes.listen(_handleRealtimeVote);
    _pollDeletedSubscription =
        _realtimeClient.pollDeletions.listen(_handleRealtimeDeletion);
    _realtimeClient.connect();
  }

  @override
  void dispose() {
    unawaited(_pollVoteSubscription?.cancel());
    unawaited(_pollDeletedSubscription?.cancel());

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
    _scrollController.dispose();

    super.dispose();
  }

  Future<List<PollSummary>> _loadPolls() {
    return _pollsApiClient
        .listPolls(accessToken: widget.session.accessToken)
        .timeout(const Duration(seconds: 10));
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
    final store = PollStateScope.maybeOf(context);
    final epoch = store?.sessionEpoch ?? 0;
    final viewerId = store?.viewerId;
    final generations = store?.generationSnapshot ?? const <String, int>{};
    final requestId = 'feed-refresh-${++_pollRequestSequence}';
    try {
      final nextPolls = await _loadPolls();

      if (!mounted) {
        return;
      }

      final mergedPolls = store == null
          ? nextPolls
          : nextPolls
              .map((poll) {
                final result = store.ingest(
                  poll,
                  PollIngress(
                    origin: PollOrigin.http,
                    sessionEpoch: epoch,
                    viewerId: viewerId,
                    expectedPollId: null,
                    requestId: requestId,
                    startedGeneration: generations[poll.id] ?? 0,
                  ),
                );
                return result.accepted ? result.state : null;
              })
              .whereType<PollSummary>()
              .toList();
      setState(() {
        _polls = mergedPolls;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

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

    final store = PollStateScope.maybeOf(context);
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
    setState(() {
      _polls.removeWhere((poll) => poll.id == event.pollId);
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

    try {
      await _pollsApiClient.deletePoll(
        pollId: poll.id,
        accessToken: widget.session.accessToken,
      );
      if (!mounted) return;
      setState(() => _polls.removeWhere((item) => item.id == poll.id));
      _showSnackBar('Poll deleted.');
    } on PollsApiException catch (error) {
      _showSnackBar(error.userMessage);
    } catch (_) {
      _showSnackBar('Could not delete poll.');
    }
  }

  Future<void> _toggleLike(PollSummary poll) async {
    poll = PollStateScope.maybeOf(context)?.pollById(poll.id) ?? poll;
    if (_likingPollIds.contains(poll.id)) {
      return;
    }

    setState(() {
      _likingPollIds.add(poll.id);
    });

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

      _replacePollInFeed(updatedPoll);
    } on PollsApiException catch (error) {
      _showSnackBar(error.message);
    } catch (_) {
      _showSnackBar('Could not update like.');
    } finally {
      if (mounted) {
        setState(() {
          _likingPollIds.remove(poll.id);
        });
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
        ),
      ),
    );
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
    final store = PollStateScope.maybeOf(context);
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

  void _replacePollInFeedValue(PollSummary updatedPoll) {
    setState(() {
      _polls = _polls
          .map((currentPoll) =>
              currentPoll.id == updatedPoll.id ? updatedPoll : currentPoll)
          .toList();
    });
  }

  void _promotePollToTop(PollSummary createdPoll) {
    setState(() {
      _polls = [
        createdPoll,
        ..._polls.where((poll) => poll.id != createdPoll.id),
      ];
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F8FC),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _refreshPolls,
          child: ListScrollAnchorHost(
            context: ListScrollContext(
              userId: widget.session.user.id,
              route: '/feed',
              list: 'polls',
              query: '',
              filter: '',
              sort: '',
            ),
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
                  FutureBuilder<List<PollSummary>>(
                    future: _pollsFuture,
                    builder: (context, snapshot) {
                      if (snapshot.connectionState == ConnectionState.waiting &&
                          !_hasLoadedPolls) {
                        return const SliverFillRemaining(
                          hasScrollBody: false,
                          child: _FeedLoadingState(),
                        );
                      }

                      if (snapshot.hasError && !_hasLoadedPolls) {
                        return SliverFillRemaining(
                          hasScrollBody: false,
                          child: _FeedErrorState(
                            onRetry: () {
                              setState(() {
                                _pollsFuture = _loadPolls();
                              });
                            },
                          ),
                        );
                      }

                      if (!_hasLoadedPolls && snapshot.hasData) {
                        _polls = snapshot.data ?? [];
                        _hasLoadedPolls = true;
                      }

                      final polls = _polls;

                      if (polls.isEmpty) {
                        return const SliverFillRemaining(
                          hasScrollBody: false,
                          child: _FeedEmptyState(),
                        );
                      }

                      return SliverPadding(
                        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
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
                    },
                  ),
                ],
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
