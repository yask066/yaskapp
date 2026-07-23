import 'dart:async';

import 'package:flutter/material.dart';

import '../auth/auth_session.dart';
import '../polls/create_poll_screen.dart';
import '../polls/poll_card.dart';
import '../polls/poll_comments_screen.dart';
import '../polls/poll_summary.dart';
import '../polls/polls_api_client.dart';
import '../realtime/realtime_client.dart';

class FeedScreen extends StatefulWidget {
  const FeedScreen({
    required this.session,
    super.key,
    PollsApiClient? pollsApiClient,
    RealtimeClient? realtimeClient,
  })  : _pollsApiClient = pollsApiClient,
        _realtimeClient = realtimeClient;

  final AuthSession session;
  final PollsApiClient? _pollsApiClient;
  final RealtimeClient? _realtimeClient;

  @override
  State<FeedScreen> createState() => _FeedScreenState();
}

class _FeedScreenState extends State<FeedScreen> {
  late final PollsApiClient _pollsApiClient;
  late final RealtimeClient _realtimeClient;
  late Future<List<PollSummary>> _pollsFuture;
  late final bool _ownsPollsApiClient;
  late final bool _ownsRealtimeClient;
  StreamSubscription<PollVoteRealtimeEvent>? _pollVoteSubscription;
  List<PollSummary> _polls = [];
  var _hasLoadedPolls = false;
  final Set<String> _votingPollIds = {};
  final Set<String> _likingPollIds = {};

  @override
  void initState() {
    super.initState();
    _ownsPollsApiClient = widget._pollsApiClient == null;
    _ownsRealtimeClient = widget._realtimeClient == null;
    _pollsApiClient = widget._pollsApiClient ?? PollsApiClient();
    _realtimeClient = widget._realtimeClient ?? RealtimeClient();
    _pollsFuture = _loadPolls();
    _pollVoteSubscription =
        _realtimeClient.pollVotes.listen(_handleRealtimeVote);
    _realtimeClient.connect();
  }

  @override
  void dispose() {
    unawaited(_pollVoteSubscription?.cancel());

    if (_ownsRealtimeClient) {
      unawaited(_realtimeClient.close());
    }

    if (_ownsPollsApiClient) {
      _pollsApiClient.close();
    }

    super.dispose();
  }

  Future<List<PollSummary>> _loadPolls() {
    return _pollsApiClient.listPolls(accessToken: widget.session.accessToken);
  }

  Future<void> _refreshPolls() async {
    final nextPolls = await _loadPolls();

    if (!mounted) {
      return;
    }

    setState(() {
      _polls = nextPolls;
    });
  }

  void _handleRealtimeVote(PollVoteRealtimeEvent event) {
    if (!mounted) {
      return;
    }

    final existingIndex = _polls.indexWhere((poll) => poll.id == event.poll.id);

    if (existingIndex == -1) {
      return;
    }

    _replacePollInFeed(event.poll);
  }

  Future<void> _vote(PollSummary poll, PollOptionSummary option) async {
    if (_votingPollIds.contains(poll.id)) {
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
      _showSnackBar(error.message);
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

  Future<void> _toggleLike(PollSummary poll) async {
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

    _showSnackBar('Poll published.');
  }

  Future<void> _openComments(PollSummary poll) async {
    final updatedPoll = await Navigator.of(context).push<PollSummary>(
      MaterialPageRoute<PollSummary>(
        builder: (context) => PollCommentsScreen(
          poll: poll,
          accessToken: widget.session.accessToken,
          pollsApiClient: _pollsApiClient,
        ),
      ),
    );

    if (updatedPoll == null || !mounted) {
      return;
    }

    _replacePollInFeed(updatedPoll);
  }

  void _replacePollInFeed(PollSummary updatedPoll) {
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
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _refreshPolls,
          child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              SliverAppBar(
                pinned: true,
                title: const Text('Yaskapp'),
                centerTitle: false,
                actions: [
                  IconButton(
                    tooltip: 'Search',
                    onPressed: () {},
                    icon: const Icon(Icons.search),
                  ),
                  IconButton(
                    tooltip: 'Notifications',
                    onPressed: () {},
                    icon: const Icon(Icons.notifications_none),
                  ),
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
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                    sliver: SliverList.separated(
                      itemBuilder: (context, index) {
                        final poll = polls[index];

                        return PollCard(
                          poll: poll,
                          onVote: _votingPollIds.contains(poll.id)
                              ? null
                              : (option) => _vote(poll, option),
                          onOpenComments: () => _openComments(poll),
                          onToggleLike: _likingPollIds.contains(poll.id)
                              ? null
                              : () => _toggleLike(poll),
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
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _openCreatePoll,
        icon: const Icon(Icons.add_chart),
        label: const Text('Create'),
      ),
    );
  }
}

class _HomeHeader extends StatelessWidget {
  const _HomeHeader({required this.onCreatePoll});

  final VoidCallback onCreatePoll;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Home',
            style: Theme.of(
              context,
            ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 4),
          Text(
            'Vote on fresh questions and watch the results move.',
            style: Theme.of(
              context,
            ).textTheme.bodyMedium?.copyWith(color: colors.onSurfaceVariant),
          ),
          const SizedBox(height: 16),
          _CreatePrompt(onCreatePoll: onCreatePoll),
          const SizedBox(height: 12),
          const _FeedFilters(),
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
    final colors = Theme.of(context).colorScheme;

    return Container(
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: colors.outlineVariant),
      ),
      padding: const EdgeInsets.all(12),
      child: Row(
        children: [
          CircleAvatar(
            radius: 18,
            backgroundColor: colors.primary,
            child: Icon(Icons.person, color: colors.onPrimary, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              'Ask the crowd something...',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: colors.onSurfaceVariant),
            ),
          ),
          const SizedBox(width: 8),
          FilledButton.icon(
            onPressed: onCreatePoll,
            icon: const Icon(Icons.add, size: 18),
            label: const Text('Poll'),
          ),
        ],
      ),
    );
  }
}

class _FeedFilters extends StatelessWidget {
  const _FeedFilters();

  @override
  Widget build(BuildContext context) {
    return const SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          _FilterChip(label: 'For you', selected: true),
          SizedBox(width: 8),
          _FilterChip(label: 'Following'),
          SizedBox(width: 8),
          _FilterChip(label: 'Trending'),
          SizedBox(width: 8),
          _FilterChip(label: 'Ending soon'),
        ],
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({required this.label, this.selected = false});

  final String label;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    return ChoiceChip(
      label: Text(label),
      selected: selected,
      onSelected: (_) {},
    );
  }
}

class _FeedLoadingState extends StatelessWidget {
  const _FeedLoadingState();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: SizedBox.square(
        dimension: 32,
        child: CircularProgressIndicator(strokeWidth: 3),
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
