import 'package:flutter/material.dart';

import 'features/feed/feed_screen.dart';

class YaskappApp extends StatelessWidget {
  const YaskappApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Yaskapp',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF2F6FED)),
        scaffoldBackgroundColor: const Color(0xFFF7F8FA),
        useMaterial3: true,
      ),
      debugShowCheckedModeBanner: false,
      home: const FeedScreen(),
    );
  }
}
