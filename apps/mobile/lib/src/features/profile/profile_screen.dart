import 'package:flutter/material.dart';

import '../../core/widgets/user_avatar.dart';
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
  List<PollSummary> _likedPolls = [];
  var _hasLoadedMyPolls = false;
  var _hasLoadedLikedPolls = false;
  var _selectedTab = 0;
  Future<List<PollSummary>>? _likedPollsFuture;
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

  Future<List<PollSummary>> _loadLikedPolls() async {
    final polls = await _pollsApiClient.listPolls(
      limit: 50,
      accessToken: widget.accessToken,
    );
    return polls.where((poll) => poll.viewerHasLiked).toList();
  }

  void _selectTab(int index) {
    if (_selectedTab == index) {
      return;
    }

    if (index == 1 && _likedPollsFuture == null) {
      _likedPollsFuture = _loadLikedPolls();
    }

    setState(() {
      _selectedTab = index;
    });
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
          onLogout: widget.onLogout,
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
    final displayName = widget.user.profile.displayName;
    final bio = widget.user.profile.bio;
    const navy = Color(0xFF08089A);

    return Scaffold(
      backgroundColor: const Color(0xFFF7F8FC),
      body: SafeArea(
        child: CustomScrollView(
          slivers: [
            SliverAppBar(
              pinned: true,
              toolbarHeight: 72,
              backgroundColor: Colors.white,
              surfaceTintColor: Colors.transparent,
              elevation: 0,
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
              actions: [
                PopupMenuButton<String>(
                  tooltip: 'Settings',
                  icon: const Icon(Icons.settings_outlined, size: 24),
                  constraints: const BoxConstraints.tightFor(
                    width: 40,
                    height: 40,
                  ),
                  onSelected: (value) {
                    if (value == 'edit') {
                      _openEditProfile(context);
                    } else if (value == 'logout') {
                      widget.onLogout();
                    }
                  },
                  itemBuilder: (context) => const [
                    PopupMenuItem(
                      value: 'edit',
                      child: Text('Edit profile'),
                    ),
                    PopupMenuItem(
                      value: 'logout',
                      child: Text('Logout'),
                    ),
                  ],
                ),
                const SizedBox(width: 20),
              ],
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.only(top: 16),
                child: Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      child: Column(
                        children: [
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              UserAvatar(
                                displayName: displayName,
                                username: widget.user.username,
                                imageUrl: widget.user.profile.avatarObjectKey,
                                radius: 40,
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
                                      style: const TextStyle(
                                        color: Color(0xFF10142D),
                                        fontSize: 22,
                                        height: 26 / 22,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      '@${widget.user.username}',
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        color: Color(0xFF667085),
                                        fontSize: 15,
                                        height: 20 / 15,
                                      ),
                                    ),
                                    if (bio != null && bio.trim().isNotEmpty) ...[
                                      const SizedBox(height: 8),
                                      Text(
                                        bio,
                                        maxLines: 3,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                          color: Color(0xFF344054),
                                          fontSize: 15,
                                          height: 20 / 15,
                                        ),
                                      ),
                                    ],
                                  ],
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 24),
                          SizedBox(
                            height: 56,
                            child: Row(
                              children: [
                                _ProfileMetric(
                                  label: 'Polls',
                                  value: widget.user.profile.pollsCount.toString(),
                                ),
                                const _ProfileDivider(),
                                _ProfileMetric(
                                  label: 'Followers',
                                  value: widget.user.profile.followersCount.toString(),
                                ),
                                const _ProfileDivider(),
                                _ProfileMetric(
                                  label: 'Following',
                                  value: widget.user.profile.followingCount.toString(),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 20),
                          SizedBox(
                            height: 48,
                            width: double.infinity,
                            child: OutlinedButton.icon(
                              onPressed: () => _openEditProfile(context),
                              icon: const Icon(Icons.edit_outlined, size: 18),
                              label: const Text('Edit profile'),
                              style: OutlinedButton.styleFrom(
                                foregroundColor: navy,
                                side: const BorderSide(color: navy),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(16),
                                ),
                                padding: const EdgeInsets.symmetric(horizontal: 16),
                                textStyle: const TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 24),
                    SizedBox(
                      height: 52,
                      child: Row(
                        children: [
                          Expanded(
                            child: _ProfileTab(
                              label: 'My polls',
                              selected: _selectedTab == 0,
                              onTap: () => _selectTab(0),
                            ),
                          ),
                          Expanded(
                            child: _ProfileTab(
                              label: 'Liked polls',
                              selected: _selectedTab == 1,
                              onTap: () => _selectTab(1),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
                child: FutureBuilder<List<PollSummary>>(
                  future: _selectedTab == 0
                      ? _myPollsFuture
                      : _likedPollsFuture!,
                  builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting &&
                    (_selectedTab == 0
                        ? !_hasLoadedMyPolls
                        : !_hasLoadedLikedPolls)) {
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

                if (snapshot.hasError &&
                    (_selectedTab == 0
                        ? !_hasLoadedMyPolls
                        : !_hasLoadedLikedPolls)) {
                  return _MyPollsErrorState(
                    onRetry: _selectedTab == 0
                        ? _retryMyPolls
                        : () {
                            setState(() {
                              _likedPollsFuture = _loadLikedPolls();
                            });
                          },
                  );
                }

                if (snapshot.hasData) {
                  if (_selectedTab == 0) {
                    _myPolls = snapshot.data ?? [];
                    _hasLoadedMyPolls = true;
                  } else {
                    _likedPolls = snapshot.data ?? [];
                    _hasLoadedLikedPolls = true;
                  }
                }

                final polls = _selectedTab == 0 ? _myPolls : _likedPolls;

                if (polls.isEmpty) {
                  return const _MyPollsEmptyState();
                }

                return Column(
                  children: [
                    for (final poll in polls) ...[
                      PollCard(
                        poll: poll,
                        compact: true,
                        onOpenComments: () => _openComments(poll),
                        onToggleLike: _likingPollIds.contains(poll.id)
                            ? null
                            : () => _toggleLike(poll),
                        isLiking: _likingPollIds.contains(poll.id),
                      ),
                      const SizedBox(height: 12),
                    ],
                  ],
                );
                  },
                ),
              ),
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
    return Expanded(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            value,
            style: const TextStyle(
              color: Color(0xFF10142D),
              fontSize: 18,
              height: 22 / 18,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: const TextStyle(
              color: Color(0xFF475467),
              fontSize: 13,
              height: 17 / 13,
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileDivider extends StatelessWidget {
  const _ProfileDivider();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      height: 36,
      child: VerticalDivider(
        width: 1,
        thickness: 1,
        color: Color(0xFFE4E7EC),
      ),
    );
  }
}

class _ProfileTab extends StatelessWidget {
  const _ProfileTab({
    required this.label,
    required this.onTap,
    this.selected = false,
  });

  final String label;
  final VoidCallback onTap;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Column(
        children: [
          Text(
            label,
            style: TextStyle(
              color: selected
                  ? const Color(0xFF08089A)
                  : const Color(0xFF475467),
              fontSize: 14,
              fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
            ),
          ),
          const Spacer(),
          Container(
            height: 2,
            color: selected ? const Color(0xFF08089A) : Colors.transparent,
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
