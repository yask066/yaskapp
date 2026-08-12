import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/app.dart';
import 'package:yaskapp_mobile/src/features/auth/auth_session_store.dart';

void main() {
  testWidgets('shows auth entry point', (tester) async {
    await tester.pumpWidget(
      YaskappApp(authSessionStore: MemoryAuthSessionStore()),
    );
    await tester.pumpAndSettle();

    expect(find.bySemanticsLabel('Yaskapp'), findsOneWidget);
    expect(find.text('LOGIN'), findsNWidgets(2));
    expect(find.text('Sign Up'), findsOneWidget);

    await tester.tap(find.text('Sign Up'));
    await tester.pumpAndSettle();

    expect(find.text('REGISTER'), findsNWidgets(2));
    expect(find.text('Email'), findsOneWidget);
    expect(find.text('Username'), findsOneWidget);
    expect(find.text('Display name'), findsOneWidget);
    expect(find.text('Password'), findsOneWidget);
    expect(find.text('Back to Login'), findsOneWidget);

    await tester.tap(find.text('Back to Login'));
    await tester.pumpAndSettle();

    expect(find.text('LOGIN'), findsNWidgets(2));
    expect(find.text('Sign Up'), findsOneWidget);
  });
}
