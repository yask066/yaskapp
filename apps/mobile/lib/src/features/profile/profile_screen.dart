import 'package:flutter/material.dart';

import '../auth/auth_api_client.dart';
import '../auth/auth_session.dart';
import '../polls/poll_card.dart';
import '../polls/poll_comments_screen.dart';
import '../polls/poll_summary.dart';
import '../polls/polls_api_client.dart';
import 'edit_profile_screen.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({
    required this.user,
    required this.accessToken,
    required this.authApiClient,
    required this.onLogout,
    required this.onUserUpdated,
    super.key,
    PollsApiClient? pollsApiClient,
  }) : _pollsApiClient = pollsApiClient;

  final AuthUser user;
  final String accessToken;
  final AuthApiClient authApiClient;
  final VoidCallback onLogout;
  final ValueChanged<AuthUser> onUserUpdated;
  final PollsApiClient? _pollsApiClient;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  late final PollsApiClient _pollsApiClient;
  late Future<List<PollSummary>> _myPollsFuture;
  late final bool _ownsPollsApiClient;
  List<PollSummary> _myPolls = [];
  var _hasLoadedMyPolls = false;
  final Set<String> _likingPollIds = {};

  @override
  void initState() {
    super.initState();
    _ownsPollsApiClient = widget._pollsApiClient == null;
    _pollsApiClient = widget._pollsApiClient ?? PollsApiClient();
    _myPollsFuture = _loadMyPolls();
  }

  @override
  void dispose() {
    if (_ownsPollsApiClient) {
      _pollsApiClient.close();
    }

    super.dispose();
  }

  Future<List<PollSummary>> _loadMyPolls() {
    return _pollsApiClient.listMyPolls(accessToken: widget.accessToken);
  }

  void _syncMyPolls(List<PollSummary> polls) {
    setState(() {
      _myPolls = polls;
    });
  }

  void _retryMyPolls() {
    setState(() {
      _myPollsFuture = _loadMyPolls();
    });
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
              accessToken: widget.accessToken,
            )
          : await _pollsApiClient.likePoll(
              pollId: poll.id,
              accessToken: widget.accessToken,
            );

      if (!mounted) {
        return;
      }

      _syncMyPolls(
        _myPolls
            .map((currentPoll) =>
                currentPoll.id == updatedPoll.id ? updatedPoll : currentPoll)
            .toList(),
      );
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

  Future<void> _openEditProfile(BuildContext context) async {
    final updatedUser = await Navigator.of(context).push<AuthUser>(
      MaterialPageRoute(
        builder: (context) => EditProfileScreen(
          user: widget.user,
          accessToken: widget.accessToken,
          authApiClient: widget.authApiClient,
        ),
      ),
    );

    if (updatedUser == null || !context.mounted) {
      return;
    }

    widget.onUserUpdated(updatedUser);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Profile updated.')),
    );
  }

  Future<void> _openComments(PollSummary poll) async {
    final updatedPoll = await Navigator.of(context).push<PollSummary>(
      MaterialPageRoute<PollSummary>(
        builder: (context) => PollCommentsScreen(
          poll: poll,
          accessToken: widget.accessToken,
          pollsApiClient: _pollsApiClient,
        ),
      ),
    );

    if (updatedPoll == null || !mounted) {
      return;
    }

    _syncMyPolls(
      _myPolls
          .map(
            (currentPoll) =>
                currentPoll.id == updatedPoll.id ? updatedPoll : currentPoll,
          )
          .toList(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final displayName = widget.user.profile.displayName;
    final bio = widget.user.profile.bio;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Profile'),
        actions: [
          IconButton(
            tooltip: 'Edit profile',
            onPressed: () => _openEditProfile(context),
            icon: const Icon(Icons.edit_outlined),
          ),
          IconButton(
            tooltip: 'Logout',
            onPressed: widget.onLogout,
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 36,
                  backgroundColor: colors.primaryContainer,
                  child: Text(
                    displayName.substring(0, 1).toUpperCase(),
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                          color: colors.onPrimaryContainer,
                          fontWeight: FontWeight.w800,
                        ),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        displayName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context)
                            .textTheme
                            .titleLarge
                            ?.copyWith(fontWeight: FontWeight.w800),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '@${widget.user.username}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: colors.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            if (bio != null && bio.trim().isNotEmpty) ...[
              Text(
                bio,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              const SizedBox(height: 20),
            ],
            _ProfileSection(
              children: [
                _ProfileRow(
                  icon: Icons.mail_outline,
                  label: 'Email',
                  value: widget.user.email,
                ),
                _ProfileRow(
                  icon: Icons.verified_user_outlined,
                  label: 'Status',
                  value: widget.user.status,
                ),
              ],
            ),
            const SizedBox(height: 16),
            _ProfileSection(
              children: [
                _ProfileMetric(
                  label: 'Polls',
                  value: widget.user.profile.pollsCount.toString(),
                ),
                _ProfileMetric(
                  label: 'Followers',
                  value: widget.user.profile.followersCount.toString(),
                ),
                _ProfileMetric(
                  label: 'Following',
                  value: widget.user.profile.followingCount.toString(),
                ),
              ],
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: () => _openEditProfile(context),
              icon: const Icon(Icons.edit_outlined),
              label: const Text('Edit profile'),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: widget.onLogout,
              icon: const Icon(Icons.logout),
              label: const Text('Logout'),
            ),
            const SizedBox(height: 24),
            Text(
              'My polls',
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            FutureBuilder<List<PollSummary>>(
              future: _myPollsFuture,
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting &&
                    !_hasLoadedMyPolls) {
                  return const Padding(
                    padding: EdgeInsets.symmetric(vertical: 24),
                    child: Center(
                      child: SizedBox.square(
                        dimension: 28,
                        child: CircularProgressIndicator(strokeWidth: 3),
                      ),
                    ),
                  );
                }

                if (snapshot.hasError && !_hasLoadedMyPolls) {
                  return _MyPollsErrorState(onRetry: _retryMyPolls);
                }

                if (!_hasLoadedMyPolls && snapshot.hasData) {
                  _myPolls = snapshot.data ?? [];
                  _hasLoadedMyPolls = true;
                }

                final polls = _myPolls;

                if (polls.isEmpty) {
                  return const _MyPollsEmptyState();
                }

                return Column(
                  children: [
                    for (final poll in polls) ...[
                      PollCard(
                        poll: poll,
                        onOpenComments: () => _openComments(poll),
                        onToggleLike: _likingPollIds.contains(poll.id)
                            ? null
                            : () => _toggleLike(poll),
                      ),
                      const SizedBox(height: 12),
                    ],
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _ProfileSection extends StatelessWidget {
  const _ProfileSection({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: colors.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: children,
        ),
      ),
    );
  }
}

class _ProfileRow extends StatelessWidget {
  const _ProfileRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Icon(icon, color: colors.onSurfaceVariant),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              label,
              style: TextStyle(color: colors.onSurfaceVariant),
            ),
          ),
          Flexible(
            child: Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.end,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileMetric extends StatelessWidget {
  const _ProfileMetric({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(color: colors.onSurfaceVariant),
            ),
          ),
          Text(
            value,
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.w800),
          ),
        ],
      ),
    );
  }
}

class _MyPollsErrorState extends StatelessWidget {
  const _MyPollsErrorState({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Column(
        children: [
          Icon(Icons.cloud_off_outlined, color: colors.onSurfaceVariant),
          const SizedBox(height: 8),
          Text(
            'Could not load your polls',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

class _MyPollsEmptyState extends StatelessWidget {
  const _MyPollsEmptyState();

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Column(
        children: [
          Icon(Icons.how_to_vote_outlined, color: colors.onSurfaceVariant),
          const SizedBox(height: 8),
          Text(
            'No polls yet',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 6),
          Text(
            'Polls you create will appear here.',
            textAlign: TextAlign.center,
            style: TextStyle(color: colors.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}
