import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/analytics/search_analytics.dart';
import '../../core/widgets/user_avatar.dart';
import '../auth/auth_session.dart';
import '../polls/poll_card.dart';
import '../polls/poll_comments_screen.dart';
import '../polls/polls_api_client.dart';
import '../polls/poll_summary.dart';
import '../profile/profiles_api_client.dart';
import '../profile/public_profile.dart';
import '../profile/public_profile_screen.dart';
import 'search_api_client.dart';
import 'search_result.dart';

class SearchScreen extends StatefulWidget {
  const SearchScreen({
    required this.session,
    this.searchApiClient,
    this.pollsApiClient,
    this.profilesApiClient,
    this.analytics,
    super.key,
  });

  final AuthSession session;
  final SearchApiClient? searchApiClient;
  final PollsApiClient? pollsApiClient;
  final ProfilesApiClient? profilesApiClient;
  final SearchAnalytics? analytics;

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final _queryController = TextEditingController();
  final _queryFocusNode = FocusNode();
  final _scrollController = ScrollController();
  late final SearchApiClient _searchApiClient;
  late final PollsApiClient _pollsApiClient;
  late final ProfilesApiClient _profilesApiClient;
  late final bool _ownsSearchApiClient;
  late final bool _ownsPollsApiClient;
  late final bool _ownsProfilesApiClient;
  late final SearchAnalytics _analytics;

  Timer? _debounce;
  List<SearchResult> _items = [];
  String? _nextCursor;
  Object? _error;
  var _hasSearched = false;
  var _isLoading = false;
  var _isLoadingMore = false;
  var _requestId = 0;
  var _type = SearchType.all;
  var _sort = SearchSort.relevance;

  @override
  void initState() {
    super.initState();
    _ownsSearchApiClient = widget.searchApiClient == null;
    _ownsPollsApiClient = widget.pollsApiClient == null;
    _ownsProfilesApiClient = widget.profilesApiClient == null;
    _searchApiClient = widget.searchApiClient ?? SearchApiClient();
    _pollsApiClient = widget.pollsApiClient ?? PollsApiClient();
    _profilesApiClient = widget.profilesApiClient ?? ProfilesApiClient();
    _analytics = widget.analytics ?? const NoopSearchAnalytics();
    _analytics.searchOpened();
    _queryController.addListener(_handleQueryChanged);
    _scrollController.addListener(_handleScroll);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _queryFocusNode.requestFocus();
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _queryController
      ..removeListener(_handleQueryChanged)
      ..dispose();
    _queryFocusNode.dispose();
    _scrollController
      ..removeListener(_handleScroll)
      ..dispose();
    if (_ownsSearchApiClient) _searchApiClient.close();
    if (_ownsPollsApiClient) _pollsApiClient.close();
    if (_ownsProfilesApiClient) _profilesApiClient.close();
    super.dispose();
  }

  void _handleQueryChanged() {
    _debounce?.cancel();
    final query = _queryController.text.trim();

    if (query.length < 2) {
      if (mounted) {
        setState(() {
          _items = [];
          _nextCursor = null;
          _error = null;
          _hasSearched = false;
        });
      }
      return;
    }

    _debounce = Timer(const Duration(milliseconds: 400), _runSearch);
  }

