import 'package:flutter/material.dart';

import 'notification_preferences_api_client.dart';

class NotificationPreferencesScreen extends StatefulWidget {
  const NotificationPreferencesScreen({
    required this.accessToken,
    super.key,
    this.apiClient,
  });

  final String accessToken;
  final NotificationPreferencesApiClient? apiClient;

  @override
  State<NotificationPreferencesScreen> createState() =>
      _NotificationPreferencesScreenState();
}

class _NotificationPreferencesScreenState
    extends State<NotificationPreferencesScreen> {
  late final NotificationPreferencesApiClient _apiClient;
  late final bool _ownsClient;
  NotificationPreferences? _preferences;
  String? _error;

  @override
  void initState() {
    super.initState();
    _ownsClient = widget.apiClient == null;
    _apiClient = widget.apiClient ?? NotificationPreferencesApiClient();
    _load();
  }

  @override
  void dispose() {
    if (_ownsClient) _apiClient.close();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final preferences = await _apiClient.get(accessToken: widget.accessToken);
      if (mounted) setState(() => _preferences = preferences);
    } on Object catch (error) {
      if (mounted) setState(() => _error = error.toString());
    }
  }

  Future<void> _setPreference(String type, {bool? inApp, bool? push}) async {
    final old = _preferences;
    if (old == null) return;
    try {
      final updated = await _apiClient.update(
        accessToken: widget.accessToken,
        type: type,
        inApp: inApp,
        push: push,
      );
      if (mounted) setState(() => _preferences = updated);
    } on Object catch (error) {
      if (mounted) {
        setState(() => _error = error.toString());
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('Could not save notification settings.')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Notification settings')),
      body: _error != null && _preferences == null
          ? Center(child: Text(_error!))
          : _preferences == null
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                  padding: const EdgeInsets.all(20),
                  children: [
                    const Text(
                      'Choose which activity appears in your notifications.',
                      style: TextStyle(color: Colors.black54),
                    ),
                    const SizedBox(height: 16),
                    _section('Activity', [
                      _setting('poll_vote', 'Votes on your polls',
                          _preferences!.pollVote),
                      _setting('comment', 'Comments on your polls',
                          _preferences!.comment),
                      _setting('comment_reply', 'Replies to your comments',
                          _preferences!.commentReply),
                      _setting('like', 'Likes', _preferences!.like),
                      _setting('follow', 'New followers', _preferences!.follow),
                    ]),
                  ],
                ),
    );
  }

  Widget _section(String title, List<Widget> children) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title,
              style:
                  const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          Card(child: Column(children: children)),
        ],
      );

  Widget _setting(
          String type, String title, NotificationPreference preference) =>
      Column(
        children: [
          SwitchListTile(
            title: Text(title),
            subtitle: const Text('In-app'),
            value: preference.inApp,
            onChanged: (next) => _setPreference(type, inApp: next),
          ),
          SwitchListTile(
            title: const Text('Push'),
            subtitle: const Text('Delivery will be available in Phase 6'),
            value: preference.push,
            onChanged: (next) => _setPreference(type, push: next),
          ),
        ],
      );
}
