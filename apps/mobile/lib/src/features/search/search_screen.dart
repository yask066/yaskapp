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
import '../reports/report_dialog.dart';
import '../reports/reports_api_client.dart';
import 'search_api_client.dart';
import 'search_history.dart';
import 'search_result.dart';

class SearchScreen extends StatefulWidget {
  const SearchScreen({
    required this.session,
    this.searchApiClient,
    this.pollsApiClient,
    this.profilesApiClient,
    this.reportsApiClient,
    this.searchHistory,
    this.analytics,
    super.key,
  });

  final AuthSession session;
  final SearchApiClient? searchApiClient;
  final PollsApiClient? pollsApiClient;
  final ProfilesApiClient? profilesApiClient;
  final ReportsApiClient? reportsApiClient;
  final SearchHistoryStore? searchHistory;
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
  late final ReportsApiClient _reportsApiClient;
  late final bool _ownsReportsApiClient;
  late final SearchAnalytics _analytics;
  late final SearchHistoryStore _searchHistory;

  Timer? _debounce;
  List<SearchResult> _items = [];
  List<PublicProfile> _topUsers = [];
  List<PollSummary> _topPolls = [];
  List<String> _recentSearches = [];
  String? _nextCursor;
  Object? _error;
  Object? _topUsersError;
  Object? _topPollsError;
  var _hasSearched = false;
  var _isLoading = false;
  var _isLoadingMore = false;
  var _isLoadingTopUsers = true;
  var _isLoadingTopPolls = true;
  var _requestId = 0;
  var _type = SearchType.all;
  var _sort = SearchSort.relevance;
  final Set<String> _votingPollIds = {};
  final Set<String> _likingPollIds = {};
  final Set<String> _followingUserIds = {};

