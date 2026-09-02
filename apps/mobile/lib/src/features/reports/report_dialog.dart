import 'package:flutter/material.dart';

import 'reports_api_client.dart';

const reportCategories = <String, String>{
  'spam': 'Spam',
  'harassment': 'Harassment or bullying',
  'hate_or_discrimination': 'Hate speech',
  'violence_or_threat': 'Violence or threats',
  'sexual_content': 'Sexual content',
  'fraud_or_scam': 'Misinformation',
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
      barrierColor: Colors.black54,
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
  const _ReportDialog(
      {required this.accessToken,
      required this.targetType,
      required this.targetId,
      required this.reportsApiClient});
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
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Report submitted.')));
    } on ReportsApiException catch (error) {
      if (mounted) {
        setState(() => _isSubmitting = false);
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.userMessage)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Dialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 500),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(28, 28, 28, 20),
          child: Form(
            key: _formKey,
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                Container(
                    width: 64,
                    height: 64,
                    decoration: BoxDecoration(
                        color: colors.error.withValues(alpha: .10),
                        shape: BoxShape.circle),
                    child: Icon(Icons.flag_outlined,
                        color: colors.error, size: 30)),
                IconButton(
                    tooltip: 'Close',
                    onPressed:
                        _isSubmitting ? null : () => Navigator.pop(context),
                    icon: const Icon(Icons.close, size: 28)),
              ]),
              const SizedBox(height: 24),
              Text('Report content',
                  style: Theme.of(context)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: 12),
              Text(
                  'Help us keep Yask safe by letting us know\nwhat’s wrong with this content.',
                  style: Theme.of(context)
                      .textTheme
                      .bodyLarge
                      ?.copyWith(color: const Color(0xFF5C6980), height: 1.45)),
              const SizedBox(height: 24),
              const Text('Reason',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                initialValue: _category,
                isExpanded: true,
                icon: const Icon(Icons.keyboard_arrow_down),
                decoration: const InputDecoration(hintText: 'Select a reason'),
                items: reportCategories.entries.map((entry) {
                  return DropdownMenuItem(
                    value: entry.key,
                    child: Row(
                      children: [
                        Icon(_iconForCategory(entry.key), size: 20),
                        const SizedBox(width: 14),
                        Text(entry.value),
                      ],
                    ),
                  );
                }).toList(),
                onChanged: _isSubmitting
                    ? null
                    : (value) => setState(() => _category = value),
                validator: (value) => value == null ? 'Select a reason' : null,
              ),
              const SizedBox(height: 22),
              const Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: 'Details',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                    TextSpan(
                      text: ' · Optional',
                      style: TextStyle(color: Color(0xFF8290A6)),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              TextFormField(
                controller: _descriptionController,
                enabled: !_isSubmitting,
                maxLines: 4,
                maxLength: 2000,
                decoration:
                    const InputDecoration(hintText: 'Tell us what is wrong'),
                buildCounter: (context,
                        {required currentLength,
                        required isFocused,
                        maxLength}) =>
                    Align(
                        alignment: Alignment.centerRight,
                        child: Text('$currentLength / ${maxLength ?? 2000}',
                            style: const TextStyle(color: Color(0xFF8290A6)))),
              ),
              const SizedBox(height: 18),
              Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                      color: const Color(0xFFF4F6FB),
                      borderRadius: BorderRadius.circular(18)),
                  child: Row(children: [
                    Icon(Icons.shield_outlined,
                        color: colors.primary, size: 30),
                    const SizedBox(width: 14),
                    const Expanded(
                        child: Text(
                            'Your report is anonymous.\nWe’ll review it as soon as possible.',
                            style: TextStyle(
                                color: Color(0xFF4E5B73), height: 1.4)))
                  ])),
              const SizedBox(height: 20),
              Row(mainAxisAlignment: MainAxisAlignment.end, children: [
                TextButton(
                    onPressed:
                        _isSubmitting ? null : () => Navigator.pop(context),
                    child: const Text('Cancel')),
                const SizedBox(width: 12),
                SizedBox(
                    width: 160,
                    child: FilledButton(
                        onPressed:
                            _isSubmitting || _category == null ? null : _submit,
                        child: _isSubmitting
                            ? const SizedBox.square(
                                dimension: 18,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2))
                            : const Text('Submit'))),
              ]),
            ]),
          ),
        ),
      ),
    );
  }
}

IconData _iconForCategory(String category) {
  switch (category) {
    case 'spam':
      return Icons.mail_outline;
    case 'harassment':
      return Icons.person_outline;
    case 'hate_or_discrimination':
      return Icons.chat_bubble_outline;
    case 'violence_or_threat':
      return Icons.warning_amber_outlined;
    case 'sexual_content':
      return Icons.visibility_off_outlined;
    case 'fraud_or_scam':
      return Icons.info_outline;
    default:
      return Icons.more_horiz;
  }
}
