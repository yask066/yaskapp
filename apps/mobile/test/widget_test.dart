import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/app.dart';

void main() {
  testWidgets('shows app title', (tester) async {
    await tester.pumpWidget(const YaskappApp());

    expect(find.text('Yaskapp'), findsOneWidget);
  });
}
