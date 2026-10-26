import 'package:flutter/material.dart';

/// Footer controls and status for a cursor-paginated list.
class PaginationFooter extends StatefulWidget {
  const PaginationFooter({
    super.key,
    required this.hasMore,
    this.loading = false,
    this.error,
    this.errorMessage,
    this.requiresRefresh = false,
    this.paginationSupported = true,
    this.endMessage = "You're all caught up.",
    this.onLoadMore,
    this.onRetry,
    this.onRefresh,
  });

  final bool hasMore;
  final bool loading;
  final Object? error;
  final String? errorMessage;
  final bool requiresRefresh;
  final bool paginationSupported;
  final String endMessage;
  final VoidCallback? onLoadMore;
  final VoidCallback? onRetry;
  final VoidCallback? onRefresh;

  @override
  State<PaginationFooter> createState() => _PaginationFooterState();
}

class _PaginationFooterState extends State<PaginationFooter> {
  final FocusNode _actionFocusNode =
      FocusNode(debugLabel: 'pagination footer action');
  bool _restoreActionFocusAfterBuild = false;

  bool get _hasFocusablePresentation =>
      widget.paginationSupported &&
      (widget.loading || widget.error != null || widget.hasMore);

  @override
  void didUpdateWidget(covariant PaginationFooter oldWidget) {
    super.didUpdateWidget(oldWidget);
    final presentationChanged = oldWidget.loading != widget.loading ||
        oldWidget.error != widget.error ||
        oldWidget.requiresRefresh != widget.requiresRefresh ||
        oldWidget.hasMore != widget.hasMore ||
        oldWidget.paginationSupported != widget.paginationSupported;
    if (presentationChanged &&
        _hasFocusablePresentation &&
        _actionFocusNode.hasFocus) {
      _restoreActionFocusAfterBuild = true;
    }
  }

  @override
  void dispose() {
    _actionFocusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.paginationSupported) return const SizedBox.shrink();

    if (_restoreActionFocusAfterBuild) {
      _restoreActionFocusAfterBuild = false;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted &&
            _hasFocusablePresentation &&
            _actionFocusNode.canRequestFocus) {
          _actionFocusNode.requestFocus();
        }
      });
    }

    if (widget.loading) {
      return Focus(
        focusNode: _actionFocusNode,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 20),
          child: Center(
            child: Semantics(
              label: 'Loading more',
              child: const SizedBox.square(
                dimension: 22,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          ),
        ),
      );
    }

    if (widget.error != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(widget.errorMessage ?? 'Could not load more.'),
            const SizedBox(height: 8),
            OutlinedButton(
              focusNode: _actionFocusNode,
              onPressed:
                  widget.requiresRefresh ? widget.onRefresh : widget.onRetry,
              child: Text(widget.requiresRefresh ? 'Refresh feed' : 'Retry'),
            ),
          ],
        ),
      );
    }

    if (widget.hasMore) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Center(
          child: OutlinedButton(
            focusNode: _actionFocusNode,
            onPressed: widget.onLoadMore,
            child: const Text('Load more'),
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 20),
      child: Center(
        child: Text(
          widget.endMessage,
          textAlign: TextAlign.center,
          style:
              TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
      ),
    );
  }
}
