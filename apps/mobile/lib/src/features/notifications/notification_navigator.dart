import 'package:flutter/material.dart';

import '../polls/poll_comments_screen.dart';
import '../polls/polls_api_client.dart';
import '../profile/profiles_api_client.dart';
import '../profile/public_profile_screen.dart';
import 'notification_model.dart';

class NotificationNavigationScope extends InheritedWidget {
  const NotificationNavigationScope({
    required this.accessToken,
    required this.currentUserId,
    required this.pollsApiClient,
    required super.child,
    this.profilesApiClient,
    super.key,
  });

  final String accessToken;
  final String currentUserId;
  final PollsApiClient pollsApiClient;
  final ProfilesApiClient? profilesApiClient;

  static NotificationNavigationScope? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<NotificationNavigationScope>();

  @override
  bool updateShouldNotify(NotificationNavigationScope oldWidget) =>
      accessToken != oldWidget.accessToken ||
      currentUserId != oldWidget.currentUserId ||
      pollsApiClient != oldWidget.pollsApiClient ||
      profilesApiClient != oldWidget.profilesApiClient;
}

Future<void> openNotificationTarget(
  BuildContext context,
  NotificationItem item,
) async {
  if (!item.isTargetAvailable) {
    _showTargetMessage(context, 'This content is no longer available.');
    return;
  }

  final scope = NotificationNavigationScope.maybeOf(context);
  if (scope == null) {
    _showTargetMessage(context, 'Could not open this notification.');
    return;
  }

  if (item.type == NotificationType.follow) {
    await _openProfile(context, scope, item);
    return;
  }

  final isCommentTarget = item.type == NotificationType.comment ||
      item.type == NotificationType.commentReply ||
      item.type == NotificationType.like && item.commentId != null;
  final pollId = item.pollId;
  final commentId = item.commentId;
  if (pollId == null ||
      pollId.isEmpty ||
      isCommentTarget && (commentId == null || commentId.isEmpty)) {
    _showTargetMessage(context, 'This content is no longer available.');
    return;
  }

  try {
    final poll = await scope.pollsApiClient.getPoll(
      pollId: pollId,
      accessToken: scope.accessToken,
    );
    if (!context.mounted) return;

    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => PollCommentsScreen(
          poll: poll,
          accessToken: scope.accessToken,
          pollsApiClient: scope.pollsApiClient,
          currentUserId: scope.currentUserId,
          initialCommentId: isCommentTarget ? commentId : null,
        ),
      ),
    );
  } on PollsApiException catch (error) {
    if (!context.mounted) return;
    _showTargetMessage(
      context,
      error.statusCode == 404
          ? 'This content is no longer available.'
          : 'Could not open this notification. Please try again.',
    );
  } on Object {
    if (!context.mounted) return;
    _showTargetMessage(
        context, 'Could not open this notification. Please try again.');
  }
}

Future<void> _openProfile(
  BuildContext context,
  NotificationNavigationScope scope,
  NotificationItem item,
) async {
  final actorId = item.actor?.id;
  if (actorId == null || actorId.isEmpty) {
    _showTargetMessage(context, 'This profile is no longer available.');
    return;
  }

  final client = scope.profilesApiClient ?? ProfilesApiClient();
  final ownsClient = scope.profilesApiClient == null;
  try {
    final profile = await client.getPublicProfile(
      userId: actorId,
      accessToken: scope.accessToken,
    );
    if (!context.mounted) return;

    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => PublicProfileScreen(
          userId: actorId,
          currentUserId: scope.currentUserId,
          accessToken: scope.accessToken,
          profilesApiClient: client,
          pollsApiClient: scope.pollsApiClient,
          initialProfile: profile,
        ),
      ),
    );
  } on ProfilesApiException catch (error) {
    if (!context.mounted) return;
    _showTargetMessage(
      context,
      error.statusCode == 404
          ? 'This profile is no longer available.'
          : 'Could not open this notification. Please try again.',
    );
  } on Object {
    if (!context.mounted) return;
    _showTargetMessage(
        context, 'Could not open this notification. Please try again.');
  } finally {
    if (ownsClient) client.close();
  }
}

void _showTargetMessage(BuildContext context, String message) {
  ScaffoldMessenger.maybeOf(context)?.showSnackBar(
    SnackBar(content: Text(message)),
  );
}
