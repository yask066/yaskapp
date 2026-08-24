import 'dart:async';

import 'package:flutter/material.dart';

import '../auth/auth_session.dart';
import '../polls/poll_card.dart';
import '../polls/poll_comments_screen.dart';
import '../polls/poll_summary.dart';
import '../polls/polls_api_client.dart';
import '../realtime/realtime_client.dart';

class SubscriptionsScreen extends StatefulWidget {
  const SubscriptionsScreen({
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
  State<SubscriptionsScreen> createState() => _SubscriptionsScreenState();
}

class _SubscriptionsScreenState extends State<SubscriptionsScreen> {
  late final PollsApiClient _pollsApiClient;
  late final RealtimeClient _realtimeClient;
  late final bool _ownsPollsApiClient;
  late final bool _ownsRealtimeClient;
  late Future<List<PollSummary>> _pollsFuture;
  StreamSubscription<PollVoteRealtimeEvent>? _voteSubscription;
  StreamSubscription<PollDeletedRealtimeEvent>? _pollDeletedSubscription;
  List<PollSummary> _polls = [];
  var _hasLoaded = false;
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
    _voteSubscription = _realtimeClient.pollVotes.listen(_replacePoll);
    _pollDeletedSubscription =
        _realtimeClient.pollDeletions.listen(_removePoll);
    _realtimeClient.connect();
  }

  @override
  void dispose() {
    unawaited(_voteSubscription?.cancel());
    unawaited(_pollDeletedSubscription?.cancel());
    if (_ownsRealtimeClient) {
      unawaited(_realtimeClient.close());
    }
    if (_ownsPollsApiClient) {
      _pollsApiClient.close();
    }
    super.dispose();
  }

  Future<List<PollSummary>> _loadPolls() {
    return _pollsApiClient
        .listSubscriptions(accessToken: widget.session.accessToken)
        .timeout(const Duration(seconds: 10));
  }

  Future<void> _refresh() async {
    try {
      final polls = await _loadPolls();
      if (!mounted) return;
      setState(() {
        _polls = polls;
        _hasLoaded = true;
        _pollsFuture = Future.value(polls);
      });
    } on PollsApiException catch (error) {
      if (mounted) {
        _showError(error.message);
      }
    }
  }

  void _replacePoll(PollVoteRealtimeEvent event) {
    if (!mounted) return;
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
      final updated = await _pollsApiClient.setVote(
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

    try {
      await _pollsApiClient.deletePoll(
        pollId: poll.id,
        accessToken: widget.session.accessToken,
      );
      if (!mounted) return;
      setState(() => _polls.removeWhere((item) => item.id == poll.id));
    } on PollsApiException catch (error) {
      _showError(error.userMessage);
    } catch (_) {
      _showError('Could not delete poll.');
    }
  }

  Future<void> _toggleLike(PollSummary poll) async {
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
    return Scaffold(
      appBar: AppBar(title: const Text('Subscriptions')),
      body: FutureBuilder<List<PollSummary>>(
        future: _pollsFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting &&
              !_hasLoaded) {
            return const Center(child: CircularProgressIndicator());
          }

          if (snapshot.hasError && !_hasLoaded) {
            return _SubscriptionsError(onRetry: _retry);
          }

          if (!_hasLoaded && snapshot.hasData) {
            _polls = snapshot.data!;
            _hasLoaded = true;
          }

          return RefreshIndicator(
            onRefresh: _refresh,
            child: _polls.isEmpty
                ? ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    children: const [
                      SizedBox(height: 180),
                      _SubscriptionsEmpty(),
                    ],
                  )
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                    physics: const AlwaysScrollableScrollPhysics(),
                    itemCount: _polls.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (context, index) {
                      final poll = _polls[index];
                      return PollCard(
                        poll: poll,
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
                  ),
          );
        },
      ),
    );
  }

  void _retry() {
    setState(() {
      _hasLoaded = false;
      _pollsFuture = _loadPolls();
    });
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
