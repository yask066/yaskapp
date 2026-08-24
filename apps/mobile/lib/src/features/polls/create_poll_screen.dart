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
  var _allowVoteCancellation = false;
  var _allowVoteChange = false;
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
        allowVoteCancellation: _allowVoteCancellation,
        allowVoteChange: _allowVoteChange,
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
    const primary = Color(0xFF566A9D);
    const primaryText = Color(0xFF10142D);
    const secondaryText = Color(0xFF667085);

    return Scaffold(
      backgroundColor: const Color(0xFFF7F8FC),
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        elevation: 0,
        toolbarHeight: 64,
        leadingWidth: 72,
        leading: IconButton(
          tooltip: 'Back',
          onPressed: () => Navigator.of(context).pop(),
          padding: const EdgeInsets.only(left: 16),
          constraints: const BoxConstraints.tightFor(width: 40, height: 40),
          icon: const Icon(Icons.arrow_back, size: 24, color: primaryText),
        ),
        titleSpacing: 0,
        title: const Text(
          'Create poll',
          style: TextStyle(
            color: primaryText,
            fontSize: 22,
            fontWeight: FontWeight.w700,
            height: 26 / 22,
          ),
        ),
      ),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 40),
            children: [
              _CreateFieldCard(
                minHeight: 96,
                child: TextFormField(
                  controller: _questionController,
                  minLines: 1,
                  maxLines: 6,
                  maxLength: 280,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: _fieldDecoration(
                    hintText: 'Ask your question...',
                    prefixIcon: const Icon(Icons.help_outline_rounded),
                  ),
                  validator: (value) {
                    if (value == null || value.trim().isEmpty) {
                      return 'Required';
                    }

                    return null;
                  },
                ),
              ),
              _CounterText(
                controller: _questionController,
                max: 280,
                color: secondaryText,
              ),
              SwitchListTile.adaptive(
                contentPadding: EdgeInsets.zero,
                title: const Text('Allow voters to cancel their vote'),
                value: _allowVoteCancellation,
                onChanged: _isSubmitting
                    ? null
                    : (value) => setState(() {
                          _allowVoteCancellation = value;
                        }),
              ),
              SwitchListTile.adaptive(
                contentPadding: EdgeInsets.zero,
                title: const Text('Allow voters to change their vote'),
                value: _allowVoteChange,
                onChanged: _isSubmitting
                    ? null
                    : (value) => setState(() {
                          _allowVoteChange = value;
                        }),
              ),
              const SizedBox(height: 24),
              Text(
                'Options',
                style: const TextStyle(
                  color: primaryText,
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  height: 24 / 20,
                ),
              ),
              const SizedBox(height: 16),
              for (var index = 0; index < _optionControllers.length; index++)
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    _CreateFieldCard(
                      minHeight: 64,
                      child: TextFormField(
                        controller: _optionControllers[index],
                        maxLength: 160,
                        decoration: _fieldDecoration(
                          hintText: 'Option ${index + 1}',
                          prefixIcon: const Icon(
                            Icons.radio_button_unchecked,
                            size: 24,
                          ),
                          suffixIcon: _optionControllers.length > 2
                              ? IconButton(
                                  tooltip: 'Remove option',
                                  onPressed: () => _removeOption(index),
                                  padding: EdgeInsets.zero,
                                  constraints: const BoxConstraints.tightFor(
                                    width: 36,
                                    height: 36,
                                  ),
                                  icon: const Icon(Icons.close, size: 20),
                                )
                              : null,
                        ),
                        validator: (value) {
                          if (value == null || value.trim().isEmpty) {
                            return 'Required';
                          }

                          return null;
                        },
                      ),
                    ),
                    _CounterText(
                      controller: _optionControllers[index],
                      max: 160,
                      color: secondaryText,
                    ),
                    const SizedBox(height: 16),
                  ],
                ),
              SizedBox(
                height: 48,
                child: OutlinedButton.icon(
                  onPressed:
                      _optionControllers.length >= 5 ? null : _addOption,
                  icon: const Icon(Icons.add, size: 20),
                  label: const Text('Add option'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: primary,
                    side: const BorderSide(color: primary),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(24),
                    ),
                    textStyle: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
              if (_errorMessage != null) ...[
                const SizedBox(height: 12),
                Text(
                  _errorMessage!,
                  style: TextStyle(color: colors.error),
                ),
              ],
              const SizedBox(height: 24),
              SizedBox(
                height: 52,
                child: FilledButton.icon(
                  onPressed: _isSubmitting ? null : _submit,
                  icon: _isSubmitting
                      ? const SizedBox.square(
                          dimension: 22,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.post_add_outlined, size: 22),
                  label: const Text('Publish poll'),
                  style: FilledButton.styleFrom(
                    backgroundColor: primary,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(26),
                    ),
                    textStyle: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  InputDecoration _fieldDecoration({
    required String hintText,
    required Widget prefixIcon,
    Widget? suffixIcon,
  }) {
    return InputDecoration(
      hintText: hintText,
      hintStyle: const TextStyle(
        color: Color(0xFF667085),
        fontSize: 16,
        height: 22 / 16,
      ),
      prefixIcon: Padding(
        padding: const EdgeInsets.only(left: 16, right: 16),
        child: IconTheme(
          data: const IconThemeData(
            color: Color(0xFF566A9D),
            size: 24,
          ),
          child: prefixIcon,
        ),
      ),
      prefixIconConstraints: const BoxConstraints(minWidth: 56),
      suffixIcon: suffixIcon,
      suffixIconConstraints: const BoxConstraints.tightFor(width: 36),
      filled: true,
      fillColor: Colors.white,
      counterText: '',
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide.none,
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide.none,
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: Color(0xFF566A9D), width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: Colors.redAccent),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: Colors.redAccent, width: 1.5),
      ),
    );
  }
}

class _CreateFieldCard extends StatelessWidget {
  const _CreateFieldCard({required this.child, required this.minHeight});

  final Widget child;
  final double minHeight;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(minHeight: minHeight),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(
            color: Color(0x14050C3F),
            blurRadius: 12,
            offset: Offset(0, 5),
          ),
        ],
      ),
      child: child,
    );
  }
}

class _CounterText extends StatelessWidget {
  const _CounterText({
    required this.controller,
    required this.max,
    required this.color,
  });

  final TextEditingController controller;
  final int max;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<TextEditingValue>(
      valueListenable: controller,
      builder: (context, value, child) {
        return Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Text(
            '${value.text.length}/$max',
            style: TextStyle(color: color, fontSize: 13),
          ),
        );
      },
    );
  }
}