  void _handleScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 240) {
      _loadMore();
    }
  }

  Future<void> _runSearch() async {
    await _loadSearch(reset: true);
  }

  Future<void> _loadMore() async {
    if (_nextCursor == null || _isLoading || _isLoadingMore || !_hasSearched) {
      return;
    }
    await _loadSearch(reset: false);
  }

  Future<void> _loadSearch({required bool reset}) async {
    final query = _queryController.text.trim();
    if (query.length < 2) return;

    final requestId = ++_requestId;
    if (mounted) {
      setState(() {
        _error = null;
        if (reset) {
          _isLoading = true;
          _items = [];
          _nextCursor = null;
        } else {
          _isLoadingMore = true;
        }
      });
    }

    try {
      final page = await _searchApiClient
          .search(
            accessToken: widget.session.accessToken,
            query: query,
            type: _type,
            sort: _sort,
            cursor: reset ? null : _nextCursor,
          )
          .timeout(const Duration(seconds: 10));

      if (!mounted || requestId != _requestId) return;
      setState(() {
        _items = reset ? page.items : [..._items, ...page.items];
        _nextCursor = page.nextCursor;
        _hasSearched = true;
        if (page.items.isEmpty && reset) {
          _analytics.empty(
            queryLength: query.length,
            type: _type,
            sort: _sort,
          );
        }
      });
    } catch (error) {
      if (!mounted || requestId != _requestId) return;
      setState(() {
        _error = error;
        _hasSearched = true;
        _analytics.error(
          queryLength: query.length,
          type: _type,
          sort: _sort,
        );
      });
    } finally {
      if (mounted && requestId == _requestId) {
        setState(() {
          _isLoading = false;
          _isLoadingMore = false;
        });
      }
    }
  }

  void _clearQuery() {
    _queryController.clear();
  }

  void _selectType(SearchType type) {
    if (_type == type) return;
    setState(() => _type = type);
    _analytics.filterChanged(type: _type, sort: _sort);
    if (_queryController.text.trim().length >= 2) _runSearch();
  }

  void _selectSort(SearchSort sort) {
    if (_sort == sort) return;
    setState(() => _sort = sort);
    _analytics.filterChanged(type: _type, sort: _sort);
    if (_queryController.text.trim().length >= 2) _runSearch();
  }

  Future<void> _openPoll(PollSummary poll) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => PollCommentsScreen(
          poll: poll,
          accessToken: widget.session.accessToken,
          pollsApiClient: _pollsApiClient,
        ),
      ),
    );
  }

  Future<void> _openUser(PublicProfile user) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => PublicProfileScreen(
          userId: user.id,
          currentUserId: widget.session.user.id,
          accessToken: widget.session.accessToken,
          profilesApiClient: _profilesApiClient,
          pollsApiClient: _pollsApiClient,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F8FC),
      appBar: AppBar(
        titleSpacing: 0,
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        title: TextField(
          controller: _queryController,
          focusNode: _queryFocusNode,
          textInputAction: TextInputAction.search,
          onSubmitted: (_) {
            _analytics.searchSubmitted(
              queryLength: _queryController.text.trim().length,
              type: _type,
              sort: _sort,
            );
            _runSearch();
          },
          decoration: InputDecoration(
            hintText: 'Search polls and users',
            border: InputBorder.none,
            suffixIcon: _queryController.text.isEmpty
                ? null
                : IconButton(
                    tooltip: 'Clear',
                    icon: const Icon(Icons.clear),
                    onPressed: _clearQuery,
                  ),
          ),
        ),
      ),
      body: Column(
        children: [
          _buildControls(),
          Expanded(child: _buildContent()),
        ],
      ),
    );
  }

  Widget _buildControls() {
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
      child: Row(
        children: [
          Expanded(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: SearchType.values.map((type) {
                  return Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(_typeLabel(type)),
                      selected: _type == type,
                      onSelected: (_) => _selectType(type),
                    ),
                  );
                }).toList(),
              ),
            ),
          ),
          DropdownButton<SearchSort>(
            value: _sort,
            underline: const SizedBox.shrink(),
            items: SearchSort.values.map((sort) {
              return DropdownMenuItem(
                  value: sort, child: Text(_sortLabel(sort)));
            }).toList(),
            onChanged: (sort) {
              if (sort != null) _selectSort(sort);
            },
          ),
        ],
      ),
    );
  }

  Widget _buildContent() {
    final queryLength = _queryController.text.trim().length;

    if (_isLoading && _items.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_error != null && _items.isEmpty) {
      return _ErrorState(onRetry: _runSearch);
    }

    if (!_hasSearched) {
      return Center(
        child: Text(
          queryLength == 1
              ? 'Enter at least 2 characters to search.'
              : 'Search for a poll or a user.',
          style:
              TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
      );
    }

    if (_items.isEmpty) {
      return const Center(child: Text('No results found.'));
    }

    return ListView.separated(
      controller: _scrollController,
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      itemCount: _items.length + (_isLoadingMore ? 1 : 0),
      separatorBuilder: (_, index) => const SizedBox(height: 12),
      itemBuilder: (context, index) {
        if (index == _items.length) {
          return const Center(
            child: Padding(
              padding: EdgeInsets.all(12),
              child: CircularProgressIndicator(),
            ),
          );
        }
        return _buildResult(_items[index]);
      },
    );
  }

  Widget _buildResult(SearchResult result) {
    if (result is PollSearchResult) {
      _analytics.resultClicked(
        resultType: 'poll',
        position: _items.indexOf(result),
      );
      return PollCard(
        poll: result.poll,
        accessToken: widget.session.accessToken,
        compact: true,
        onOpenComments: () => _openPoll(result.poll),
      );
    }

    final user = (result as UserSearchResult).user;
    _analytics.resultClicked(
      resultType: 'user',
      position: _items.indexOf(result),
    );
    return Card(
      margin: EdgeInsets.zero,
      child: InkWell(
        onTap: () => _openUser(user),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              UserAvatar(
                displayName: user.displayName,
                username: user.username,
                imageUrl: user.avatarUrl,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(user.displayName,
                        style: const TextStyle(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 4),
                    Text('@${user.username}',
                        style: const TextStyle(color: Color(0xFF667085))),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }

  String _typeLabel(SearchType type) => switch (type) {
        SearchType.all => 'All',
        SearchType.polls => 'Polls',
        SearchType.users => 'Users',
      };

  String _sortLabel(SearchSort sort) => switch (sort) {
        SearchSort.relevance => 'Relevance',
        SearchSort.newest => 'Newest',
        SearchSort.popular => 'Popular',
      };
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.cloud_off_outlined),
          const SizedBox(height: 12),
          const Text('Could not complete search.'),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}
