class AuthUserProfile {
  const AuthUserProfile({
    required this.displayName,
    required this.pollsCount,
    required this.followersCount,
    required this.followingCount,
    this.countryCode,
    this.bio,
    this.avatarObjectKey,
  });

  factory AuthUserProfile.fromJson(Map<String, dynamic> json) {
    return AuthUserProfile(
      displayName: json['displayName'] as String,
      pollsCount: json['pollsCount'] as int? ?? 0,
      followersCount: json['followersCount'] as int? ?? 0,
      followingCount: json['followingCount'] as int? ?? 0,
      countryCode: json['countryCode'] as String?,
      bio: json['bio'] as String?,
      avatarObjectKey: json['avatarObjectKey'] as String?,
    );
  }

  final String displayName;
  final int pollsCount;
  final int followersCount;
  final int followingCount;
  final String? countryCode;
  final String? bio;
  final String? avatarObjectKey;
}

class AuthUser {
  const AuthUser({
    required this.id,
    required this.email,
    required this.username,
    required this.status,
    required this.profile,
  });

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      id: json['id'] as String,
      email: json['email'] as String,
      username: json['username'] as String,
      status: json['status'] as String,
      profile:
          AuthUserProfile.fromJson(json['profile'] as Map<String, dynamic>),
    );
  }

  final String id;
  final String email;
  final String username;
  final String status;
  final AuthUserProfile profile;
}

class AuthSession {
  const AuthSession({
    required this.user,
    required this.accessToken,
    required this.tokenType,
    required this.expiresIn,
  });

  factory AuthSession.fromJson(Map<String, dynamic> json) {
    return AuthSession(
      user: AuthUser.fromJson(json['user'] as Map<String, dynamic>),
      accessToken: json['accessToken'] as String,
      tokenType: json['tokenType'] as String,
      expiresIn: json['expiresIn'] as String,
    );
  }

  final AuthUser user;
  final String accessToken;
  final String tokenType;
  final String expiresIn;

  AuthSession copyWith({AuthUser? user}) {
    return AuthSession(
      user: user ?? this.user,
      accessToken: accessToken,
      tokenType: tokenType,
      expiresIn: expiresIn,
    );
  }
}
