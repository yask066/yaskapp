import 'package:flutter/material.dart';

import '../polls/poll_card.dart';
import '../polls/poll_summary.dart';

class FeedScreen extends StatelessWidget {
  const FeedScreen({super.key});

  static const _polls = [
    PollSummary(
      authorName: 'Anna Petrova',
      authorUsername: 'anna',
      question: 'Which feature should land first in the MVP?',
      createdLabel: '12 min',
      votedOptionIndex: 1,
      commentsCount: 18,
      likesCount: 42,
      options: [
        PollOptionSummary(text: 'Poll feed', votesCount: 128),
        PollOptionSummary(text: 'Live vote updates', votesCount: 219),
        PollOptionSummary(text: 'User profiles', votesCount: 74),
      ],
    ),
    PollSummary(
      authorName: 'Max Orlov',
      authorUsername: 'maxbuilds',
      question: 'Best poll format for quick daily questions?',
      createdLabel: '38 min',
      commentsCount: 9,
      likesCount: 26,
      options: [
        PollOptionSummary(text: 'Two clear options', votesCount: 91),
        PollOptionSummary(text: 'Three to five options', votesCount: 147),
        PollOptionSummary(text: 'Open comments plus voting', votesCount: 53),
      ],
    ),
    PollSummary(
      authorName: 'Yaskapp Team',
      authorUsername: 'yaskapp',
      question: 'What should the home feed optimize for?',
      createdLabel: '1 h',
      votedOptionIndex: 0,
      commentsCount: 31,
      likesCount: 87,
      options: [
        PollOptionSummary(text: 'Fresh public polls', votesCount: 303),
        PollOptionSummary(text: 'People I follow', votesCount: 189),
        PollOptionSummary(text: 'Trending debates', votesCount: 222),
      ],
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: CustomScrollView(
          slivers: [
            SliverAppBar(
              pinned: true,
              title: const Text('Yaskapp'),
              centerTitle: false,
              actions: [
                IconButton(
                  tooltip: 'Search',
                  onPressed: () {},
                  icon: const Icon(Icons.search),
                ),
                IconButton(
                  tooltip: 'Notifications',
                  onPressed: () {},
                  icon: const Icon(Icons.notifications_none),
                ),
              ],
            ),
            const SliverToBoxAdapter(child: _HomeHeader()),
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
              sliver: SliverList.separated(
                itemBuilder: (context, index) {
                  return PollCard(poll: _polls[index]);
                },
                separatorBuilder: (context, index) =>
                    const SizedBox(height: 12),
                itemCount: _polls.length,
              ),
            ),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () {},
        icon: const Icon(Icons.add_chart),
        label: const Text('Create'),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: 0,
        onDestinationSelected: (_) {},
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: 'Home',
          ),
          NavigationDestination(
            icon: Icon(Icons.explore_outlined),
            selectedIcon: Icon(Icons.explore),
            label: 'Explore',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: 'Profile',
          ),
        ],
      ),
    );
  }
}

class _HomeHeader extends StatelessWidget {
  const _HomeHeader();

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Home',
            style: Theme.of(
              context,
            ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 4),
          Text(
            'Vote on fresh questions and watch the results move.',
            style: Theme.of(
              context,
            ).textTheme.bodyMedium?.copyWith(color: colors.onSurfaceVariant),
          ),
          const SizedBox(height: 16),
          const _CreatePrompt(),
          const SizedBox(height: 12),
          const _FeedFilters(),
        ],
      ),
    );
  }
}

class _CreatePrompt extends StatelessWidget {
  const _CreatePrompt();

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    return Container(
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: colors.outlineVariant),
      ),
      padding: const EdgeInsets.all(12),
      child: Row(
        children: [
          CircleAvatar(
            radius: 18,
            backgroundColor: colors.primary,
            child: Icon(Icons.person, color: colors.onPrimary, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              'Ask the crowd something...',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: colors.onSurfaceVariant),
            ),
          ),
          const SizedBox(width: 8),
          FilledButton.icon(
            onPressed: () {},
            icon: const Icon(Icons.add, size: 18),
            label: const Text('Poll'),
          ),
        ],
      ),
    );
  }
}

class _FeedFilters extends StatelessWidget {
  const _FeedFilters();

  @override
  Widget build(BuildContext context) {
    return const SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          _FilterChip(label: 'For you', selected: true),
          SizedBox(width: 8),
          _FilterChip(label: 'Following'),
          SizedBox(width: 8),
          _FilterChip(label: 'Trending'),
          SizedBox(width: 8),
          _FilterChip(label: 'Ending soon'),
        ],
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({required this.label, this.selected = false});

  final String label;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    return ChoiceChip(
      label: Text(label),
      selected: selected,
      onSelected: (_) {},
    );
  }
}
