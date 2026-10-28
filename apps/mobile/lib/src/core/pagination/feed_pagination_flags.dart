class FeedPaginationFlags {
  static const bool enabled = bool.fromEnvironment(
    'YASKAPP_FEED_PAGINATION',
    defaultValue: false,
  );
}
