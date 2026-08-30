import 'package:flutter/material.dart';

import '../notifications/notification_preferences_screen.dart';
import '../reports/my_reports_screen.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({
    required this.accessToken,
    required this.onLogout,
    super.key,
  });

  final String accessToken;
  final VoidCallback onLogout;

  void _openNotifications(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => NotificationPreferencesScreen(
          accessToken: accessToken,
        ),
      ),
    );
  }

  void _openReports(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => MyReportsScreen(accessToken: accessToken),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F8FC),
      appBar: AppBar(
        title: const Text('Settings'),
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
      ),
      body: ListView(
        padding: const EdgeInsets.only(top: 12),
        children: [
          _SettingsTile(
            icon: Icons.notifications_none_outlined,
            label: 'Notifications',
            onTap: () => _openNotifications(context),
          ),
          _SettingsTile(
            icon: Icons.flag_outlined,
            label: 'My reports',
            onTap: () => _openReports(context),
          ),
          const Divider(height: 24),
          _SettingsTile(
            icon: Icons.logout,
            label: 'Logout',
            color: Colors.red,
            onTap: onLogout,
          ),
        ],
      ),
    );
  }
}

class _SettingsTile extends StatelessWidget {
  const _SettingsTile({
    required this.icon,
    required this.label,
    required this.onTap,
    this.color = const Color(0xFF10142D),
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 20),
      leading: Icon(icon, color: color),
      title: Text(
        label,
        style: TextStyle(color: color, fontSize: 16),
      ),
      trailing: Icon(Icons.chevron_right, color: color.withOpacity(0.55)),
      onTap: onTap,
    );
  }
}
