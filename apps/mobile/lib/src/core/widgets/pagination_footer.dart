import 'package:flutter/material.dart';

/// Footer controls and status for a cursor-paginated list.
class PaginationFooter extends StatelessWidget {
  const PaginationFooter({
    super.key,
    required this.hasMore,
    this.loading = false,
    this.error,
    this.paginationSupported = true,
    this.endMessage = "You're all caught up.",
    this.onLoadMore,
    this.onRetry,
  });

  final bool hasMore;
  final bool loading;
  final Object? error;
  final bool paginationSupported;
  final String endMessage;
  final VoidCallback? onLoadMore;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    if (!paginationSupported) return const SizedBox.shrink();

    if (loading) {
      return Padding(
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
      );
    }

    if (error != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Could not load more.'),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: onRetry,
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    if (hasMore) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Center(
          child: OutlinedButton(
            onPressed: onLoadMore,
            child: const Text('Load more'),
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 20),
      child: Center(
        child: Text(
          endMessage,
          textAlign: TextAlign.center,
          style:
              TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
      ),
    );
  }
}
