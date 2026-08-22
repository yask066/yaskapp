import 'package:flutter/material.dart';

import '../../core/widgets/user_avatar.dart';
import '../auth/country_selector.dart';
import '../polls/poll_card.dart';
import '../polls/polls_api_client.dart';
import '../polls/poll_summary.dart';
import 'profiles_api_client.dart';
import 'public_profile.dart';

class PublicProfileScreen extends StatefulWidget {
  const PublicProfileScreen({
    required this.userId,
    required this.currentUserId,
    required this.accessToken,
    required this.profilesApiClient,
    this.pollsApiClient,
    super.key,
  });

  final String userId;
  final String currentUserId;
  final String accessToken;
  final ProfilesApiClient profilesApiClient;
  final PollsApiClient? pollsApiClient;

  @override
  State<PublicProfileScreen> createState() => _PublicProfileScreenState();
}

class _PublicProfileScreenState extends State<PublicProfileScreen> {
  late Future<PublicProfile> _profileFuture;
  Future<List<PollSummary>>? _pollsFuture;
  PublicProfile? _profile;
  var _isFollowing = false;
  var _isFollowSubmitting = false;

  bool get _isSelf => widget.userId == widget.currentUserId;

  @override
  void initState() {
    super.initState();
    _profileFuture = _loadProfile();
    if (widget.pollsApiClient != null) {
      _pollsFuture = _loadPolls();
    }
  }

  Future<List<PollSummary>> _loadPolls() {
    return widget.pollsApiClient!.listUserPolls(
      userId: widget.userId,
      accessToken: widget.accessToken,
    );
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
      appBar: AppBar(title: const Text('Profile')),
      body: FutureBuilder<PublicProfile>(
        future: _profileFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          if (snapshot.hasError) {
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
            child: ListView(
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
                    _Metric(label: 'Followers', value: profile.followersCount),
                    _Metric(label: 'Following', value: profile.followingCount),
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
                    onRetry: () {
                      setState(() {
                        _pollsFuture = _loadPolls();
                      });
                    },
                  ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}

class _PublicPollsList extends StatelessWidget {
  const _PublicPollsList({required this.future, required this.onRetry});

  final Future<List<PollSummary>> future;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<PollSummary>>(
      future: future,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Center(child: CircularProgressIndicator()),
          );
        }

        if (snapshot.hasError) {
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

        final polls = snapshot.data ?? const <PollSummary>[];

        if (polls.isEmpty) {
          return const Padding(
            padding: EdgeInsets.symmetric(vertical: 16),
            child: Text('No public polls yet.'),
          );
        }

        return Column(
          children: [
            for (var index = 0; index < polls.length; index++) ...[
              PollCard(poll: polls[index], compact: true),
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