  @override
  void initState() {
    super.initState();
    _ownsSearchApiClient = widget.searchApiClient == null;
    _ownsPollsApiClient = widget.pollsApiClient == null;
    _ownsProfilesApiClient = widget.profilesApiClient == null;
    _ownsReportsApiClient = widget.reportsApiClient == null;
    _searchApiClient = widget.searchApiClient ?? SearchApiClient();
    _pollsApiClient = widget.pollsApiClient ?? PollsApiClient();
    _profilesApiClient = widget.profilesApiClient ?? ProfilesApiClient();
    _reportsApiClient = widget.reportsApiClient ?? ReportsApiClient();
    _analytics = widget.analytics ?? const NoopSearchAnalytics();
    _searchHistory = widget.searchHistory ??
        SecureSearchHistoryStore(userId: widget.session.user.id);
    _analytics.searchOpened();
    _loadSearchHistory();
    _loadTopUsers();
    _loadTopPolls();
    _queryController.addListener(_handleQueryChanged);
    _scrollController.addListener(_handleScroll);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _queryFocusNode.requestFocus();
    });
  }

  Future<void> _loadSearchHistory() async {
    final history = await _searchHistory.read();
    if (!mounted) return;
    setState(() => _recentSearches = history);
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
    if (_ownsReportsApiClient) _reportsApiClient.close();
    super.dispose();
  }

  void _handleQueryChanged() {
    _debounce?.cancel();
    ++_requestId;
    final query = _queryController.text.trim();

    if (query.length < 2) {
      if (mounted) {
        setState(() {
          _items = [];
          _nextCursor = null;
          _error = null;
          _hasSearched = false;
          _isLoading = false;
          _isLoadingMore = false;
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

  void _submitSearch() {
    _debounce?.cancel();
    _debounce = null;
    _runSearch();
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
      if (reset) {
        await _searchHistory.add(query);
        if (mounted) await _loadSearchHistory();
      }
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

  Future<void> _loadTopUsers() async {
    try {
      final users = await _profilesApiClient
          .listPopularUsers(accessToken: widget.session.accessToken, limit: 3)
          .timeout(const Duration(seconds: 10));
      if (!mounted) return;
      setState(() {
        _topUsers = users;
        _topUsersError = null;
        _isLoadingTopUsers = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _topUsersError = error;
        _isLoadingTopUsers = false;
      });
    }
  }

  Future<void> _toggleFollow(PublicProfile user) async {
    if (_followingUserIds.contains(user.id)) return;
    setState(() => _followingUserIds.add(user.id));
    try {
      final relationship = user.viewerIsFollowing
          ? await _profilesApiClient.unfollow(
              userId: user.id, accessToken: widget.session.accessToken)
          : await _profilesApiClient.follow(
              userId: user.id, accessToken: widget.session.accessToken);
      if (!mounted) return;
      final index = _topUsers.indexWhere((item) => item.id == user.id);
      if (index != -1) {
        setState(() {
          _topUsers[index] = user.copyWith(
            followersCount: relationship.followeeFollowersCount,
            viewerIsFollowing: relationship.following,
          );
        });
      }
    } on ProfilesApiException catch (error) {
      _showSnackBar(error.message);
    } catch (_) {
      _showSnackBar('Could not update follow.');
    } finally {
      if (mounted) setState(() => _followingUserIds.remove(user.id));
    }
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

  Future<PollSummary?> _openPoll(PollSummary poll) async {
    final updatedPoll = await Navigator.of(context).push<PollSummary>(
      MaterialPageRoute<PollSummary>(
        builder: (_) => PollCommentsScreen(
          poll: poll,
          accessToken: widget.session.accessToken,
          pollsApiClient: _pollsApiClient,
          currentUserId: widget.session.user.id,
        ),
      ),
    );
    if (updatedPoll != null && mounted) _replacePoll(updatedPoll);
    return updatedPoll;
  }

  Future<void> _openPollPreview(PollSummary poll) async {
    final updatedPoll = await showDialog<PollSummary>(
      context: context,
      builder: (_) => _PollPreviewDialog(
        poll: poll,
        accessToken: widget.session.accessToken,
        onVote: _vote,
        onCancelVote: _cancelVote,
        onToggleLike: _toggleLike,
        onOpenComments: _openPoll,
        onOpenAuthor: _openAuthor,
        onDeletePoll: (poll) async {
          if (await _deletePoll(poll) && mounted) {
            Navigator.of(context).pop();
          }
        },
        onReport: _reportPoll,
      ),
    );
    if (updatedPoll != null && mounted) _replacePoll(updatedPoll);
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

  Future<void> _openAuthor(PollSummary poll) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => PublicProfileScreen(
          userId: poll.author.id,
          currentUserId: widget.session.user.id,
          accessToken: widget.session.accessToken,
          profilesApiClient: _profilesApiClient,
          pollsApiClient: _pollsApiClient,
        ),
      ),
    );
  }

  void _replacePoll(PollSummary updatedPoll) {
    final index = _items.indexWhere(
      (item) => item is PollSearchResult && item.poll.id == updatedPoll.id,
    );
    if (index == -1) return;
    final item = _items[index] as PollSearchResult;
    setState(() {
      _items[index] = PollSearchResult(score: item.score, poll: updatedPoll);
    });
  }

  Future<PollSummary?> _vote(
    PollSummary poll,
    PollOptionSummary option,
  ) async {
    if (_votingPollIds.contains(poll.id) || poll.isClosed) return null;
    setState(() => _votingPollIds.add(poll.id));
    try {
      final updated = await _pollsApiClient.vote(
        pollId: poll.id,
        optionId: option.id,
        accessToken: widget.session.accessToken,
      );
      if (mounted) _replacePoll(updated);
      return updated;
    } on PollsApiException catch (error) {
      _showSnackBar(error.userMessage);
    } catch (_) {
      _showSnackBar('Could not submit vote.');
    } finally {
      if (mounted) setState(() => _votingPollIds.remove(poll.id));
    }
    return null;
  }

  Future<PollSummary?> _cancelVote(PollSummary poll) async {
    if (_votingPollIds.contains(poll.id) || poll.isClosed) return null;
    setState(() => _votingPollIds.add(poll.id));
    try {
      final updated = await _pollsApiClient.cancelVote(
        pollId: poll.id,
        accessToken: widget.session.accessToken,
      );
      if (mounted) _replacePoll(updated);
      return updated;
    } on PollsApiException catch (error) {
      _showSnackBar(error.userMessage);
    } catch (_) {
      _showSnackBar('Could not cancel vote.');
    } finally {
      if (mounted) setState(() => _votingPollIds.remove(poll.id));
    }
    return null;
  }

  Future<PollSummary?> _toggleLike(PollSummary poll) async {
    if (_likingPollIds.contains(poll.id)) return null;
    setState(() => _likingPollIds.add(poll.id));
    try {
      final updated = poll.viewerHasLiked
          ? await _pollsApiClient.unlikePoll(
              pollId: poll.id,
              accessToken: widget.session.accessToken,
            )
          : await _pollsApiClient.likePoll(
              pollId: poll.id,
              accessToken: widget.session.accessToken,
            );
      if (mounted) _replacePoll(updated);
      return updated;
    } on PollsApiException catch (error) {
      _showSnackBar(error.userMessage);
    } catch (_) {
      _showSnackBar('Could not update like.');
    } finally {
      if (mounted) setState(() => _likingPollIds.remove(poll.id));
    }
    return null;
  }

  Future<bool> _deletePoll(PollSummary poll) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete poll?'),
        content: const Text('This poll will be removed from search results.'),
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
    if (confirmed != true || !mounted) return false;
    try {
      await _pollsApiClient.deletePoll(
        pollId: poll.id,
        accessToken: widget.session.accessToken,
      );
      if (!mounted) return false;
      setState(() => _items.removeWhere(
            (item) => item is PollSearchResult && item.poll.id == poll.id,
          ));
      _showSnackBar('Poll deleted.');
      return true;
    } on PollsApiException catch (error) {
      _showSnackBar(error.userMessage);
    } catch (_) {
      _showSnackBar('Could not delete poll.');
    }
    return false;
  }

  Future<void> _reportPoll(PollSummary poll) {
    return showReportDialog(
      context: context,
      accessToken: widget.session.accessToken,
      targetType: 'poll',
      targetId: poll.id,
      reportsApiClient: _reportsApiClient,
    );
  }

  void _showSnackBar(String message) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    }
  }

  void _recordResultClick(SearchResult result) {
    _analytics.resultClicked(
      resultType: result is PollSearchResult ? 'poll' : 'user',
      position: _items.indexOf(result),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: Column(
        children: [
          SafeArea(bottom: false, child: _buildSearchHeader()),
          _buildControls(),
          Expanded(child: _buildContent()),
        ],
      ),
    );
  }

  Widget _buildSearchHeader() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Back',
            onPressed: () => Navigator.of(context).maybePop(),
            icon: const Icon(Icons.arrow_back, size: 28),
          ),
          const SizedBox(width: 4),
          Expanded(
            child: Container(
              height: 58,
              decoration: BoxDecoration(
                color: const Color(0xFFF5F6FA),
                borderRadius: BorderRadius.circular(24),
                border: Border.all(color: const Color(0xFFE4E7EF)),
              ),
              child: TextField(
                controller: _queryController,
                focusNode: _queryFocusNode,
                textInputAction: TextInputAction.search,
                onSubmitted: (_) {
                  _analytics.searchSubmitted(
                    queryLength: _queryController.text.trim().length,
                    type: _type,
                    sort: _sort,
                  );
                  _submitSearch();
                },
                decoration: InputDecoration(
                  hintText: 'Search polls and users',
                  hintStyle: const TextStyle(
                    color: Color(0xFF667085),
                    fontSize: 17,
                  ),
                  prefixIcon: const Icon(Icons.search, size: 30),
                  border: InputBorder.none,
                  contentPadding: const EdgeInsets.symmetric(vertical: 17),
                  suffixIcon: _queryController.text.isEmpty
                      ? null
                      : IconButton(
                          tooltip: 'Clear',
                          icon: const Icon(Icons.cancel,
                              color: Color(0xFFB6B8C0)),
                          onPressed: _clearQuery,
                        ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 10),
          Container(
            height: 58,
            width: 58,
            decoration: BoxDecoration(
              color: const Color(0xFFF5F6FA),
              borderRadius: BorderRadius.circular(18),
            ),
            child: const Icon(Icons.tune, size: 27),
          ),
        ],
      ),
    );
  }

  Widget _buildControls() {
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 14),
      child: Row(
        children: [
          Expanded(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: SearchType.values.map((type) {
                  return Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: FilterChip(
                      label: Text(_typeLabel(type)),
                      selected: _type == type,
                      showCheckmark: _type == type,
                      checkmarkColor: Colors.white,
                      labelStyle: TextStyle(
                        color: _type == type
                            ? Colors.white
                            : const Color(0xFF101828),
                        fontWeight: FontWeight.w600,
                      ),
                      backgroundColor: const Color(0xFFF5F6FA),
                      selectedColor: const Color(0xFF4D6FC4),
                      side: BorderSide.none,
                      padding: const EdgeInsets.symmetric(
                          horizontal: 14, vertical: 9),
                      onSelected: (_) => _selectType(type),
                    ),
                  );
                }).toList(),
              ),
            ),
          ),
          PopupMenuButton<SearchSort>(
            tooltip: 'Sort results',
            initialValue: _sort,
            onSelected: _selectSort,
            itemBuilder: (context) => SearchSort.values
                .map((sort) => PopupMenuItem(
                      value: sort,
                      child: Text(_sortLabel(sort)),
                    ))
                .toList(),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
              decoration: BoxDecoration(
                color: const Color(0xFFF5F6FA),
                borderRadius: BorderRadius.circular(18),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('Sort by: ${_sortLabel(_sort)}',
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(width: 4),
                  const Icon(Icons.keyboard_arrow_down, size: 20),
                ],
              ),
            ),
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
      return _ErrorState(
        message: _error is SearchApiException
            ? (_error as SearchApiException).message
            : null,
        onRetry: _runSearch,
      );
    }

    if (!_hasSearched) {
      if (queryLength == 1) {
        return const Center(
            child: Text('Enter at least 2 characters to search.'));
      }
      return _buildDiscoveryContent();
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

  Widget _buildDiscoveryContent() {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 28),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildSectionHeader(
            'Recent searches',
            action: _recentSearches.isEmpty ? null : 'Clear',
            onAction: _recentSearches.isEmpty ? null : _clearSearchHistory,
          ),
          if (_recentSearches.isNotEmpty)
            _buildChipWrap(_recentSearches, Icons.history)
          else
            const Text('Your recent searches will appear here.'),
          const SizedBox(height: 24),
          _buildSectionHeader('Explore popular searches'),
          _buildChipWrap([
            'Formula 1',
            'Football',
            'Gaming',
            'Movies',
            'Technology',
            'Travel',
            'Music',
            'Science'
          ], Icons.trending_up),
          const SizedBox(height: 24),
          _buildSectionHeader('Top users', action: 'View all'),
          _buildTopUsers(),
          const SizedBox(height: 24),
          _buildSectionHeader('Top polls', action: 'View all'),
          _buildTopPolls(),
          const SizedBox(height: 24),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: const Color(0xFFF5F7FC),
              borderRadius: BorderRadius.circular(24),
            ),
            child: const Row(
              children: [
                Icon(Icons.manage_search, size: 58, color: Color(0xFF4D6FC4)),
                SizedBox(width: 18),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Find something interesting',
                          style: TextStyle(
                              fontSize: 18, fontWeight: FontWeight.w700)),
                      SizedBox(height: 5),
                      Text('Search for polls, topics or people on Yask.'),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionHeader(String title,
      {String? action, VoidCallback? onAction}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(title,
              style:
                  const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          if (action != null)
            TextButton(
              onPressed: onAction,
              child: Text(action),
            ),
        ],
      ),
    );
  }

  Future<void> _clearSearchHistory() async {
    await _searchHistory.clear();
    if (mounted) setState(() => _recentSearches = []);
  }

  Widget _buildChipWrap(List<String> labels, IconData icon) {
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: labels
          .map((label) => ActionChip(
                avatar: Icon(icon, size: 18),
                label: Text(label),
                backgroundColor: const Color(0xFFF5F6FA),
                side: BorderSide.none,
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 9),
                onPressed: () {
                  _queryController.text = label;
                  _queryController.selection =
                      TextSelection.collapsed(offset: label.length);
                },
              ))
          .toList(),
    );
  }

  Widget _buildTopUsers() {
    if (_isLoadingTopUsers) {
      return _discoveryCard(const Padding(
        padding: EdgeInsets.all(24),
        child: Center(child: CircularProgressIndicator()),
      ));
    }
    if (_topUsersError != null) {
      final error = _topUsersError;
      final message = error is ProfilesApiException
          ? '${error.message}${error.statusCode == null ? '' : ' (${error.statusCode})'}'
          : 'Could not load users.';
      return _discoveryCard(ListTile(
        leading: const Icon(Icons.cloud_off_outlined),
        title: Text(message),
        trailing:
            TextButton(onPressed: _loadTopUsers, child: const Text('Retry')),
      ));
    }
    if (_topUsers.isEmpty) {
      return _discoveryCard(const Padding(
        padding: EdgeInsets.all(20),
        child: Text('No users to show yet.'),
      ));
    }
    return _discoveryCard(
      Column(
        children: _topUsers
            .map((user) => Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
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
                                style: const TextStyle(
                                    fontWeight: FontWeight.w700, fontSize: 16)),
                            Text('@${user.username}',
                                style:
                                    const TextStyle(color: Color(0xFF667085))),
                            Text('${user.followersCount} followers',
                                style:
                                    const TextStyle(color: Color(0xFF667085))),
                          ])),
                      OutlinedButton(
                        onPressed: () => _toggleFollow(user),
                        child: Text(
                            user.viewerIsFollowing ? 'Following' : 'Follow'),
                      ),
                    ],
                  ),
                ))
            .toList(),
      ),
    );
  }

  Widget _buildTopPolls() {
    if (_isLoadingTopPolls) {
      return _discoveryCard(const Padding(
        padding: EdgeInsets.all(24),
        child: Center(child: CircularProgressIndicator()),
      ));
    }
    if (_topPollsError != null) {
      return _discoveryCard(ListTile(
        leading: const Icon(Icons.cloud_off_outlined),
        title: const Text('Could not load polls.'),
        trailing:
            TextButton(onPressed: _loadTopPolls, child: const Text('Retry')),
      ));
    }
    if (_topPolls.isEmpty) {
      return _discoveryCard(const Padding(
        padding: EdgeInsets.all(20),
        child: Text('No polls to show yet.'),
      ));
    }
    return Column(
      children: _topPolls
          .map((poll) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: _discoveryCard(
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(poll.question,
                              style: const TextStyle(
                                  fontWeight: FontWeight.w700, fontSize: 16)),
                          const SizedBox(height: 14),
                          Row(children: [
                            Expanded(child: Text(_leadingOption(poll).text)),
                            const SizedBox(width: 12),
                            Expanded(
                                child: LinearProgressIndicator(
                                    value: _leadingOptionRatio(poll),
                                    minHeight: 5,
                                    borderRadius: BorderRadius.circular(5))),
                            const SizedBox(width: 12),
                            Text(
                                '${(_leadingOptionRatio(poll) * 100).round()}%')
                          ]),
                          const SizedBox(height: 10),
                          Text(
                              '${poll.votesCount} votes  •  ${_formatPollAge(poll)}',
                              style: const TextStyle(color: Color(0xFF667085))),
                        ]),
                  ),
                ),
              ))
          .toList(),
    );
  }

  Future<void> _loadTopPolls() async {
    if (mounted) {
      setState(() {
        _isLoadingTopPolls = true;
        _topPollsError = null;
      });
    }
    try {
      final polls = await _pollsApiClient.listPolls(
        accessToken: widget.session.accessToken,
        limit: 3,
        sort: 'popular',
      );
      if (mounted) setState(() => _topPolls = polls);
    } catch (error) {
      if (mounted) setState(() => _topPollsError = error);
    } finally {
      if (mounted) setState(() => _isLoadingTopPolls = false);
    }
  }

  PollOptionSummary _leadingOption(PollSummary poll) {
    return poll.options.reduce(
        (left, right) => left.votesCount >= right.votesCount ? left : right);
  }

  double _leadingOptionRatio(PollSummary poll) {
    if (poll.votesCount == 0) return 0;
    return (_leadingOption(poll).votesCount / poll.votesCount)
        .clamp(0, 1)
        .toDouble();
  }

  String _formatPollAge(PollSummary poll) {
    final age = DateTime.now().difference(poll.createdAt);
    if (age.inDays > 0) return '${age.inDays}d ago';
    if (age.inHours > 0) return '${age.inHours}h ago';
    return '${age.inMinutes.clamp(1, 59)}m ago';
  }

  Widget _discoveryCard(Widget child) => Container(
        width: double.infinity,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: const Color(0xFFE7EAF1)),
          boxShadow: const [
            BoxShadow(
                color: Color(0x0D101828), blurRadius: 12, offset: Offset(0, 4))
          ],
        ),
        child: child,
      );

  Widget _buildResult(SearchResult result) {
    if (result is PollSearchResult) {
      return GestureDetector(
        key: ValueKey('search-poll-result-${result.poll.id}'),
        onTap: () {
          _recordResultClick(result);
          _openPollPreview(result.poll);
        },
        child: PollCard(
          poll: result.poll,
          accessToken: widget.session.accessToken,
          compact: true,
          onOpenAuthor: () => _openAuthor(result.poll),
          onVote: result.poll.isClosed ||
                  result.poll.selectedOptionIndex != null ||
                  _votingPollIds.contains(result.poll.id)
              ? null
              : (option) => _vote(result.poll, option),
          onCancelVote:
              result.poll.isClosed || _votingPollIds.contains(result.poll.id)
                  ? null
                  : () => _cancelVote(result.poll),
          onDeletePoll: result.poll.author.id == widget.session.user.id
              ? () => _deletePoll(result.poll)
              : null,
          onReport: result.poll.author.id == widget.session.user.id
              ? null
              : () => _reportPoll(result.poll),
          isVoting: _votingPollIds.contains(result.poll.id),
          onOpenComments: () {
            _recordResultClick(result);
            _openPoll(result.poll);
          },
          onToggleLike: _likingPollIds.contains(result.poll.id)
              ? null
              : () => _toggleLike(result.poll),
          isLiking: _likingPollIds.contains(result.poll.id),
        ),
      );
    }

    final user = (result as UserSearchResult).user;
    return Card(
      margin: EdgeInsets.zero,
      child: InkWell(
        onTap: () {
          _recordResultClick(result);
          _openUser(user);
        },
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

class _PollPreviewDialog extends StatefulWidget {
  const _PollPreviewDialog({
    required this.poll,
    required this.accessToken,
    required this.onVote,
    required this.onCancelVote,
    required this.onToggleLike,
    required this.onOpenComments,
    required this.onOpenAuthor,
    required this.onDeletePoll,
    required this.onReport,
  });

  final PollSummary poll;
  final String accessToken;
  final Future<PollSummary?> Function(
    PollSummary poll,
    PollOptionSummary option,
  ) onVote;
  final Future<PollSummary?> Function(PollSummary poll) onCancelVote;
  final Future<PollSummary?> Function(PollSummary poll) onToggleLike;
  final Future<PollSummary?> Function(PollSummary poll) onOpenComments;
  final Future<void> Function(PollSummary poll) onOpenAuthor;
  final Future<void> Function(PollSummary poll)? onDeletePoll;
  final Future<void> Function(PollSummary poll)? onReport;

  @override
  State<_PollPreviewDialog> createState() => _PollPreviewDialogState();
}

class _PollPreviewDialogState extends State<_PollPreviewDialog> {
  late PollSummary _poll;
  var _isVoting = false;
  var _isLiking = false;

  @override
  void initState() {
    super.initState();
    _poll = widget.poll;
  }

  Future<void> _vote(PollOptionSummary option) async {
    if (_isVoting || _poll.isClosed) return;
    setState(() => _isVoting = true);
    try {
      final updatedPoll = await widget.onVote(_poll, option);
      if (mounted && updatedPoll != null) setState(() => _poll = updatedPoll);
    } finally {
      if (mounted) setState(() => _isVoting = false);
    }
  }

  Future<void> _cancelVote() async {
    if (_isVoting || _poll.isClosed) return;
    setState(() => _isVoting = true);
    try {
      final updatedPoll = await widget.onCancelVote(_poll);
      if (mounted && updatedPoll != null) setState(() => _poll = updatedPoll);
    } finally {
      if (mounted) setState(() => _isVoting = false);
    }
  }

  Future<void> _toggleLike() async {
    if (_isLiking) return;
    setState(() => _isLiking = true);
    try {
      final updatedPoll = await widget.onToggleLike(_poll);
      if (mounted && updatedPoll != null) setState(() => _poll = updatedPoll);
    } finally {
      if (mounted) setState(() => _isLiking = false);
    }
  }

  Future<void> _openComments() async {
    final updatedPoll = await widget.onOpenComments(_poll);
    if (mounted && updatedPoll != null) setState(() => _poll = updatedPoll);
  }

  @override
  Widget build(BuildContext context) {
    final canVote = !_poll.isClosed &&
        _poll.selectedOptionIndex == null &&
        !_isVoting;
    final canCancelVote = !_poll.isClosed &&
        _poll.selectedOptionIndex != null &&
        !_isVoting;

    return Dialog(
      key: const ValueKey('poll-preview-dialog'),
      insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * .88,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 12, 8),
              child: Row(
                children: [
                  const Expanded(
                    child: Text(
                      'Poll details',
                      style: TextStyle(
                        color: Color(0xFF10142D),
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: 'Close',
                    onPressed: () => Navigator.of(context).pop(_poll),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
            ),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
                child: PollCard(
                  poll: _poll,
                  accessToken: widget.accessToken,
                  onOpenAuthor: () => widget.onOpenAuthor(_poll),
                  onVote: canVote ? _vote : null,
                  onCancelVote: canCancelVote ? _cancelVote : null,
                  onDeletePoll: widget.onDeletePoll == null
                      ? null
                      : () => widget.onDeletePoll!(_poll),
                  onReport: widget.onReport == null
                      ? null
                      : () => widget.onReport!(_poll),
                  onOpenComments: _openComments,
                  onToggleLike: _isLiking ? null : _toggleLike,
                  isVoting: _isVoting,
                  isLiking: _isLiking,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.onRetry, this.message});

  final VoidCallback onRetry;
  final String? message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.cloud_off_outlined),
          const SizedBox(height: 12),
          Text(message ?? 'Could not complete search.'),
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
