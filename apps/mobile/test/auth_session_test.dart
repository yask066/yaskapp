import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/features/auth/auth_session.dart';
import 'package:yaskapp_mobile/src/features/auth/country_selector.dart';

void main() {
  test('country catalog has no empty values or duplicates', () {
    expect(countryCatalogIsValid(), isTrue);
    expect(countryCatalogVersion, 1);
  });

  test('parses a legacy profile without country', () {
    final user = AuthUser.fromJson({
      'id': 'user-1',
      'email': 'user@example.com',
      'username': 'user_123',
      'status': 'active',
      'profile': {
        'displayName': 'User',
        'countryCode': null,
        'pollsCount': 0,
        'followersCount': 0,
        'followingCount': 0,
      },
    });

    expect(user.profile.countryCode, isNull);
  });
}
