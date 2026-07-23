import 'package:flutter/material.dart';

import 'poll_summary.dart';
import 'polls_api_client.dart';

class CreatePollScreen extends StatefulWidget {
  const CreatePollScreen({
    required this.accessToken,
    required this.pollsApiClient,
    super.key,
  });

  final String accessToken;
  final PollsApiClient pollsApiClient;

  @override
  State<CreatePollScreen> createState() => _CreatePollScreenState();
}

class _CreatePollScreenState extends State<CreatePollScreen> {
  final _formKey = GlobalKey<FormState>();
  final _questionController = TextEditingController();
  final List<TextEditingController> _optionControllers = [
    TextEditingController(),
    TextEditingController(),
  ];

  var _isSubmitting = false;
  String? _errorMessage;

  @override
  void dispose() {
    _questionController.dispose();

    for (final controller in _optionControllers) {
      controller.dispose();
    }

    super.dispose();
  }

  void _addOption() {
    if (_optionControllers.length >= 5) {
      return;
    }

    setState(() {
      _optionControllers.add(TextEditingController());
    });
  }

  void _removeOption(int index) {
    if (_optionControllers.length <= 2) {
      return;
    }

    setState(() {
      final controller = _optionControllers.removeAt(index);
      controller.dispose();
    });
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    final options = _optionControllers
        .map((controller) => controller.text.trim())
        .where((option) => option.isNotEmpty)
        .toList();

    if (Set<String>.from(options.map((option) => option.toLowerCase()))
            .length !=
        options.length) {
      setState(() {
        _errorMessage = 'Options must be unique.';
      });
      return;
    }

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    try {
      final poll = await widget.pollsApiClient.createPoll(
        question: _questionController.text.trim(),
        options: options,
        accessToken: widget.accessToken,
      );

      if (!mounted) {
        return;
      }

      Navigator.of(context).pop<PollSummary>(poll);
    } on PollsApiException catch (error) {
      setState(() {
        _errorMessage = error.message;
      });
    } catch (_) {
      setState(() {
        _errorMessage = 'Could not create poll.';
      });
    } finally {
      if (mounted) {
        setState(() {
          _isSubmitting = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Create poll'),
      ),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              TextFormField(
                controller: _questionController,
                minLines: 2,
                maxLines: 4,
                maxLength: 280,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                  labelText: 'Question',
                  prefixIcon: Icon(Icons.help_outline),
                  border: OutlineInputBorder(),
                ),
                validator: (value) {
                  if (value == null || value.trim().isEmpty) {
                    return 'Required';
                  }

                  return null;
                },
              ),
              const SizedBox(height: 12),
              Text(
                'Options',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              for (var index = 0; index < _optionControllers.length; index++)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: TextFormField(
                    controller: _optionControllers[index],
                    maxLength: 160,
                    decoration: InputDecoration(
                      labelText: 'Option ${index + 1}',
                      prefixIcon: const Icon(Icons.radio_button_unchecked),
                      suffixIcon: _optionControllers.length > 2
                          ? IconButton(
                              tooltip: 'Remove option',
                              onPressed: () => _removeOption(index),
                              icon: const Icon(Icons.close),
                            )
                          : null,
                      border: const OutlineInputBorder(),
                    ),
                    validator: (value) {
                      if (value == null || value.trim().isEmpty) {
                        return 'Required';
                      }

                      return null;
                    },
                  ),
                ),
              OutlinedButton.icon(
                onPressed: _optionControllers.length >= 5 ? null : _addOption,
                icon: const Icon(Icons.add),
                label: const Text('Add option'),
              ),
              if (_errorMessage != null) ...[
                const SizedBox(height: 12),
                Text(
                  _errorMessage!,
                  style: TextStyle(color: colors.error),
                ),
              ],
              const SizedBox(height: 18),
              FilledButton.icon(
                onPressed: _isSubmitting ? null : _submit,
                icon: _isSubmitting
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.add_chart),
                label: const Text('Publish poll'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
