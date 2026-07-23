import 'package:flutter/material.dart';

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
        appBar: AppBar(
          leading: BackButton(onPressed: _closeWithResult),
          title: const Text('Comments'),
        ),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              PollCard(poll: _poll),
              const SizedBox(height: 20),
              Text(
                'Comments',
                style: Theme.of(
                  context,
                ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 12),
              FutureBuilder<List<PollCommentSummary>>(
                future: _commentsFuture,
                builder: (context, snapshot) {
                  if (snapshot.connectionState == ConnectionState.waiting) {
                    return const _CommentsLoadingState();
                  }

                  if (snapshot.hasError) {
                    return _CommentsErrorState(onRetry: _retryComments);
                  }

                  final comments = _comments ?? snapshot.data ?? [];

                  if (comments.isEmpty) {
                    return const _CommentsEmptyState();
                  }

                  return Column(
                    children: [
                      for (final comment in comments) ...[
                        _CommentTile(comment: comment),
                        const SizedBox(height: 12),
                      ],
                    ],
                  );
                },
              ),
            ],
          ),
        ),
        bottomNavigationBar: SafeArea(
          minimum: EdgeInsets.only(
            left: 16,
            right: 16,
            bottom: 12 + MediaQuery.viewInsetsOf(context).bottom,
          ),
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
        color: colors.surface,
        border: Border(top: BorderSide(color: colors.outlineVariant)),
      ),
      child: Padding(
        padding: const EdgeInsets.only(top: 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: TextField(
                controller: controller,
                enabled: !isSubmitting,
                minLines: 1,
                maxLines: 4,
                maxLength: 1000,
                textInputAction: TextInputAction.newline,
                decoration: const InputDecoration(
                  hintText: 'Add a comment',
                  counterText: '',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
              ),
            ),
            const SizedBox(width: 8),
            IconButton.filled(
              tooltip: 'Post comment',
              onPressed: isSubmitting ? null : onSubmit,
              icon: isSubmitting
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.send),
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
      padding: const EdgeInsets.symmetric(vertical: 24),
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
      padding: const EdgeInsets.symmetric(vertical: 24),
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
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        CircleAvatar(
          radius: 18,
          backgroundColor: colors.secondaryContainer,
          child: Text(
            comment.author.displayName.substring(0, 1).toUpperCase(),
            style: TextStyle(color: colors.onSecondaryContainer),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      comment.author.displayName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: textTheme.labelLarge,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    comment.createdLabel,
                    style: textTheme.bodySmall?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(comment.body, style: textTheme.bodyMedium),
            ],
          ),
        ),
      ],
    );
  }
}
