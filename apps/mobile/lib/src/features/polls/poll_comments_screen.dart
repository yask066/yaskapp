import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/pagination/cursor_list_controller.dart';
import '../../core/pagination/cursor_page.dart';
import '../../core/motion/entry_motion.dart';
import '../../core/scroll/list_scroll_anchor_host.dart';
import '../../core/scroll/list_scroll_state.dart';
import '../../core/widgets/content_skeleton.dart';
import '../../core/widgets/pagination_footer.dart';
import '../../core/widgets/user_avatar.dart';
import 'poll_card.dart';
import 'poll_summary.dart';
import 'polls_api_client.dart';
import 'poll_state_scope.dart';
import 'poll_state_store.dart';
import '../reports/report_dialog.dart';
import '../reports/reports_api_client.dart';

const _commentsNavy = Color(0xFF566A9D);
const _commentsPrimaryText = Color(0xFF10142D);
const _commentsSecondaryText = Color(0xFF667085);
const _commentsDivider = Color(0xFFEAECF0);

class PollCommentsScreen extends StatefulWidget {
  const PollCommentsScreen({
    required this.poll,
    required this.accessToken,
    required this.pollsApiClient,
    this.currentUserId,
    this.reportsApiClient,
    this.initialCommentId,
    super.key,
  });

  final PollSummary poll;
  final String accessToken;
  final PollsApiClient pollsApiClient;
  final String? currentUserId;
  final ReportsApiClient? reportsApiClient;
  final String? initialCommentId;

  @override
  State<PollCommentsScreen> createState() => _PollCommentsScreenState();
}

