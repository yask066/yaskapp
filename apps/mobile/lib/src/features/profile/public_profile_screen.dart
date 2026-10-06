import 'package:flutter/material.dart';

import '../../core/scroll/list_scroll_anchor_host.dart';
import '../../core/scroll/list_scroll_state.dart';
import '../../core/widgets/content_skeleton.dart';
import '../../core/widgets/user_avatar.dart';
import '../auth/country_selector.dart';
import '../polls/poll_card.dart';
import '../polls/polls_api_client.dart';
import '../polls/poll_summary.dart';
import 'profiles_api_client.dart';
import 'public_profile.dart';
import '../reports/report_dialog.dart';
import '../reports/reports_api_client.dart';

class PublicProfileScreen extends StatefulWidget {
  const PublicProfileScreen({
    required this.userId,
    required this.currentUserId,
    required this.accessToken,
    required this.profilesApiClient,
    this.pollsApiClient,
    this.reportsApiClient,
    this.initialProfile,
    super.key,
  });

  final String userId;
  final String currentUserId;
  final String accessToken;
  final ProfilesApiClient profilesApiClient;
  final PollsApiClient? pollsApiClient;
  final ReportsApiClient? reportsApiClient;
  final PublicProfile? initialProfile;

  @override
  State<PublicProfileScreen> createState() => _PublicProfileScreenState();
}

class _PublicProfileScreenState extends State<PublicProfileScreen> {
  late Future<PublicProfile> _profileFuture;
  Future<List<PollSummary>>? _pollsFuture;
  PublicProfile? _profile;
  List<PollSummary> _publicPolls = [];
  final _scrollController = ScrollController();
  var _isFollowing = false;
  var _isFollowSubmitting = false;
  late final ReportsApiClient _reportsApiClient;
  late final bool _ownsReportsApiClient;

  bool get _isSelf => widget.userId == widget.currentUserId;

