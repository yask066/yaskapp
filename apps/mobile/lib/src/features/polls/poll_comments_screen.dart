import 'package:flutter/material.dart';

import '../../core/widgets/user_avatar.dart';
import 'poll_card.dart';
import 'poll_summary.dart';
import 'polls_api_client.dart';

class PollCommentsScreen extends StatefulWidget {
  const PollCommentsScreen({
    required this.poll,
    required this.accessToken,
    required this.pollsApiClient,
    super.key,
  });

  final PollSummary poll;
  final String accessToken;
  final PollsApiClient pollsApiClient;

  @override
  State<PollCommentsScreen> createState() => _PollCommentsScreenState();
}

class _PollCommentsScreenState extends State<PollCommentsScreen> {
  final _commentController = TextEditingController();
  late Future<List<PollCommentSummary>> _commentsFuture;
  late PollSummary _poll;
  List<PollCommentSummary>? _comments;
  bool _isSubmittingComment = false;

  @override
  void initState() {
    super.initState();
    _poll = widget.poll;
    _commentsFuture = _loadComments();
  }

  Future<List<PollCommentSummary>> _loadComments() {
    return widget.pollsApiClient.listComments(pollId: _poll.id).then((
      comments,
    ) {
      _comments = comments;

      return comments;
    });
  }

  void _retryComments() {
    setState(() {
      _comments = null;
      _commentsFuture = _loadComments();
    });
  }

  Future<void> _submitComment() async {
    final body = _commentController.text.trim();

    if (_isSubmittingComment || body.isEmpty) {
      return;
    }

    setState(() {
      _isSubmittingComment = true;
    });

    try {
      final result = await widget.pollsApiClient.createComment(
        pollId: _poll.id,
        body: body,
        accessToken: widget.accessToken,
      );

      if (!mounted) {
        return;
      }

      final updatedComments = [
        ...?_comments,
        result.comment,
      ];

      _commentController.clear();

      setState(() {
        _poll = result.poll;
        _comments = updatedComments;
        _commentsFuture = Future.value(updatedComments);
      });
    } on PollsApiException catch (error) {
      _showSnackBar(error.message);
    } catch (_) {
      _showSnackBar('Could not post comment.');
    } finally {
      if (mounted) {
        setState(() {
          _isSubmittingComment = false;
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

  void _closeWithResult() {
    Navigator.of(context).pop(_poll);
  }

  @override
  void dispose() {
    _commentController.dispose();

    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) {
          return;
        }

        _closeWithResult();
      },
      child: Scaffold(
        backgroundColor: Colors.white,
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 10, 24, 8),
                child: Row(
                  children: [
                    IconButton(
                      tooltip: 'Back',
                      onPressed: _closeWithResult,
                      icon: const Icon(Icons.arrow_back_ios_new),
                    ),
                    const SizedBox(width: 2),
                    Text(
                      'Comments',
                      style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                        color: const Color(0xFF05008A),
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: FutureBuilder<List<PollCommentSummary>>(
                  future: _commentsFuture,
                  builder: (context, snapshot) {
                    if (snapshot.connectionState == ConnectionState.waiting) {
                      return ListView(
                        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                        children: [
                          PollCard(poll: _poll),
                          const _CommentsLoadingState(),
                        ],
                      );
                    }

                    if (snapshot.hasError) {
                      return ListView(
                        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                        children: [
                          PollCard(poll: _poll),
                          _CommentsErrorState(onRetry: _retryComments),
                        ],
                      );
                    }

                    final comments = _comments ?? snapshot.data ?? [];

                    return ListView(
                      padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                      children: [
                        PollCard(poll: _poll),
                        const SizedBox(height: 26),
                        Row(
                          children: [
                            Text(
                              '${comments.length} comments',
                              style: const TextStyle(
                                color: Color(0xFF667085),
                                fontSize: 18,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                            const Spacer(),
                            const Text(
                              'Newest',
                              style: TextStyle(
                                color: Color(0xFF667085),
                                fontSize: 17,
                              ),
                            ),
                            const Icon(
                              Icons.keyboard_arrow_down,
                              color: Color(0xFF667085),
                            ),
                          ],
                        ),
                        const Divider(
                          height: 32,
                          color: Color(0xFFE4E7EC),
                        ),
                        if (comments.isEmpty)
                          const _CommentsEmptyState()
                        else
                          for (final comment in comments) ...[
                            _CommentTile(comment: comment),
                            const Divider(
                              height: 1,
                              color: Color(0xFFE4E7EC),
                            ),
                          ],
                      ],
                    );
                  },
                ),
              ),
            ],
          ),
        ),
        bottomNavigationBar: SafeArea(
          top: false,
          child: _CommentComposer(
            controller: _commentController,
            isSubmitting: _isSubmittingComment,
            onSubmit: _submitComment,
          ),
        ),
      ),
    );
  }
}

class _CommentComposer extends StatelessWidget {
  const _CommentComposer({
    required this.controller,
    required this.isSubmitting,
    required this.onSubmit,
  });

  final TextEditingController controller;
  final bool isSubmitting;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: colors.outlineVariant)),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 14, 24, 16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              child: TextField(
                controller: controller,
                enabled: !isSubmitting,
                minLines: 1,
                maxLines: 4,
                maxLength: 1000,
                textInputAction: TextInputAction.newline,
                decoration: InputDecoration(
                  hintText: 'Add a comment...',
                  counterText: '',
                  filled: true,
                  fillColor: Colors.white,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 22,
                    vertical: 16,
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(30),
                    borderSide: const BorderSide(
                      color: Color(0xFFD0D5DD),
                      width: 2,
                    ),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(30),
                    borderSide: const BorderSide(
                      color: Color(0xFFD0D5DD),
                      width: 2,
                    ),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(30),
                    borderSide: const BorderSide(
                      color: Color(0xFF05008A),
                      width: 2,
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 12),
            IconButton(
              tooltip: 'Post comment',
              onPressed: isSubmitting ? null : onSubmit,
              style: IconButton.styleFrom(
                backgroundColor: const Color(0xFF05008A),
                foregroundColor: Colors.white,
                disabledBackgroundColor: const Color(0xFFBFC2D8),
                disabledForegroundColor: Colors.white,
                fixedSize: const Size(62, 62),
              ),
              icon: isSubmitting
                  ? const SizedBox.square(
                      dimension: 22,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.send_rounded, size: 28),
            ),
          ],
        ),
      ),
    );
  }
}