class _PollCommentsScreenState extends State<PollCommentsScreen> {
  final _commentController = TextEditingController();
  final _scrollController = ScrollController();
  final _targetCommentKey = GlobalKey();
  final _targetReplyKey = GlobalKey();
  late final CursorListController<PollCommentSummary> _commentsController;
  late PollSummary _poll;
  final Map<String, PollCommentSummary> _createdRootOverlays = {};
  final Map<String, PollCommentSummary> _targetRootOverlays = {};
  final Map<String, PollCommentSummary> _commentOverrides = {};
  final Set<String> _deletedRootIds = {};
  int _displayGeneration = -1;
  int? _targetLoadedGeneration;
  int _targetRequestGeneration = 0;
  bool _targetLookupComplete = false;
  bool _isSubmittingComment = false;
  bool _isDeletingComment = false;
  bool _isLikingPoll = false;
  bool _pollDeleted = false;
  PollStateStore? _pollStateStore;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final nextStore = PollStateScope.maybeOf(context);
    if (identical(nextStore, _pollStateStore)) return;
    _pollStateStore?.removeListener(_handlePollStateChanged);
    _pollStateStore = nextStore;
    _pollStateStore?.addListener(_handlePollStateChanged);
    _handlePollStateChanged();
  }

  void _handlePollStateChanged() {
    if (_pollStateStore?.isDeleted(_poll.id) == true) {
      if (mounted && !_pollDeleted) setState(() => _pollDeleted = true);
      return;
    }
    final current = _pollStateStore?.pollById(_poll.id);
    if (!mounted || current == null || identical(current, _poll)) return;
    setState(() => _poll = current);
  }

  bool _targetCommentFocusScheduled = false;
  String? _targetRootCommentId;
  String? _targetReplyId;
  String? _targetCommentLoadMessage;
  late final ReportsApiClient _reportsApiClient;
  late final bool _ownsReportsApiClient;

  @override
  void initState() {
    super.initState();
    _poll = widget.poll;
    _ownsReportsApiClient = widget.reportsApiClient == null;
    _reportsApiClient = widget.reportsApiClient ?? ReportsApiClient();
    _commentsController = CursorListController<PollCommentSummary>(
      contextKey: 'comments:${widget.currentUserId ?? 'anonymous'}:${_poll.id}',
      loader: _loadCommentPage,
      extractId: (comment) => comment.id,
    );
    _commentsController.addListener(_handleCommentsChanged);
    _scrollController.addListener(_handleRootScroll);
    unawaited(_commentsController.loadInitial());
  }

  @override
  void dispose() {
    _pollStateStore?.removeListener(_handlePollStateChanged);
    _commentsController.removeListener(_handleCommentsChanged);
    _commentsController.dispose();
    _commentController.dispose();
    _scrollController.dispose();
    if (_ownsReportsApiClient) _reportsApiClient.close();
    super.dispose();
  }

  Future<void> _reportComment(PollCommentSummary comment) {
    return showReportDialog(
      context: context,
      accessToken: widget.accessToken,
      targetType: 'comment',
      targetId: comment.id,
      reportsApiClient: _reportsApiClient,
    );
  }

  Future<CursorPage<PollCommentSummary>> _loadCommentPage({
    required int limit,
    String? cursor,
  }) {
    return widget.pollsApiClient.listCommentsPage(
      pollId: _poll.id,
      limit: limit,
      order: 'newest',
      cursor: cursor,
      accessToken: widget.accessToken,
    );
  }

  List<PollCommentSummary> get _comments {
    final pageItems = _commentsController.state.items;
    final pageIds = pageItems.map((comment) => comment.id).toSet();
    final candidates = <PollCommentSummary>[
      for (final comment in _createdRootOverlays.values)
        if (!pageIds.contains(comment.id)) comment,
      ..._targetRootOverlays.values,
      ...pageItems,
    ];
    final byId = <String, PollCommentSummary>{};
    for (final comment in candidates) {
      if (_deletedRootIds.contains(comment.id)) continue;
      byId.putIfAbsent(
        comment.id,
        () => _commentOverrides[comment.id] ?? comment,
      );
    }
    return byId.values.toList(growable: false);
  }

  void _handleCommentsChanged() {
    final state = _commentsController.state;
    if (state.pages.isNotEmpty &&
        !state.refresh.pending &&
        state.refresh.error == null) {
      if (state.generation != _displayGeneration) {
        _displayGeneration = state.generation;
        _commentOverrides.clear();
        _deletedRootIds.clear();
      }
      final pageIds = state.ids.toSet();
      _createdRootOverlays.removeWhere((id, _) => pageIds.contains(id));
    }

    if (mounted) setState(() {});

    if (state.pages.isNotEmpty &&
        !state.refresh.pending &&
        state.refresh.error == null &&
        widget.initialCommentId != null &&
        _targetLoadedGeneration != state.generation) {
      _targetLoadedGeneration = state.generation;
      unawaited(_loadTargetComment(state.generation, state.items));
    }
    if (state.pages.isNotEmpty && !state.initial.pending) {
      _scheduleViewportAppend();
    }
  }

  Future<void> _loadTargetComment(
    int generation,
    List<PollCommentSummary> roots,
  ) async {
    final requestGeneration = ++_targetRequestGeneration;
    final targetId = widget.initialCommentId;
    if (targetId == null) return;

    var target = _findComment(roots, targetId);
    var rootOverlay = target?.parentCommentId == null ? target : null;
    var rootCommentId =
        target?.parentCommentId == null ? target?.id : target?.parentCommentId;
    String? replyId;
    String? loadMessage;

    if (target == null) {
      try {
        target = await widget.pollsApiClient.getComment(
          pollId: _poll.id,
          commentId: targetId,
          accessToken: widget.accessToken,
        );
      } on PollsApiException catch (error) {
        loadMessage = error.statusCode == 404
            ? 'This comment is no longer available.'
            : 'Could not open this comment. Please try again.';
      } on Object {
        loadMessage = 'Could not open this comment. Please try again.';
      }
    }

    if (target != null && target.pollId == _poll.id) {
      if (target.parentCommentId == null) {
        rootOverlay = target;
        rootCommentId = target.id;
      } else {
        replyId = target.id;
        rootCommentId = target.parentCommentId;
        var root = _findComment(roots, target.parentCommentId!);
        if (root == null) {
          try {
            root = await widget.pollsApiClient.getComment(
              pollId: _poll.id,
              commentId: target.parentCommentId!,
              accessToken: widget.accessToken,
            );
          } on PollsApiException catch (error) {
            loadMessage = error.statusCode == 404
                ? 'This comment is no longer available.'
                : 'Could not open this comment. Please try again.';
          } on Object {
            loadMessage = 'Could not open this comment. Please try again.';
          }
        }
        if (root != null &&
            root.pollId == _poll.id &&
            root.parentCommentId == null) {
          rootOverlay = root;
        } else {
          replyId = null;
          loadMessage ??= 'This comment is no longer available.';
        }
      }
    } else if (target != null) {
      loadMessage = 'This comment is no longer available.';
    }

    if (!mounted ||
        _commentsController.state.generation != generation ||
        _targetRequestGeneration != requestGeneration) {
      return;
    }

    final resolvedRoot = rootOverlay;
    setState(() {
      _targetCommentLoadMessage = loadMessage;
      _targetRootCommentId = rootCommentId;
      _targetReplyId = replyId;
      _targetRootOverlays.clear();
      if (resolvedRoot != null) {
        _targetRootOverlays[resolvedRoot.id] = resolvedRoot;
      }
      _targetLookupComplete = true;
    });
    _scheduleTargetCommentFocus(_comments);
  }

  Future<void> _refreshComments() async {
    await _commentsController.refresh();
    if (_commentsController.state.refresh.error != null && mounted) {
      _showSnackBar('Could not refresh comments.');
    }
  }

  void _retryComments() {
    _targetRequestGeneration++;
    setState(() {
      _targetCommentFocusScheduled = false;
      _targetCommentLoadMessage = null;
      _targetLookupComplete = widget.initialCommentId == null;
    });
    unawaited(_commentsController.loadInitial());
  }

  void _handleRootScroll() {
    if (!_scrollController.hasClients) return;
    if (_scrollController.position.extentAfter <= 400) {
      unawaited(_commentsController.loadMore(automatic: true));
    }
  }

  void _scheduleViewportAppend() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _handleRootScroll();
    });
  }

  bool _handleRootScrollMetrics(ScrollMetricsNotification notification) {
    if (notification.metrics.extentAfter <= 400) _scheduleViewportAppend();
    return false;
  }

  void _scheduleTargetCommentFocus(List<PollCommentSummary> comments) {
    final targetId = widget.initialCommentId;
    if (targetId == null ||
        !_targetLookupComplete ||
        _targetCommentFocusScheduled) {
      return;
    }
    _targetCommentFocusScheduled = true;
    if (_targetCommentLoadMessage != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _showSnackBar(
            _targetCommentLoadMessage ?? 'This comment is no longer available.',
          );
        }
      });
      return;
    }
    if (_targetReplyId != null) return;
    final rootId = _targetRootCommentId ?? targetId;
    if (!comments.any((comment) => comment.id == rootId)) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _showSnackBar('This comment is no longer available.');
      });
      return;
    }

    WidgetsBinding.instance.addPostFrameCallback((_) {
      final targetContext = _targetCommentKey.currentContext;
      if (!mounted || targetContext == null) return;
      unawaited(Scrollable.ensureVisible(
        targetContext,
        alignment: 0.25,
        duration: MediaQuery.disableAnimationsOf(context)
            ? Duration.zero
            : const Duration(milliseconds: 280),
        curve: Curves.easeOut,
      ));
    });
  }

  PollCommentSummary? _findComment(
    List<PollCommentSummary> comments,
    String id,
  ) {
    for (final comment in comments) {
      if (comment.id == id) return comment;
    }
    return null;
  }

  void _onReplyCreated(
    String rootCommentId,
    PollSummary updatedPoll,
  ) {
    if (!mounted) return;
    final root = _findComment(_comments, rootCommentId);
    if (root != null) {
      _commentOverrides[rootCommentId] =
          root.copyWith(repliesCount: root.repliesCount + 1);
    }
    setState(() {
      _poll = updatedPoll;
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

      _createdRootOverlays[result.comment.id] = result.comment;
      _commentOverrides.remove(result.comment.id);
      _deletedRootIds.remove(result.comment.id);
      _commentController.clear();

      setState(() {
        _poll = result.poll;
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

  Future<PollCommentSummary?> _toggleCommentLike(
    PollCommentSummary comment,
  ) async {
    try {
      final updated = comment.viewerHasLiked
          ? await widget.pollsApiClient.unlikeComment(
              pollId: _poll.id,
              commentId: comment.id,
              accessToken: widget.accessToken,
            )
          : await widget.pollsApiClient.likeComment(
              pollId: _poll.id,
              commentId: comment.id,
              accessToken: widget.accessToken,
            );
      if (!mounted) {
        return updated;
      }

      _commentOverrides[updated.id] = updated;
      return updated;
    } on PollsApiException catch (error) {
      _showSnackBar(error.message);
      return null;
    } catch (_) {
      _showSnackBar('Could not update comment like.');
      return null;
    }
  }

  Future<void> _togglePollLike() async {
    if (_isLikingPoll) {
      return;
    }

    setState(() => _isLikingPoll = true);

    try {
      final updated = _poll.viewerHasLiked
          ? await widget.pollsApiClient.unlikePoll(
              pollId: _poll.id,
              accessToken: widget.accessToken,
            )
          : await widget.pollsApiClient.likePoll(
              pollId: _poll.id,
              accessToken: widget.accessToken,
            );

      if (!mounted) {
        return;
      }

      setState(() => _poll = updated);
    } on PollsApiException catch (error) {
      _showSnackBar(error.message);
    } catch (_) {
      _showSnackBar('Could not update like.');
    } finally {
      if (mounted) {
        setState(() => _isLikingPoll = false);
      }
    }
  }

  Future<void> _deleteComment(PollCommentSummary comment) async {
    if (_isDeletingComment) {
      return;
    }

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete comment?'),
        content: const Text('This comment will be removed permanently.'),
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

    if (confirmed != true || !mounted) {
      return;
    }

    setState(() => _isDeletingComment = true);

    try {
      await widget.pollsApiClient.deleteComment(
        pollId: _poll.id,
        commentId: comment.id,
        accessToken: widget.accessToken,
      );

      if (!mounted) {
        return;
      }

      _deletedRootIds.add(comment.id);
      _createdRootOverlays.remove(comment.id);
      _targetRootOverlays.remove(comment.id);
      _commentOverrides.remove(comment.id);
      final updatedPoll = _poll.copyWith(
        commentsCount: (_poll.commentsCount - comment.repliesCount - 1)
            .clamp(0, _poll.commentsCount),
      );

      setState(() {
        _poll = updatedPoll;
      });
      _showSnackBar('Comment deleted.');
    } on PollsApiException catch (error) {
      _showSnackBar(error.userMessage);
    } catch (_) {
      _showSnackBar('Could not delete comment.');
    } finally {
      if (mounted) {
        setState(() => _isDeletingComment = false);
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
  Widget build(BuildContext context) {
    if (_pollDeleted) {
      return const Scaffold(
        body: SafeArea(
          child: Center(child: Text('This poll is no longer available.')),
        ),
      );
    }
    final comments = _comments;
    final paginationState = _commentsController.state;
    _scheduleTargetCommentFocus(comments);

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
        resizeToAvoidBottomInset: false,
        body: AnimatedPadding(
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOut,
          padding: EdgeInsets.only(
            bottom: MediaQuery.viewInsetsOf(context).bottom,
          ),
          child: SafeArea(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  height: 64,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    child: Row(
                      children: [
                        IconButton(
                          tooltip: 'Back',
                          onPressed: _closeWithResult,
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints.tightFor(
                              width: 24, height: 24),
                          icon: const Icon(Icons.arrow_back_ios_new, size: 24),
                        ),
                        const SizedBox(width: 16),
                        const Text(
                          'Comments',
                          style: TextStyle(
                            color: _commentsPrimaryText,
                            fontSize: 23,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                Expanded(
                  child: ListScrollAnchorHost(
                    context: ListScrollContext(
                      userId: widget.currentUserId,
                      route: '/polls/${_poll.id}/comments',
                      list: 'comments',
                      query: '',
                      filter: '',
                      sort: 'newest',
                    ),
                    store: listScrollStateStore,
                    controller: _scrollController,
                    itemIds: comments
                        .map((comment) => 'comment-${comment.id}')
                        .toList(),
                    hasExplicitTarget: widget.initialCommentId != null ||
                        _targetRootCommentId != null,
                    child: EntryMotionRegistryScope(
                      contextKey:
                          'comments:${widget.currentUserId ?? 'anonymous'}:${_poll.id}',
                      child: RefreshIndicator(
                        onRefresh: _refreshComments,
                        child: NotificationListener<ScrollMetricsNotification>(
                          onNotification: _handleRootScrollMetrics,
                          child: CustomScrollView(
                            controller: _scrollController,
                            physics: const AlwaysScrollableScrollPhysics(),
                            slivers: [
                              SliverPadding(
                                padding:
                                    const EdgeInsets.fromLTRB(20, 8, 20, 0),
                                sliver: SliverToBoxAdapter(
                                  child: EntryMotion(
                                    contextKey:
                                        'comments:${widget.currentUserId ?? 'anonymous'}:${_poll.id}',
                                    itemId: 'poll:${_poll.id}',
                                    visible: true,
                                    indexInBatch: 0,
                                    child: PollCard(
                                      key: ValueKey('poll-${_poll.id}'),
                                      poll: _poll,
                                      accessToken: widget.accessToken,
                                      onToggleLike: _isLikingPoll
                                          ? null
                                          : _togglePollLike,
                                      isLiking: _isLikingPoll,
                                    ),
                                  ),
                                ),
                              ),
                              SliverPadding(
                                padding:
                                    const EdgeInsets.fromLTRB(20, 26, 20, 0),
                                sliver: SliverToBoxAdapter(
                                  child: Column(
                                    children: [
                                      Row(
                                        children: [
                                          Text(
                                            '${_poll.commentsCount} comments',
                                            style: const TextStyle(
                                              color: _commentsSecondaryText,
                                              fontSize: 15,
                                              fontWeight: FontWeight.w500,
                                            ),
                                          ),
                                          const Spacer(),
                                          const Text(
                                            'Newest',
                                            style: TextStyle(
                                              color: _commentsSecondaryText,
                                              fontSize: 15,
                                            ),
                                          ),
                                          const Icon(
                                            Icons.keyboard_arrow_down,
                                            color: _commentsSecondaryText,
                                            size: 18,
                                          ),
                                        ],
                                      ),
                                      const Divider(
                                        height: 32,
                                        color: _commentsDivider,
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                              if (paginationState.pages.isEmpty &&
                                  paginationState.initial.pending)
                                const SliverPadding(
                                  padding: EdgeInsets.symmetric(horizontal: 20),
                                  sliver: SliverToBoxAdapter(
                                    child: _CommentsLoadingState(),
                                  ),
                                )
                              else if (paginationState.pages.isEmpty &&
                                  paginationState.initial.error != null)
                                SliverPadding(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 20),
                                  sliver: SliverToBoxAdapter(
                                    child: _CommentsErrorState(
                                      onRetry: _retryComments,
                                    ),
                                  ),
                                )
                              else if (comments.isEmpty)
                                const SliverPadding(
                                  padding: EdgeInsets.symmetric(horizontal: 20),
                                  sliver: SliverToBoxAdapter(
                                    child: _CommentsEmptyState(),
                                  ),
                                )
                              else
                                SliverPadding(
                                  padding:
                                      const EdgeInsets.fromLTRB(20, 0, 20, 24),
                                  sliver: SliverList.builder(
                                    itemCount: comments.length,
                                    itemBuilder: (context, index) {
                                      final comment = comments[index];
                                      final isReplyTargetRoot =
                                          comment.id == _targetRootCommentId &&
                                              _targetReplyId != null;
                                      final isRootTarget =
                                          comment.id == _targetRootCommentId &&
                                              _targetReplyId == null;
                                      return KeyedSubtree(
                                        key: ValueKey(
                                            'comment-row-${comment.id}'),
                                        child: Column(
                                          children: [
                                            ListScrollAnchorItem(
                                              id: 'comment-${comment.id}',
                                              child: EntryMotion(
                                                key: ValueKey(
                                                    'entry-comment-${comment.id}'),
                                                contextKey:
                                                    'comments:${widget.currentUserId ?? 'anonymous'}:${_poll.id}',
                                                itemId: comment.id,
                                                visible: true,
                                                indexInBatch: index + 1,
                                                child: KeyedSubtree(
                                                  key: isRootTarget
                                                      ? ValueKey(
                                                          'notification-target-comment-${comment.id}')
                                                      : null,
                                                  child: _CommentTile(
                                                    key: isRootTarget
                                                        ? _targetCommentKey
                                                        : ValueKey(
                                                            'comment-tile-${comment.id}'),
                                                    comment: comment,
                                                    isNotificationTarget:
                                                        isRootTarget,
                                                    pollId: _poll.id,
                                                    currentUserId:
                                                        widget.currentUserId,
                                                    accessToken:
                                                        widget.accessToken,
                                                    pollsApiClient:
                                                        widget.pollsApiClient,
                                                    canReply:
                                                        widget.currentUserId !=
                                                            null,
                                                    focusedReplyId:
                                                        isReplyTargetRoot
                                                            ? _targetReplyId
                                                            : null,
                                                    targetReplyKey:
                                                        isReplyTargetRoot
                                                            ? _targetReplyKey
                                                            : null,
                                                    onReplyCreated:
                                                        (updatedPoll) =>
                                                            _onReplyCreated(
                                                                comment.id,
                                                                updatedPoll),
                                                    onDelete:
                                                        widget.currentUserId ==
                                                                comment
                                                                    .author.id
                                                            ? () =>
                                                                _deleteComment(
                                                                    comment)
                                                            : null,
                                                    onReport:
                                                        widget.currentUserId !=
                                                                    null &&
                                                                widget.currentUserId !=
                                                                    comment
                                                                        .author
                                                                        .id
                                                            ? () =>
                                                                _reportComment(
                                                                    comment)
                                                            : null,
                                                    onToggleLike:
                                                        _toggleCommentLike,
                                                  ),
                                                ),
                                              ),
                                            ),
                                            const Divider(
                                              height: 1,
                                              indent: 76,
                                              color: _commentsDivider,
                                            ),
                                          ],
                                        ),
                                      );
                                    },
                                  ),
                                ),
                              if (paginationState.pages.isNotEmpty &&
                                  paginationState.paginationSupported &&
                                  (comments.isNotEmpty ||
                                      paginationState.canLoadMore))
                                SliverPadding(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 20,
                                  ),
                                  sliver: SliverToBoxAdapter(
                                    child: PaginationFooter(
                                      hasMore: paginationState.canLoadMore,
                                      loading: paginationState.append.pending,
                                      error: paginationState.append.error,
                                      onLoadMore: () => unawaited(
                                        _commentsController.loadMore(),
                                      ),
                                      onRetry: () => unawaited(
                                        _commentsController.loadMore(),
                                      ),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                _CommentComposer(
                  controller: _commentController,
                  isSubmitting: _isSubmittingComment,
                  onSubmit: _submitComment,
                ),
              ],
            ),
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
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: _commentsDivider)),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              child: SizedBox(
                height: 48,
                child: TextField(
                  controller: controller,
                  enabled: !isSubmitting,
                  minLines: 1,
                  maxLines: 1,
                  maxLength: 1000,
                  textInputAction: TextInputAction.done,
                  decoration: InputDecoration(
                    hintText: 'Add a comment...',
                    counterText: '',
                    filled: true,
                    fillColor: Colors.white,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 20),
                    hintStyle: const TextStyle(
                      color: _commentsSecondaryText,
                      fontSize: 16,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(24),
                      borderSide: const BorderSide(color: _commentsDivider),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(24),
                      borderSide: const BorderSide(color: _commentsDivider),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(24),
                      borderSide: const BorderSide(color: _commentsNavy),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 10),
            IconButton(
              tooltip: 'Post comment',
              onPressed: isSubmitting ? null : onSubmit,
              style: IconButton.styleFrom(
                backgroundColor: _commentsNavy,
                foregroundColor: Colors.white,
                disabledBackgroundColor: const Color(0xFFBFC2D8),
                disabledForegroundColor: Colors.white,
                fixedSize: const Size(48, 48),
              ),
              icon: isSubmitting
                  ? const SizedBox.square(
                      dimension: 22,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.send_rounded, size: 24),
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
      padding: EdgeInsets.symmetric(vertical: 16),
      child: DelayedContentSkeleton(
        kind: ContentSkeletonKind.comment,
        rows: 2,
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

class _CommentThread extends StatefulWidget {
  const _CommentThread({
    super.key,
    required this.rootComment,
    required this.pollId,
    this.currentUserId,
    required this.accessToken,
    required this.pollsApiClient,
    required this.canReply,
    required this.onReplyCreated,
    this.focusedReplyId,
    this.targetReplyKey,
  });

  final PollCommentSummary rootComment;
  final String pollId;
  final String? currentUserId;
  final String accessToken;
  final PollsApiClient pollsApiClient;
  final bool canReply;
  final ValueChanged<PollSummary> onReplyCreated;
  final String? focusedReplyId;
  final GlobalKey? targetReplyKey;

  @override
  State<_CommentThread> createState() => _CommentThreadState();
}

class _CommentThreadState extends State<_CommentThread>
    with AutomaticKeepAliveClientMixin<_CommentThread> {
  final _replyController = TextEditingController();
  final _targetReplyFocusNode = FocusNode(debugLabel: 'notification reply');
  List<PollCommentSummary> _replies = [];
  String? _nextCursor;
  String? _failedCursor;
  String? _loadError;
  String? _submissionError;
  bool _isExpanded = false;
  bool _isComposing = false;
  bool _isLoading = false;
  bool _isLoadingMore = false;
  bool _isSubmitting = false;
  bool _hasLoaded = false;
  bool _targetFocusScheduled = false;
  bool _paginationSupported = true;

  @override
  bool get wantKeepAlive =>
      _isExpanded || _isLoading || _isLoadingMore || _isComposing;

  @override
  void initState() {
    super.initState();
    if (widget.focusedReplyId != null) {
      _isExpanded = true;
      updateKeepAlive();
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_loadReplies());
      });
    }
  }

  @override
  void didUpdateWidget(covariant _CommentThread oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.focusedReplyId != widget.focusedReplyId) {
      _targetFocusScheduled = false;
      if (widget.focusedReplyId != null) {
        _isExpanded = true;
        updateKeepAlive();
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && !_hasLoaded) unawaited(_loadReplies());
        });
      }
    }
  }

  @override
  void dispose() {
    _replyController.dispose();
    _targetReplyFocusNode.dispose();
    super.dispose();
  }

  void openComposer() {
    if (!widget.canReply || _isSubmitting) return;
    setState(() {
      _isComposing = true;
      _submissionError = null;
    });
    updateKeepAlive();
  }

  void _toggleExpanded() {
    final expand = !_isExpanded;
    setState(() => _isExpanded = expand);
    updateKeepAlive();
    if (expand && !_hasLoaded && !_isLoading) unawaited(_loadReplies());
  }

  Future<void> _loadReplies({String? cursor}) async {
    if (_isLoading || _isLoadingMore) return;
    final isFirstPage = cursor == null;
    setState(() {
      _loadError = null;
      _failedCursor = cursor;
      if (isFirstPage) {
        _isLoading = true;
      } else {
        _isLoadingMore = true;
      }
    });
    updateKeepAlive();

    try {
      final page = await widget.pollsApiClient.listCommentReplies(
        pollId: widget.pollId,
        rootCommentId: widget.rootComment.id,
        limit: 20,
        cursor: cursor,
        accessToken: widget.accessToken,
      );
      if (!mounted) return;
      final mergedReplies = _mergeReplies(_replies, page.items);
      setState(() {
        _replies = mergedReplies;
        _nextCursor = page.nextCursor;
        _paginationSupported = page.paginationSupported;
        _hasLoaded = true;
        _isLoading = false;
        _isLoadingMore = false;
        _loadError = null;
        _failedCursor = null;
      });
      updateKeepAlive();
      _scheduleTargetReplyFocus();

      final targetFound = widget.focusedReplyId == null ||
          mergedReplies.any((reply) => reply.id == widget.focusedReplyId);
      if (!targetFound && page.paginationSupported && page.nextCursor != null) {
        unawaited(_loadReplies(cursor: page.nextCursor));
      }
    } on PollsApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _isLoadingMore = false;
        _loadError = error.userMessage;
        _failedCursor = cursor;
      });
      updateKeepAlive();
    } on Object {
      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _isLoadingMore = false;
        _loadError = 'Could not load replies. Please try again.';
        _failedCursor = cursor;
      });
      updateKeepAlive();
    }
  }

  List<PollCommentSummary> _mergeReplies(
    List<PollCommentSummary> current,
    List<PollCommentSummary> incoming,
  ) {
    final merged = [...current];
    for (final reply in incoming) {
      if (!merged.any((item) => item.id == reply.id)) merged.add(reply);
    }
    return merged;
  }

  void _scheduleTargetReplyFocus() {
    final targetId = widget.focusedReplyId;
    if (targetId == null ||
        _targetFocusScheduled ||
        !_replies.any((reply) => reply.id == targetId)) {
      return;
    }
    _targetFocusScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final targetContext = widget.targetReplyKey?.currentContext;
      if (!mounted || targetContext == null) return;
      _targetReplyFocusNode.requestFocus();
      unawaited(Scrollable.ensureVisible(
        targetContext,
        alignment: 0.25,
        duration: MediaQuery.disableAnimationsOf(context)
            ? Duration.zero
            : const Duration(milliseconds: 280),
        curve: Curves.easeOut,
      ));
    });
  }

  Future<void> _submitReply() async {
    final body = _replyController.text.trim();
    if (body.isEmpty || _isSubmitting) return;
    setState(() {
      _isSubmitting = true;
      _submissionError = null;
    });

    try {
      final result = await widget.pollsApiClient.createComment(
        pollId: widget.pollId,
        body: body,
        accessToken: widget.accessToken,
        parentCommentId: widget.rootComment.id,
      );
      if (!mounted) return;
      widget.onReplyCreated(result.poll);
      _replyController.clear();
      setState(() {
        _replies = _mergeReplies(_replies, [result.comment]);
        _isExpanded = true;
        _isComposing = false;
      });
      updateKeepAlive();
      if (!_hasLoaded) unawaited(_loadReplies());
    } on PollsApiException catch (error) {
      if (!mounted) return;
      setState(() => _submissionError = error.userMessage);
    } on Object {
      if (!mounted) return;
      setState(() => _submissionError = 'Could not post reply.');
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
        updateKeepAlive();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final authorLabel = widget.rootComment.author.displayName.isNotEmpty
        ? widget.rootComment.author.displayName
        : widget.rootComment.author.username;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (widget.rootComment.repliesCount > 0 || _isExpanded)
          TextButton(
            key: ValueKey('toggle-replies-${widget.rootComment.id}'),
            onPressed: _toggleExpanded,
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              visualDensity: VisualDensity.compact,
            ),
            child: Text(
              '${_isExpanded ? 'Hide' : 'Show'} replies (${widget.rootComment.repliesCount})',
            ),
          ),
        if (_isComposing && widget.canReply)
          _ReplyComposer(
            controller: _replyController,
            isSubmitting: _isSubmitting,
            error: _submissionError,
            rootCommentId: widget.rootComment.id,
            authorLabel: authorLabel,
            onCancel: () {
              if (_isSubmitting) return;
              _replyController.clear();
              setState(() {
                _isComposing = false;
                _submissionError = null;
              });
              updateKeepAlive();
            },
            onSubmit: _submitReply,
          ),
        if (_isExpanded) ...[
          if (_isLoading && _replies.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: DelayedContentSkeleton(
                kind: ContentSkeletonKind.comment,
                rows: 1,
              ),
            ),
          if (_loadError != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_loadError!,
                      style: TextStyle(
                          color: Theme.of(context).colorScheme.error)),
                  TextButton(
                    onPressed: _isLoading || _isLoadingMore
                        ? null
                        : () => unawaited(_loadReplies(cursor: _failedCursor)),
                    child: const Text('Retry replies'),
                  ),
                ],
              ),
            ),
          if (_hasLoaded && _replies.isEmpty && _loadError == null)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: Text('No replies yet.'),
            ),
          for (final reply in _replies) _buildReply(reply),
          if (_paginationSupported && _nextCursor != null && _loadError == null)
            TextButton(
              onPressed: _isLoadingMore
                  ? null
                  : () => unawaited(_loadReplies(cursor: _nextCursor)),
              child: Text(
                  _isLoadingMore ? 'Loading replies…' : 'Load more replies'),
            ),
        ],
      ],
    );
  }

  Widget _buildReply(PollCommentSummary reply) {
    final isTarget = reply.id == widget.focusedReplyId;
    final card = Focus(
      key: isTarget ? widget.targetReplyKey : null,
      focusNode: isTarget ? _targetReplyFocusNode : null,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
        decoration: BoxDecoration(
          color: isTarget ? const Color(0xFFE6EEFF) : Colors.transparent,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              reply.author.displayName.isNotEmpty
                  ? reply.author.displayName
                  : reply.author.username,
              style: const TextStyle(
                color: _commentsPrimaryText,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 4),
            Text(reply.body, style: const TextStyle(height: 1.3)),
          ],
        ),
      ),
    );
    return EntryMotion(
      key: ValueKey('entry-reply-${reply.id}'),
      contextKey:
          'comments:${widget.currentUserId ?? 'anonymous'}:${widget.pollId}',
      itemId: reply.id,
      visible: true,
      indexInBatch: _replies.indexOf(reply),
      child: isTarget
          ? KeyedSubtree(
              key: ValueKey('notification-target-comment-${reply.id}'),
              child: card,
            )
          : card,
    );
  }
}

class _ReplyComposer extends StatelessWidget {
  const _ReplyComposer({
    required this.controller,
    required this.isSubmitting,
    required this.error,
    required this.rootCommentId,
    required this.authorLabel,
    required this.onCancel,
    required this.onSubmit,
  });

  final TextEditingController controller;
  final bool isSubmitting;
  final String? error;
  final String rootCommentId;
  final String authorLabel;
  final VoidCallback onCancel;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFF8F9FC),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _commentsDivider),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Replying to $authorLabel'),
          const SizedBox(height: 8),
          TextField(
            key: ValueKey('reply-composer-$rootCommentId'),
            controller: controller,
            enabled: !isSubmitting,
            minLines: 1,
            maxLines: 4,
            maxLength: 1000,
            decoration: const InputDecoration(
              hintText: 'Write a reply...',
              border: OutlineInputBorder(),
              counterText: '',
            ),
          ),
          if (error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ),
          Wrap(
            spacing: 8,
            children: [
              TextButton(
                onPressed: isSubmitting ? null : onCancel,
                child: const Text('Cancel reply'),
              ),
              Tooltip(
                message: 'Post reply',
                child: FilledButton(
                  onPressed: isSubmitting ? null : onSubmit,
                  child: const Text('Post reply'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _CommentTile extends StatefulWidget {
  const _CommentTile({
    super.key,
    required this.comment,
    required this.pollId,
    this.currentUserId,
    required this.accessToken,
    required this.pollsApiClient,
    required this.canReply,
    required this.onReplyCreated,
    this.focusedReplyId,
    this.targetReplyKey,
    this.isNotificationTarget = false,
    this.onDelete,
    this.onReport,
    this.onToggleLike,
  });

  final PollCommentSummary comment;
  final String pollId;
  final String? currentUserId;
  final String accessToken;
  final PollsApiClient pollsApiClient;
  final bool canReply;
  final ValueChanged<PollSummary> onReplyCreated;
  final String? focusedReplyId;
  final GlobalKey? targetReplyKey;
  final bool isNotificationTarget;
  final VoidCallback? onDelete;
  final VoidCallback? onReport;
  final Future<PollCommentSummary?> Function(PollCommentSummary comment)?
      onToggleLike;

  @override
  State<_CommentTile> createState() => _CommentTileState();
}

class _CommentTileState extends State<_CommentTile> {
  final _replyThreadKey = GlobalKey<_CommentThreadState>();
  late PollCommentSummary _comment;
  bool _isLiking = false;

  @override
  void initState() {
    super.initState();
    _comment = widget.comment;
  }

  @override
  void didUpdateWidget(covariant _CommentTile oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!_isLiking && oldWidget.comment != widget.comment) {
      _comment = widget.comment;
    }
  }

  Future<void> _toggleLike() async {
    if (_isLiking || widget.onToggleLike == null) {
      return;
    }

    setState(() => _isLiking = true);

    try {
      final updated = await widget.onToggleLike!(_comment);
      if (!mounted) {
        return;
      }

      if (updated != null) {
        setState(() => _comment = updated);
      }
    } finally {
      if (mounted) {
        setState(() => _isLiking = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final comment = _comment;

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 16),
      decoration: BoxDecoration(
        color: widget.isNotificationTarget
            ? const Color(0xFFE6EEFF)
            : Colors.transparent,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              UserAvatar(
                displayName: comment.author.displayName,
                username: comment.author.username,
                imageUrl: comment.author.avatarUrl,
                radius: 22,
              ),
              const SizedBox(width: 12),
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
                              color: _commentsPrimaryText,
                              fontSize: 16,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          comment.createdLabel,
                          style: const TextStyle(
                            color: _commentsSecondaryText,
                            fontSize: 13,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      comment.body,
                      style: const TextStyle(
                        color: _commentsPrimaryText,
                        fontSize: 16,
                        height: 21 / 16,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        IconButton(
                          key: ValueKey('like-comment-${comment.id}'),
                          tooltip: comment.viewerHasLiked
                              ? 'Unlike comment'
                              : 'Like comment',
                          onPressed: _isLiking ? null : _toggleLike,
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints.tightFor(
                              width: 18, height: 24),
                          style: IconButton.styleFrom(
                            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          ),
                          alignment: Alignment.centerLeft,
                          icon: Icon(
                            comment.viewerHasLiked
                                ? Icons.favorite
                                : Icons.favorite_border,
                            size: 18,
                            color: comment.viewerHasLiked
                                ? Colors.redAccent
                                : _commentsSecondaryText,
                          ),
                        ),
                        const SizedBox(width: 1),
                        Text(
                          '${comment.likesCount}',
                          style: const TextStyle(
                              color: _commentsSecondaryText, fontSize: 14),
                        ),
                        const SizedBox(width: 12),
                        Tooltip(
                          message: widget.canReply
                              ? 'Reply to ${comment.author.displayName}'
                              : 'Sign in to reply',
                          child: TextButton(
                            key: ValueKey('reply-comment-${comment.id}'),
                            onPressed: widget.canReply
                                ? () =>
                                    _replyThreadKey.currentState?.openComposer()
                                : null,
                            style: TextButton.styleFrom(
                              padding: EdgeInsets.zero,
                              minimumSize: Size.zero,
                              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                              visualDensity: VisualDensity.compact,
                            ),
                            child: const Text(
                              'Reply',
                              style: TextStyle(
                                color: _commentsSecondaryText,
                                fontSize: 14,
                              ),
                            ),
                          ),
                        ),
                        const Spacer(),
                        if (widget.onDelete != null || widget.onReport != null)
                          SizedBox(
                            width: 40,
                            height: 40,
                            child: PopupMenuButton<_CommentAction>(
                              tooltip: 'More',
                              padding: EdgeInsets.zero,
                              constraints: const BoxConstraints(minWidth: 220),
                              menuPadding:
                                  const EdgeInsets.symmetric(vertical: 8),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(16),
                              ),
                              elevation: 6,
                              icon: const Icon(Icons.more_vert, size: 22),
                              onSelected: (action) {
                                if (action == _CommentAction.deleteComment) {
                                  widget.onDelete?.call();
                                } else if (action == _CommentAction.report) {
                                  widget.onReport?.call();
                                }
                              },
                              itemBuilder: (context) => [
                                if (widget.onDelete != null)
                                  const PopupMenuItem<_CommentAction>(
                                    value: _CommentAction.deleteComment,
                                    height: 52,
                                    child: _CommentMenuRow(
                                      icon: Icons.delete_outline,
                                      label: 'Delete comment',
                                      destructive: true,
                                    ),
                                  ),
                                if (widget.onReport != null)
                                  const PopupMenuItem<_CommentAction>(
                                    value: _CommentAction.report,
                                    height: 52,
                                    child: _CommentMenuRow(
                                      icon: Icons.flag_outlined,
                                      label: 'Report',
                                    ),
                                  ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(left: 34),
            child: _CommentThread(
              key: _replyThreadKey,
              rootComment: comment,
              pollId: widget.pollId,
              currentUserId: widget.currentUserId,
              accessToken: widget.accessToken,
              pollsApiClient: widget.pollsApiClient,
              canReply: widget.canReply,
              focusedReplyId: widget.focusedReplyId,
              targetReplyKey: widget.targetReplyKey,
              onReplyCreated: widget.onReplyCreated,
            ),
          ),
        ],
      ),
    );
  }
}

enum _CommentAction { deleteComment, report }

class _CommentMenuRow extends StatelessWidget {
  const _CommentMenuRow({
    required this.icon,
    required this.label,
    this.destructive = false,
  });

  final IconData icon;
  final String label;
  final bool destructive;

  @override
  Widget build(BuildContext context) {
    final color = destructive
        ? Theme.of(context).colorScheme.error
        : const Color(0xFF17233D);
    return Row(
      children: [
        Icon(icon, size: 24, color: color),
        const SizedBox(width: 16),
        Text(
          label,
          style: TextStyle(
            color: color,
            fontSize: 16,
            fontWeight: destructive ? FontWeight.w600 : FontWeight.w500,
          ),
        ),
      ],
    );
  }
}
