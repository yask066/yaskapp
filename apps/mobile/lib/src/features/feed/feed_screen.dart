import 'dart:async';

import 'package:flutter/material.dart';

import '../auth/auth_session.dart';
import '../polls/create_poll_screen.dart';
import '../polls/poll_card.dart';
import '../polls/poll_comments_screen.dart';
import '../polls/poll_summary.dart';
import '../polls/polls_api_client.dart';
import '../profile/profiles_api_client.dart';
import '../profile/public_profile_screen.dart';
import '../realtime/realtime_client.dart';

class FeedScreen extends StatefulWidget {
  const FeedScreen({
    required this.session,
    super.key,
    PollsApiClient? pollsApiClient,
    ProfilesApiClient? profilesApiClient,
    RealtimeClient? realtimeClient,
  })  : _pollsApiClient = pollsApiClient,
        _profilesApiClient = profilesApiClient,
        _realtimeClient = realtimeClient;

  final AuthSession session;
  final PollsApiClient? _pollsApiClient;
  final ProfilesApiClient? _profilesApiClient;
  final RealtimeClient? _realtimeClient;

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
  StreamSubscription<PollVoteRealtimeEvent>? _pollVoteSubscription;
  StreamSubscription<PollDeletedRealtimeEvent>? _pollDeletedSubscription;
  List<PollSummary> _polls = [];
  var _hasLoadedPolls = false;
  final Set<String> _votingPollIds = {};
  final Set<String> _likingPollIds = {};

  @override
  void initState() {
    super.initState();
    _ownsPollsApiClient = widget._pollsApiClient == null;
    _ownsProfilesApiClient = widget._profilesApiClient == null;
    _ownsRealtimeClient = widget._realtimeClient == null;
    _pollsApiClient = widget._pollsApiClient ?? PollsApiClient();
    _profilesApiClient = widget._profilesApiClient ?? ProfilesApiClient();
    _realtimeClient = widget._realtimeClient ?? RealtimeClient();
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

    super.dispose();
  }

  Future<List<PollSummary>> _loadPolls() {
    return _pollsApiClient
        .listPolls(accessToken: widget.session.accessToken)
        .timeout(const Duration(seconds: 10));
  }

  Future<void> _refreshPolls() async {
    try {
      final nextPolls = await _loadPolls();

      if (!mounted) {
        return;
      }

      setState(() {
        _polls = nextPolls;
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

    final currentPoll = _polls[existingIndex];
    _replacePollInFeed(
      event.poll.copyWith(viewerVoteOptionId: currentPoll.viewerVoteOptionId),
    );
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
      final updatedPoll = await _pollsApiClient.setVote(
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
      backgroundColor: const Color(0xFFF7F8FC),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _refreshPolls,
          child: CustomScrollView(
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
                      onPressed: () {},
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
                  SizedBox(
                    width: 40,
                    height: 40,
                    child: IconButton(
                      tooltip: 'Notifications',
                      onPressed: () {},
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints.tightFor(
                        width: 40,
                        height: 40,
                      ),
                      icon: Stack(
                        clipBehavior: Clip.none,
                        children: [
                          Image.asset(
                            'assets/branding/notification_icon.png',
                            width: 28,
                            height: 28,
                            fit: BoxFit.contain,
                          ),
                          Positioned(
                            top: -3,
                            right: -2,
                            child: Container(
                              width: 8,
                              height: 8,
                              decoration: const BoxDecoration(
                                color: Color(0xFFFA7F2D),
                                shape: BoxShape.circle,
                              ),
                            ),
                          ),
                        ],
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

                        return PollCard(
                          poll: poll,
                          onOpenAuthor: () => _openAuthorProfile(poll),
                          onVote: poll.isClosed || _votingPollIds.contains(poll.id)
                              ? null
                              : (option) => _vote(poll, option),
                          onCancelVote: poll.isClosed ||
                                  _votingPollIds.contains(poll.id)
                              ? null
                              : () => _cancelVote(poll),
                          onDeletePoll: poll.author.id == widget.session.user.id
                              ? () => _deletePoll(poll)
                              : null,
                          isVoting: _votingPollIds.contains(poll.id),
                          onOpenComments: () => _openComments(poll),
                          onToggleLike: _likingPollIds.contains(poll.id)
                              ? null
                              : () => _toggleLike(poll),
                          isLiking: _likingPollIds.contains(poll.id),
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
      constraints: const BoxConstraints.tightFor(height: 64),
      padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
      clipBehavior: Clip.antiAlias,
      child: Row(
        children: [
          const Icon(
            Icons.chat_bubble_outline_rounded,
            color: Color(0xFF566078),
            size: 24,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: const Text(
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
          FilledButton.icon(
            onPressed: onCreatePoll,
            icon: const Icon(Icons.add, size: 21),
            label: const Text('Create poll'),
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFFA7F2D),
              foregroundColor: Colors.white,
              fixedSize: const Size(127, 38),
              padding: const EdgeInsets.symmetric(horizontal: 14),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(28),
              ),
              textStyle: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
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
    return Container(
      height: 52,
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(26),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0F050C3F),
            blurRadius: 12,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(child: _FilterChip(label: 'For you', selected: true)),
          const _FilterDivider(),
          Expanded(child: _FilterChip(label: 'Following')),
          const _FilterDivider(),
          Expanded(child: _FilterChip(label: 'Trending')),
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
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      child: Material(
        color: selected ? const Color(0xFF566A9D) : Colors.transparent,
        borderRadius: BorderRadius.circular(24),
        child: InkWell(
          onTap: () {},
          borderRadius: BorderRadius.circular(24),
          child: SizedBox(
            height: 48,
            child: Padding(
              padding: EdgeInsets.zero,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (selected) ...[
                    const Icon(Icons.check, color: Colors.white, size: 18),
                    const SizedBox(width: 6),
                  ],
                  Flexible(
                    child: Text(
                      label,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color:
                            selected ? Colors.white : const Color(0xFF566A9D),
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
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

class _FilterDivider extends StatelessWidget {
  const _FilterDivider();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      width: 1,
      height: 32,
      child: ColoredBox(color: Color(0xFFE5E7EB)),
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