class _CommentsLoadingState extends StatelessWidget {
  const _CommentsLoadingState();

  @override
  Widget build(BuildContext context) {
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
}

class _CommentsEmptyState extends StatelessWidget {
  const _CommentsEmptyState();

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 48),
      child: Column(
        children: [
          Icon(Icons.mode_comment_outlined, color: colors.onSurfaceVariant),
          const SizedBox(height: 8),
          Text(
            'No comments yet',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 6),
          Text(
            'Be the first to join the discussion.',
            textAlign: TextAlign.center,
            style: TextStyle(color: colors.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

class _CommentsErrorState extends StatelessWidget {
  const _CommentsErrorState({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 48, horizontal: 24),
      child: Column(
        children: [
          Icon(Icons.cloud_off_outlined, color: colors.onSurfaceVariant),
          const SizedBox(height: 8),
          Text(
            'Could not load comments',
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

class _CommentTile extends StatelessWidget {
  const _CommentTile({required this.comment});

  final PollCommentSummary comment;

  @override
  Widget build(BuildContext context) {
    const navy = Color(0xFF05008A);

    return Padding(
      padding: const EdgeInsets.fromLTRB(0, 18, 0, 18),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          UserAvatar(
            displayName: comment.author.displayName,
            username: comment.author.username,
            imageUrl: comment.author.avatarObjectKey,
            radius: 24,
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        comment.author.displayName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: navy,
                          fontSize: 21,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      comment.createdLabel,
                      style: const TextStyle(
                        color: Color(0xFF6D7888),
                        fontSize: 16,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  comment.body,
                  style: const TextStyle(
                    color: navy,
                    fontSize: 18,
                    height: 1.2,
                  ),
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Icon(
                      Icons.favorite_border,
                      size: 22,
                      color: Colors.blueGrey.shade600,
                    ),
                    const SizedBox(width: 10),
                    Text(
                      'Like',
                      style: TextStyle(
                        color: Colors.blueGrey.shade700,
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(width: 24),
                    Text(
                      'Reply',
                      style: TextStyle(
                        color: Colors.blueGrey.shade700,
                        fontSize: 16,
                      ),
                    ),
                    const Spacer(),
                    const Icon(
                      Icons.more_horiz,
                      color: Color(0xFF101828),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
