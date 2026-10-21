/// A server page plus local capability metadata for transitional APIs.
///
/// A null [nextCursor] means the server reached the end only when
/// [paginationSupported] is true. Legacy responses that omit `nextCursor`
/// decode with this flag set to false.
class CursorPage<T> {
  const CursorPage({
    required this.items,
    required this.nextCursor,
    this.paginationSupported = true,
  });

  final List<T> items;
  final String? nextCursor;
  final bool paginationSupported;
}
