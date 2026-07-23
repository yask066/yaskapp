import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/app.dart';
import 'package:yaskapp_mobile/src/features/auth/auth_session_store.dart';

void main() {
  testWidgets('shows auth entry point', (tester) async {
    await tester.pumpWidget(
      YaskappApp(authSessionStore: MemoryAuthSessionStore()),
    );
    await tester.pumpAndSettle();

    expect(find.text('Yaskapp'), findsOneWidget);
    expect(find.text('Login'), findsWidgets);
    expect(find.text('Register'), findsWidgets);
  });
}
