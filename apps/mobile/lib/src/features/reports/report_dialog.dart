import 'package:flutter/material.dart';

import 'reports_api_client.dart';

const reportCategories = <String, String>{
  'spam': 'Spam',
  'harassment': 'Harassment',
  'hate_or_discrimination': 'Hate or discrimination',
  'sexual_content': 'Sexual content',
  'violence_or_threat': 'Violence or threat',
  'fraud_or_scam': 'Fraud or scam',
  'impersonation': 'Impersonation',
  'other': 'Other',
};

Future<void> showReportDialog({
  required BuildContext context,
  required String accessToken,
  required String targetType,
  required String targetId,
  ReportsApiClient? reportsApiClient,
}) async {
  final client = reportsApiClient ?? ReportsApiClient();
  final ownsClient = reportsApiClient == null;
  try {
    await showDialog<void>(
      context: context,
      builder: (context) => _ReportDialog(
        accessToken: accessToken,
        targetType: targetType,
        targetId: targetId,
        reportsApiClient: client,
      ),
    );
  } finally {
    if (ownsClient) client.close();
  }
}

class _ReportDialog extends StatefulWidget {
  const _ReportDialog({
    required this.accessToken,
    required this.targetType,
    required this.targetId,
    required this.reportsApiClient,
  });

  final String accessToken;
  final String targetType;
  final String targetId;
  final ReportsApiClient reportsApiClient;

  @override
  State<_ReportDialog> createState() => _ReportDialogState();
}

class _ReportDialogState extends State<_ReportDialog> {
  final _formKey = GlobalKey<FormState>();
  final _descriptionController = TextEditingController();
  String? _category;
  var _isSubmitting = false;

  @override
  void dispose() {
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _isSubmitting = true);
    try {
      await widget.reportsApiClient.submitReport(
        accessToken: widget.accessToken,
        targetType: widget.targetType,
        targetId: widget.targetId,
        category: _category!,
        description: _descriptionController.text,
      );
      if (!mounted) return;
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Report submitted.')),
      );
    } on ReportsApiException catch (error) {
      if (mounted) {
        setState(() => _isSubmitting = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error.userMessage)),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Report content'),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButtonFormField<String>(
              value: _category,
              decoration: const InputDecoration(labelText: 'Reason'),
              items: reportCategories.entries
                  .map((entry) => DropdownMenuItem(
                        value: entry.key,
                        child: Text(entry.value),
                      ))
                  .toList(),
              onChanged: _isSubmitting
                  ? null
                  : (value) => setState(() => _category = value),
              validator: (value) => value == null ? 'Select a reason' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _descriptionController,
              enabled: !_isSubmitting,
              maxLines: 4,
              maxLength: 2000,
              decoration: const InputDecoration(
                labelText: 'Details',
                hintText: 'Tell us what is wrong',
              ),
              validator: (value) => value == null || value.trim().isEmpty
                  ? 'Add a short description'
                  : null,
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSubmitting ? null : () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _isSubmitting ? null : _submit,
          child: _isSubmitting
              ? const SizedBox.square(
                  dimension: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Submit'),
        ),
      ],
    );
  }
}
