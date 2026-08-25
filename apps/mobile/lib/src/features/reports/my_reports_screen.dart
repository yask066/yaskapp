import 'package:flutter/material.dart';

import 'reports_api_client.dart';

class MyReportsScreen extends StatefulWidget {
  const MyReportsScreen({
    required this.accessToken,
    this.reportsApiClient,
    super.key,
  });

  final String accessToken;
  final ReportsApiClient? reportsApiClient;

  @override
  State<MyReportsScreen> createState() => _MyReportsScreenState();
}

class _MyReportsScreenState extends State<MyReportsScreen> {
  late final ReportsApiClient _reportsApiClient;
  late final bool _ownsReportsApiClient;
  final _reports = <ReportSummary>[];
  String? _nextCursor;
  Object? _error;
  var _isLoading = false;

  @override
  void initState() {
    super.initState();
    _ownsReportsApiClient = widget.reportsApiClient == null;
    _reportsApiClient = widget.reportsApiClient ?? ReportsApiClient();
    _loadReports();
  }

  @override
  void dispose() {
    if (_ownsReportsApiClient) _reportsApiClient.close();
    super.dispose();
  }

  Future<void> _loadReports({bool append = false}) async {
    if (_isLoading || (append && _nextCursor == null)) return;
    setState(() {
      _isLoading = true;
      if (!append) _error = null;
    });
    try {
      final page = await _reportsApiClient.listMine(
        accessToken: widget.accessToken,
        cursor: append ? _nextCursor : null,
      );
      if (!mounted) return;
      setState(() {
        if (!append) _reports.clear();
        _reports.addAll(page.items);
        _nextCursor = page.nextCursor;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My reports')),
      body: RefreshIndicator(
        onRefresh: () => _loadReports(),
        child: _error != null && _reports.isEmpty
            ? ListView(
                children: [
                  const SizedBox(height: 160),
                  Center(child: Text('Could not load your reports.')),
                  Center(
                    child: TextButton(
                      onPressed: _isLoading ? null : () => _loadReports(),
                      child: const Text('Retry'),
                    ),
                  ),
                ],
              )
            : ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: _reports.length + (_nextCursor == null ? 0 : 1),
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (context, index) {
                  if (index == _reports.length) {
                    return Center(
                      child: TextButton(
                        onPressed: _isLoading ? null : () => _loadReports(append: true),
                        child: _isLoading
                            ? const CircularProgressIndicator()
                            : const Text('Load more'),
                      ),
                    );
                  }
                  final report = _reports[index];
                  return Card(
                    child: ListTile(
                      leading: const Icon(Icons.flag_outlined),
                      title: Text('${report.targetType} · ${report.category}'),
                      subtitle: Text(
                        report.description,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      trailing: Text(report.status),
                    ),
                  );
                },
              ),
      ),
    );
  }
}
