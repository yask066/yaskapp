class PollOptionSummary {
  const PollOptionSummary({required this.text, required this.votesCount});

  final String text;
  final int votesCount;
}

class PollSummary {
  const PollSummary({
    required this.authorName,
    required this.authorUsername,
    required this.question,
    required this.options,
    required this.commentsCount,
    required this.likesCount,
    required this.createdLabel,
    this.votedOptionIndex,
  });

  final String authorName;
  final String authorUsername;
  final String question;
  final List<PollOptionSummary> options;
  final int commentsCount;
  final int likesCount;
  final String createdLabel;
  final int? votedOptionIndex;

  int get votesCount {
    return options.fold(0, (sum, option) => sum + option.votesCount);
  }
}
