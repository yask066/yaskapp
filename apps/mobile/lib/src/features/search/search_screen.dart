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
import 'search_result.dart';

class SearchScreen extends StatefulWidget {
  const SearchScreen({
    required this.session,
    this.searchApiClient,
    this.pollsApiClient,
    this.profilesApiClient,
    this.reportsApiClient,
    this.analytics,
    super.key,
  });

  final AuthSession session;
  final SearchApiClient? searchApiClient;
  final PollsApiClient? pollsApiClient;
  final ProfilesApiClient? profilesApiClient;
  final ReportsApiClient? reportsApiClient;
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
  final Set<String> _votingPollIds = {};
  final Set<String> _likingPollIds = {};

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
    final updatedPoll = await Navigator.of(context).push<PollSummary>(
      MaterialPageRoute<PollSummary>(
        builder: (_) => PollCommentsScreen(
          poll: poll,
          accessToken: widget.session.accessToken,
          pollsApiClient: _pollsApiClient,
        ),
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

  Future<void> _vote(PollSummary poll, PollOptionSummary option) async {
    if (_votingPollIds.contains(poll.id) || poll.isClosed) return;
    setState(() => _votingPollIds.add(poll.id));
    try {
      final updated = await _pollsApiClient.vote(
        pollId: poll.id,
        optionId: option.id,
        accessToken: widget.session.accessToken,
      );
      if (mounted) _replacePoll(updated);
    } on PollsApiException catch (error) {
      _showSnackBar(error.userMessage);
    } catch (_) {
      _showSnackBar('Could not submit vote.');
    } finally {
      if (mounted) setState(() => _votingPollIds.remove(poll.id));
    }
  }

  Future<void> _cancelVote(PollSummary poll) async {
    if (_votingPollIds.contains(poll.id) || poll.isClosed) return;
    setState(() => _votingPollIds.add(poll.id));
    try {
      final updated = await _pollsApiClient.cancelVote(
        pollId: poll.id,
        accessToken: widget.session.accessToken,
      );
      if (mounted) _replacePoll(updated);
    } on PollsApiException catch (error) {
      _showSnackBar(error.userMessage);
    } catch (_) {
      _showSnackBar('Could not cancel vote.');
    } finally {
      if (mounted) setState(() => _votingPollIds.remove(poll.id));
    }
  }

  Future<void> _toggleLike(PollSummary poll) async {
    if (_likingPollIds.contains(poll.id)) return;
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
    } on PollsApiException catch (error) {
      _showSnackBar(error.userMessage);
    } catch (_) {
      _showSnackBar('Could not update like.');
    } finally {
      if (mounted) setState(() => _likingPollIds.remove(poll.id));
    }
  }

  Future<void> _deletePoll(PollSummary poll) async {
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
    if (confirmed != true || !mounted) return;
    try {
      await _pollsApiClient.deletePoll(
        pollId: poll.id,
        accessToken: widget.session.accessToken,
      );
      if (!mounted) return;
      setState(() => _items.removeWhere(
            (item) => item is PollSearchResult && item.poll.id == poll.id,
          ));
      _showSnackBar('Poll deleted.');
    } on PollsApiException catch (error) {
      _showSnackBar(error.userMessage);
    } catch (_) {
      _showSnackBar('Could not delete poll.');
    }
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
                          icon: const Icon(Icons.cancel, color: Color(0xFFB6B8C0)),
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
                        color: _type == type ? Colors.white : const Color(0xFF101828),
                        fontWeight: FontWeight.w600,
                      ),
                      backgroundColor: const Color(0xFFF5F6FA),
                      selectedColor: const Color(0xFF4D6FC4),
                      side: BorderSide.none,
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
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
        return const Center(child: Text('Enter at least 2 characters to search.'));
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
          _buildSectionHeader('Recent searches', 'Clear'),
          _buildChipWrap(['Formula 1', 'Programming', 'test user', 'Football', 'Kotlin'], Icons.history),
          const SizedBox(height: 24),
          _buildSectionHeader('Explore popular searches'),
          _buildChipWrap(['Formula 1', 'Football', 'Gaming', 'Movies', 'Technology', 'Travel', 'Music', 'Science'], Icons.trending_up),
          const SizedBox(height: 24),
          _buildSectionHeader('Top users', 'View all'),
          _buildTopUsers(),
          const SizedBox(height: 24),
          _buildSectionHeader('Top polls', 'View all'),
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
                      Text('Find something interesting', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
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

  Widget _buildSectionHeader(String title, [String? action]) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          if (action != null)
            Text(action, style: const TextStyle(color: Color(0xFF315FC4), fontWeight: FontWeight.w600)),
        ],
      ),
    );
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
                  _queryController.selection = TextSelection.collapsed(offset: label.length);
                },
              ))
          .toList(),
    );
  }

  Widget _buildTopUsers() {
    const users = [
      ('FormulaFan', '@formulafan', '12.4K followers'),
      ('CodeMaster', '@codemaster', '8.7K followers'),
      ('PollKing', '@pollking', '5.1K followers'),
    ];
    return _discoveryCard(
      Column(
        children: users
            .map((user) => Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  child: Row(
                    children: [
                      CircleAvatar(radius: 27, backgroundColor: const Color(0xFFDDE5F7), child: Text(user.$1.substring(0, 1))),
                      const SizedBox(width: 12),
                      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(user.$1, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                        Text(user.$2, style: const TextStyle(color: Color(0xFF667085))),
                        Text(user.$3, style: const TextStyle(color: Color(0xFF667085))),
                      ])),
                      OutlinedButton(onPressed: () {}, child: const Text('Follow')),
                    ],
                  ),
                ))
            .toList(),
      ),
    );
  }

  Widget _buildTopPolls() {
    const polls = [
      ('Who will win the 2026 Formula 1 World Championship?', 'Max Verstappen', '42%'),
      ('Which programming language do you use most?', 'Kotlin', '58%'),
      ('Which team will win the Champions League?', 'Real Madrid', '40%'),
    ];
    return Column(
      children: polls
          .map((poll) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: _discoveryCard(
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(poll.$1, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                      const SizedBox(height: 14),
                      Row(children: [Expanded(child: Text(poll.$2)), const SizedBox(width: 12), Expanded(child: LinearProgressIndicator(value: .55, minHeight: 5, borderRadius: BorderRadius.circular(5))), const SizedBox(width: 12), Text(poll.$3)]),
                      const SizedBox(height: 10),
                      const Text('1.2K votes  •  3 hours ago', style: TextStyle(color: Color(0xFF667085))),
                    ]),
                  ),
                ),
              ))
          .toList(),
    );
  }

  Widget _discoveryCard(Widget child) => Container(
        width: double.infinity,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: const Color(0xFFE7EAF1)),
          boxShadow: const [BoxShadow(color: Color(0x0D101828), blurRadius: 12, offset: Offset(0, 4))],
        ),
        child: child,
      );

  Widget _buildResult(SearchResult result) {
    if (result is PollSearchResult) {
      return PollCard(
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
