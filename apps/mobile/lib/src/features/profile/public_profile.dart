class PublicProfile {
  const PublicProfile({
    required this.id,
    required this.username,
    required this.status,
    required this.displayName,
    required this.bio,
    required this.countryCode,
    required this.avatarObjectKey,
    required this.pollsCount,
    required this.followersCount,
    required this.followingCount,
    required this.viewerIsFollowing,
  });

  factory PublicProfile.fromJson(Map<String, dynamic> json) {
    final profile = json['profile'];

    if (profile is! Map<String, dynamic>) {
      throw const FormatException('Public profile details are missing.');
    }

    return PublicProfile(
      id: json['id'] as String,
      username: json['username'] as String,
      status: json['status'] as String,
      displayName: profile['displayName'] as String,
      bio: profile['bio'] as String?,
      countryCode: profile['countryCode'] as String?,
      avatarObjectKey: profile['avatarObjectKey'] as String?,
      pollsCount: profile['pollsCount'] as int,
      followersCount: profile['followersCount'] as int,
      followingCount: profile['followingCount'] as int,
      viewerIsFollowing: json['viewerIsFollowing'] as bool? ?? false,
    );
  }

  final String id;
  final String username;
  final String status;
  final String displayName;
  final String? bio;
  final String? countryCode;
  final String? avatarObjectKey;
  final int pollsCount;
  final int followersCount;
  final int followingCount;
  final bool viewerIsFollowing;

  PublicProfile copyWith({
    int? followersCount,
    bool? viewerIsFollowing,
  }) {
    return PublicProfile(
      id: id,
      username: username,
      status: status,
      displayName: displayName,
      bio: bio,
      countryCode: countryCode,
      avatarObjectKey: avatarObjectKey,
      pollsCount: pollsCount,
      followersCount: followersCount ?? this.followersCount,
      followingCount: followingCount,
      viewerIsFollowing: viewerIsFollowing ?? this.viewerIsFollowing,
    );
  }
}

class FollowRelationship {
  const FollowRelationship({
    required this.following,
    required this.followerFollowingCount,
    required this.followeeFollowersCount,
  });

  factory FollowRelationship.fromJson(Map<String, dynamic> json) {
    return FollowRelationship(
      following: json['following'] as bool,
      followerFollowingCount: json['followerFollowingCount'] as int,
      followeeFollowersCount: json['followeeFollowersCount'] as int,
    );
  }

  final bool following;
  final int followerFollowingCount;
  final int followeeFollowersCount;
}