  @override
  void initState() {
    super.initState();
    _profile = widget.initialProfile;
    _isFollowing = _profile?.viewerIsFollowing ?? false;
    _profileFuture = _profile == null
        ? _loadProfile()
        : Future<PublicProfile>.value(_profile!);
    _ownsReportsApiClient = widget.reportsApiClient == null;
    _reportsApiClient = widget.reportsApiClient ?? ReportsApiClient();
    if (widget.pollsApiClient != null) {
      _pollsFuture = _loadPolls();
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    if (_ownsReportsApiClient) _reportsApiClient.close();
    super.dispose();
  }

  Future<void> _reportUser() {
    return showReportDialog(
      context: context,
      accessToken: widget.accessToken,
      targetType: 'user',
      targetId: widget.userId,
      reportsApiClient: _reportsApiClient,
    );
  }

  Future<List<PollSummary>> _loadPolls() async {
    final polls = await widget.pollsApiClient!.listUserPolls(
      userId: widget.userId,
      accessToken: widget.accessToken,
    );
    if (mounted) setState(() => _publicPolls = polls);
    return polls;
  }

  Future<PublicProfile> _loadProfile() async {
    final profile = await widget.profilesApiClient.getPublicProfile(
      userId: widget.userId,
      accessToken: widget.accessToken,
    );

    if (mounted) {
      setState(() {
        _profile = profile;
        _isFollowing = profile.viewerIsFollowing;
      });
    }

    return profile;
  }

  Future<void> _toggleFollow() async {
    final profile = _profile;

    if (profile == null || _isFollowSubmitting || _isSelf) {
      return;
    }

    final previousFollowing = _isFollowing;
    setState(() {
      _isFollowSubmitting = true;
      _isFollowing = !previousFollowing;
    });

    try {
      final relationship = previousFollowing
          ? await widget.profilesApiClient.unfollow(
              userId: widget.userId,
              accessToken: widget.accessToken,
            )
          : await widget.profilesApiClient.follow(
              userId: widget.userId,
              accessToken: widget.accessToken,
            );

      if (!mounted) {
        return;
      }

      setState(() {
        _isFollowing = relationship.following;
        _profile = profile.copyWith(
          followersCount: relationship.followeeFollowersCount,
          viewerIsFollowing: relationship.following,
        );
      });
    } on ProfilesApiException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isFollowing = previousFollowing;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.message)),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isFollowSubmitting = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Profile'),
        actions: [
          if (!_isSelf)
            IconButton(
              tooltip: 'Report user',
              onPressed: _reportUser,
              icon: const Icon(Icons.flag_outlined),
            ),
        ],
      ),
      body: FutureBuilder<PublicProfile>(
        future: _profileFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting &&
              _profile == null) {
            return const SingleChildScrollView(
              padding: EdgeInsets.all(20),
              child: DelayedContentSkeleton(
                kind: ContentSkeletonKind.user,
                rows: 1,
              ),
            );
          }

          if (snapshot.hasError && _profile == null) {
            return _ProfileErrorState(
              onRetry: () {
                setState(() {
                  _profileFuture = _loadProfile();
                });
              },
            );
          }

          final profile = _profile ?? snapshot.data;

          if (profile == null) {
            return const Center(child: Text('Profile is unavailable.'));
          }

          final countryName = countryNameForCode(profile.countryCode);

          return RefreshIndicator(
            onRefresh: () async {
              setState(() {
                _profileFuture = _loadProfile();
                if (_pollsFuture != null) {
                  _pollsFuture = _loadPolls();
                }
              });
              await Future.wait([
                _profileFuture,
                if (_pollsFuture != null) _pollsFuture!,
              ]);
            },
            child: ListScrollAnchorHost(
              context: ListScrollContext(
                userId: widget.currentUserId,
                route: '/users/${widget.userId}',
                list: 'polls',
                query: '',
                filter: '',
                sort: '',
              ),
              store: listScrollStateStore,
              controller: _scrollController,
              itemIds: _publicPolls.map((poll) => 'poll-${poll.id}').toList(),
              child: ListView(
                controller: _scrollController,
                padding: const EdgeInsets.fromLTRB(20, 24, 20, 32),
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      UserAvatar(
                        displayName: profile.displayName,
                        username: profile.username,
                        imageUrl: profile.avatarUrl,
                        radius: 40,
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              profile.username,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 22,
                                fontWeight: FontWeight.bold,
                                color: Color(0xFF10142D),
                              ),
                            ),
                            Text(
                              '@${profile.username}',
                              style: const TextStyle(
                                fontSize: 14,
                                color: Color(0xFF667085),
                              ),
                            ),
                            if (countryName != null)
                              Padding(
                                padding: const EdgeInsets.only(top: 4),
                                child: Text(
                                  countryName,
                                  style: const TextStyle(
                                    fontSize: 14,
                                    color: Color(0xFF667085),
                                  ),
                                ),
                              ),
                            if (profile.bio?.isNotEmpty == true) ...[
                              const SizedBox(height: 8),
                              Text(
                                profile.bio!,
                                maxLines: 3,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 14,
                                  height: 20 / 14,
                                  color: Color(0xFF475467),
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 24),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      _Metric(label: 'Polls', value: profile.pollsCount),
                      _Metric(
                          label: 'Followers', value: profile.followersCount),
                      _Metric(
                          label: 'Following', value: profile.followingCount),
                    ],
                  ),
                  if (!_isSelf) ...[
                    const SizedBox(height: 20),
                    SizedBox(
                      height: 48,
                      child: _isFollowing
                          ? OutlinedButton.icon(
                              onPressed:
                                  _isFollowSubmitting ? null : _toggleFollow,
                              icon: const Icon(Icons.person_remove_outlined),
                              label: const Text('Following'),
                            )
                          : FilledButton.icon(
                              onPressed:
                                  _isFollowSubmitting ? null : _toggleFollow,
                              icon: const Icon(Icons.person_add_outlined),
                              label: const Text('Follow'),
                            ),
                    ),
                  ],
                  if (_pollsFuture != null) ...[
                    const SizedBox(height: 28),
                    const Text(
                      'Polls',
                      style: TextStyle(
                        color: Color(0xFF10142D),
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 12),
                    _PublicPollsList(
                      future: _pollsFuture!,
                      cachedPolls: _publicPolls,
                      onRetry: () {
                        setState(() {
                          _pollsFuture = _loadPolls();
                        });
                      },
                    ),
                  ],
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class _PublicPollsList extends StatelessWidget {
  const _PublicPollsList({
    required this.future,
    required this.cachedPolls,
    required this.onRetry,
  });

  final Future<List<PollSummary>> future;
  final List<PollSummary> cachedPolls;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<PollSummary>>(
      future: future,
      builder: (context, snapshot) {
        final polls = snapshot.data ?? cachedPolls;

        if (snapshot.connectionState == ConnectionState.waiting &&
            polls.isEmpty) {
          return const Padding(
            padding: EdgeInsets.symmetric(vertical: 16),
            child: DelayedContentSkeleton(
              kind: ContentSkeletonKind.poll,
              rows: 1,
            ),
          );
        }

        if (snapshot.hasError && polls.isEmpty) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Column(
              children: [
                const Text('Could not load polls.'),
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: onRetry,
                  child: const Text('Retry'),
                ),
              ],
            ),
          );
        }

        if (polls.isEmpty) {
          return const Padding(
            padding: EdgeInsets.symmetric(vertical: 16),
            child: Text('No public polls yet.'),
          );
        }

        return Column(
          children: [
            if (snapshot.hasError)
              Row(
                children: [
                  const Expanded(child: Text('Could not refresh polls.')),
                  TextButton(onPressed: onRetry, child: const Text('Retry')),
                ],
              ),
            for (var index = 0; index < polls.length; index++) ...[
              ListScrollAnchorItem(
                id: 'poll-${polls[index].id}',
                child: PollCard(
                  key: ValueKey('poll-${polls[index].id}'),
                  poll: polls[index],
                  compact: true,
                ),
              ),
              if (index != polls.length - 1) const SizedBox(height: 12),
            ],
          ],
        );
      },
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value});

  final String label;
  final int value;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          '$value',
          style: const TextStyle(
            color: Color(0xFF566A9D),
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Color(0xFF667085))),
      ],
    );
  }
}

class _ProfileErrorState extends StatelessWidget {
  const _ProfileErrorState({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('Could not load profile.'),
          const SizedBox(height: 12),
          OutlinedButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}
