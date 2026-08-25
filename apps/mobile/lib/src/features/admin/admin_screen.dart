import 'package:flutter/material.dart';
import 'dart:async';

import 'admin_api_client.dart';
import '../realtime/realtime_client.dart';

class AdminScreen extends StatefulWidget {
  const AdminScreen({required this.accessToken, required this.apiClient, this.capabilities, RealtimeClient? realtimeClient, super.key}) : _realtimeClient = realtimeClient;
  final String accessToken;
  final AdminApiClient apiClient;
  final AdminCapabilities? capabilities;
  final RealtimeClient? _realtimeClient;
  @override
  State<AdminScreen> createState() => _AdminScreenState();
}

class _AdminScreenState extends State<AdminScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 3, vsync: this);
  final _query = TextEditingController();
  var _loading = true;
  String? _error;
  var _userStatus = 'all';
  var _userRole = 'all';
  var _pollStatus = 'all';
  DateTimeRange? _dateRange;
  List<AdminUserSummary> _users = [];
  List<AdminPollSummary> _polls = [];
  List<AdminAuditEntry> _audit = [];
  String? _usersCursor;
  String? _pollsCursor;
  String? _auditCursor;
  var _auditAvailable = true;
  late final RealtimeClient _realtime;
  late final bool _ownsRealtime;
  StreamSubscription<UserModerationRealtimeEvent>? _blockedSubscription;
  StreamSubscription<UserModerationRealtimeEvent>? _unblockedSubscription;

  AdminCapabilities get _capabilities => widget.capabilities ?? const AdminCapabilities(<String>{});

  @override
  void initState() {
    super.initState();
    _ownsRealtime = widget._realtimeClient == null;
    _realtime = widget._realtimeClient ?? RealtimeClient();
    _blockedSubscription = _realtime.userBlocked.listen((_) => _load());
    _unblockedSubscription = _realtime.userUnblocked.listen((_) => _load());
    _realtime.connect();
    _load();
  }
  @override
  void dispose() {
    unawaited(_blockedSubscription?.cancel());
    unawaited(_unblockedSubscription?.cancel());
    if (_ownsRealtime) unawaited(_realtime.close());
    _tabs.dispose();
    _query.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final results = await Future.wait([
        widget.apiClient.listUsers(accessToken: widget.accessToken, query: _query.text, status: _userStatus, role: _userRole, createdFrom: _dateRange?.start, createdTo: _dateRange == null ? null : _dateRange!.end.add(const Duration(days: 1))),
        widget.apiClient.listPolls(accessToken: widget.accessToken, query: _query.text, status: _pollStatus, createdFrom: _dateRange?.start, createdTo: _dateRange == null ? null : _dateRange!.end.add(const Duration(days: 1))),
      ]);
      List<AdminAuditEntry> audit = [];
      var auditAvailable = _capabilities.canReadAudit;
      if (auditAvailable) {
        try {
          final page = await widget.apiClient.listAudit(accessToken: widget.accessToken, from: _dateRange?.start, to: _dateRange == null ? null : _dateRange!.end.add(const Duration(days: 1)));
          audit = page.items;
          _auditCursor = page.nextCursor;
        } on AdminApiException catch (error) {
          if (error.statusCode != 403) rethrow;
          auditAvailable = false;
        }
      }
      if (!mounted) return;
      final usersPage = results[0] as AdminPage<AdminUserSummary>;
      final pollsPage = results[1] as AdminPage<AdminPollSummary>;
      setState(() { _users = usersPage.items; _usersCursor = usersPage.nextCursor; _polls = pollsPage.items; _pollsCursor = pollsPage.nextCursor; _audit = audit; _auditAvailable = auditAvailable; _loading = false; });
    } on AdminApiException catch (error) {
      if (mounted) setState(() { _loading = false; _error = error.userMessage; });
    }
  }

  Future<String?> _reason(String title) async {
    final controller = TextEditingController();
    final value = await showDialog<String>(context: context, builder: (context) => AlertDialog(
      title: Text(title),
      content: TextField(controller: controller, autofocus: true, maxLength: 500, maxLines: 3, decoration: const InputDecoration(labelText: 'Reason', hintText: 'Required for audit log.')),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')), FilledButton(onPressed: () { if (controller.text.trim().isNotEmpty) Navigator.pop(context, controller.text.trim()); }, child: const Text('Confirm'))],
    ));
    controller.dispose();
    return value;
  }

  Future<void> _userAction(AdminUserSummary user, String action) async {
    if (action == 'Role') {
      await _changeRole(user);
      return;
    }
    final reason = await _reason('$action @${user.username}');
    if (reason == null || !mounted) return;
    try {
      if (action == 'Block') await widget.apiClient.blockUser(userId: user.id, accessToken: widget.accessToken, reason: reason);
      if (action == 'Unblock') await widget.apiClient.unblockUser(userId: user.id, accessToken: widget.accessToken, reason: reason);
      if (action == 'Delete') await widget.apiClient.deleteUser(userId: user.id, accessToken: widget.accessToken, reason: reason);
      await _load();
    } on AdminApiException catch (error) { if (mounted) _showError(error.userMessage); }
  }

  Future<void> _changeRole(AdminUserSummary user) async {
    var role = user.role;
    final reasonController = TextEditingController();
    final result = await showDialog<(String, String)?>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Change role @${user.username}'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          DropdownButtonFormField<String>(value: role, items: const [
            DropdownMenuItem(value: 'user', child: Text('User')),
            DropdownMenuItem(value: 'moderator', child: Text('Moderator')),
            DropdownMenuItem(value: 'superadmin', child: Text('Superadmin')),
          ], onChanged: (value) { if (value != null) role = value; }),
          TextField(controller: reasonController, maxLength: 500, maxLines: 2, decoration: const InputDecoration(labelText: 'Reason')),
        ]),
        actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')), FilledButton(onPressed: () { if (reasonController.text.trim().isNotEmpty) Navigator.pop(context, (role, reasonController.text.trim())); }, child: const Text('Save'))],
      ),
    );
    reasonController.dispose();
    if (result == null) return;
    try {
      await widget.apiClient.changeRole(userId: user.id, role: result.$1, accessToken: widget.accessToken, reason: result.$2);
      await _load();
    } on AdminApiException catch (error) { if (mounted) _showError(error.userMessage); }
  }

  Future<void> _deletePoll(AdminPollSummary poll) async {
    final reason = await _reason('Delete poll');
    if (reason == null) return;
    try { await widget.apiClient.deletePoll(pollId: poll.id, accessToken: widget.accessToken, reason: reason); await _load(); }
    on AdminApiException catch (error) { if (mounted) _showError(error.message); }
  }

  Future<void> _loadMoreUsers() async {
    final cursor = _usersCursor;
    if (cursor == null) return;
    final page = await widget.apiClient.listUsers(accessToken: widget.accessToken, query: _query.text, status: _userStatus, role: _userRole, cursor: cursor, createdFrom: _dateRange?.start, createdTo: _dateRange == null ? null : _dateRange!.end.add(const Duration(days: 1)));
    if (mounted) setState(() { _users.addAll(page.items); _usersCursor = page.nextCursor; });
  }

  Future<void> _loadMorePolls() async {
    final cursor = _pollsCursor;
    if (cursor == null) return;
    final page = await widget.apiClient.listPolls(accessToken: widget.accessToken, query: _query.text, status: _pollStatus, cursor: cursor, createdFrom: _dateRange?.start, createdTo: _dateRange == null ? null : _dateRange!.end.add(const Duration(days: 1)));
    if (mounted) setState(() { _polls.addAll(page.items); _pollsCursor = page.nextCursor; });
  }

  Future<void> _loadMoreAudit() async {
    final cursor = _auditCursor;
    if (cursor == null) return;
    final page = await widget.apiClient.listAudit(accessToken: widget.accessToken, cursor: cursor, from: _dateRange?.start, to: _dateRange == null ? null : _dateRange!.end.add(const Duration(days: 1)));
    if (mounted) setState(() { _audit.addAll(page.items); _auditCursor = page.nextCursor; });
  }

  Future<void> _pickDateRange() async {
    final range = await showDateRangePicker(context: context, firstDate: DateTime(2020), lastDate: DateTime.now().add(const Duration(days: 1)), initialDateRange: _dateRange);
    if (range != null && mounted) { setState(() => _dateRange = range); await _load(); }
  }

  Widget _dateFilter() {
    final label = _dateRange == null ? 'Filter by dates' : '${_dateRange!.start.day}.${_dateRange!.start.month} – ${_dateRange!.end.day}.${_dateRange!.end.month}';
    return Row(children: [Expanded(child: OutlinedButton.icon(onPressed: _pickDateRange, icon: const Icon(Icons.date_range), label: Text(label))), if (_dateRange != null) IconButton(tooltip: 'Clear dates', onPressed: () { setState(() => _dateRange = null); _load(); }, icon: const Icon(Icons.clear))]);
  }

  Future<void> _showComments(AdminPollSummary poll) async {
    try {
      final comments = await widget.apiClient.listComments(pollId: poll.id);
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Comments'),
          content: SizedBox(
            width: double.maxFinite,
            child: comments.isEmpty
                ? const Text('No comments.')
                : ListView.builder(
                    shrinkWrap: true,
                    itemCount: comments.length,
                    itemBuilder: (context, index) {
                      final comment = comments[index];
                      return ListTile(
                        title: Text(comment.body),
                        subtitle: Text('@${comment.authorUsername}'),
                        trailing: IconButton(
                          icon: const Icon(Icons.delete_outline),
                          onPressed: () async {
                            final reason = await _reason('Delete comment');
                            if (reason == null || !context.mounted) return;
                            try {
                              await widget.apiClient.deleteComment(commentId: comment.id, accessToken: widget.accessToken, reason: reason);
                              if (context.mounted) Navigator.pop(context);
                              await _load();
                            } on AdminApiException catch (error) {
                              if (mounted) _showError(error.userMessage);
                            }
                          },
                        ),
                      );
                    },
                  ),
          ),
          actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close'))],
        ),
      );
    } on AdminApiException catch (error) {
      if (mounted) _showError(error.userMessage);
    }
  }

  void _showError(String message) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFFF7F8FA),
    appBar: AppBar(title: const Text('Admin'), backgroundColor: Colors.white, elevation: 0, bottom: TabBar(controller: _tabs, tabs: const [Tab(text: 'Users'), Tab(text: 'Polls'), Tab(text: 'Audit')])),
    body: _loading ? const Center(child: CircularProgressIndicator()) : _error != null ? _ErrorState(message: _error!, onRetry: _load) : TabBarView(controller: _tabs, children: [_usersView(), _pollsView(), _auditView()]),
  );

  Widget _usersView() {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _dateFilter(),
          const SizedBox(height: 8),
          TextField(
            controller: _query,
            onSubmitted: (_) => _load(),
            decoration: InputDecoration(
              hintText: 'Search users',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: IconButton(onPressed: _load, icon: const Icon(Icons.refresh)),
              border: const OutlineInputBorder(),
            ),
          ),
          Row(children: [
            Expanded(child: DropdownButtonFormField<String>(value: _userStatus, decoration: const InputDecoration(labelText: 'Status'), items: const [DropdownMenuItem(value: 'all', child: Text('All')), DropdownMenuItem(value: 'active', child: Text('Active')), DropdownMenuItem(value: 'blocked', child: Text('Blocked')), DropdownMenuItem(value: 'deleted', child: Text('Deleted'))], onChanged: (value) { if (value != null) { setState(() => _userStatus = value); _load(); } })),
            const SizedBox(width: 8),
            Expanded(child: DropdownButtonFormField<String>(value: _userRole, decoration: const InputDecoration(labelText: 'Role'), items: const [DropdownMenuItem(value: 'all', child: Text('All')), DropdownMenuItem(value: 'user', child: Text('User')), DropdownMenuItem(value: 'moderator', child: Text('Moderator')), DropdownMenuItem(value: 'superadmin', child: Text('Superadmin'))], onChanged: (value) { if (value != null) { setState(() => _userRole = value); _load(); } })),
          ]),
          const SizedBox(height: 12),
          ..._users.map((user) => Card(
                child: ListTile(
                  leading: CircleAvatar(child: Text(user.username.substring(0, 1).toUpperCase())),
                  title: Text(user.displayName),
                  subtitle: Text('@${user.username} · ${user.role} · ${user.status}'),
                  trailing: PopupMenuButton<String>(
                    onSelected: (action) => _userAction(user, action),
                    itemBuilder: (_) => [
                      if (user.status == 'blocked' && _capabilities.canUnblockUsers)
                        const PopupMenuItem(value: 'Unblock', child: Text('Unblock'))
                      else if (user.status != 'blocked' && _capabilities.canBlockUsers)
                        const PopupMenuItem(value: 'Block', child: Text('Block')),
                      if (user.status != 'deleted' && _capabilities.canDeleteUsers)
                        const PopupMenuItem(value: 'Delete', child: Text('Delete')),
                      if (user.status != 'deleted' && _capabilities.canChangeRoles)
                        const PopupMenuItem(value: 'Role', child: Text('Change role')),
                    ],
                  ),
                ),
              )),
          if (_usersCursor != null) OutlinedButton(onPressed: _loadMoreUsers, child: const Text('Load more users')),
        ],
      ),
    );
  }

  Widget _pollsView() {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _dateFilter(),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(value: _pollStatus, decoration: const InputDecoration(labelText: 'Status'), items: const [DropdownMenuItem(value: 'all', child: Text('All')), DropdownMenuItem(value: 'active', child: Text('Active')), DropdownMenuItem(value: 'deleted', child: Text('Deleted'))], onChanged: (value) { if (value != null) { setState(() => _pollStatus = value); _load(); } }),
          const SizedBox(height: 12),
          ..._polls
            .map((poll) => Card(
                  child: ListTile(
                    title: Text(poll.question),
                    subtitle: Text('@${poll.authorUsername} · ${poll.status} · ${poll.votesCount} votes'),
                    trailing: IconButton(
                      icon: const Icon(Icons.delete_outline),
                      onPressed: poll.status == 'deleted' || !_capabilities.canDeletePolls ? null : () => _deletePoll(poll),
                    ),
                    onTap: _capabilities.canDeleteComments ? () => _showComments(poll) : null,
                  ),
                ))
            .toList(),
          if (_pollsCursor != null) OutlinedButton(onPressed: _loadMorePolls, child: const Text('Load more polls')),
        ],
      ),
    );
  }

  Widget _auditView() {
    if (!_auditAvailable) {
      return const Center(child: Text('Audit log is available to superadmins only.'));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _dateFilter(),
          const SizedBox(height: 8),
          ..._audit
            .map((entry) => Card(
                  child: ListTile(
                    title: Text(entry.action),
                    subtitle: Text('${entry.targetType} ${entry.targetId}\n${entry.reason}'),
                    isThreeLine: true,
                    trailing: Text(_date(entry.createdAt)),
                  ),
                ))
            .toList(),
          if (_auditCursor != null) OutlinedButton(onPressed: _loadMoreAudit, child: const Text('Load more audit entries')),
        ],
      ),
    );
  }

  String _date(DateTime value) => '${value.day.toString().padLeft(2, '0')}.${value.month.toString().padLeft(2, '0')}';
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Center(child: Column(mainAxisSize: MainAxisSize.min, children: [Text(message), const SizedBox(height: 12), FilledButton(onPressed: onRetry, child: const Text('Retry'))]));
}
