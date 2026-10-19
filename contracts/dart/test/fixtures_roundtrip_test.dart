import 'dart:convert';

import 'package:honto_contracts/honto_contracts.dart';
import 'package:test/test.dart';

final _dateTime = RegExp(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$');

Object? normalize(Object? v) {
  if (v is String && _dateTime.hasMatch(v)) return DateTime.parse(v).toUtc().toIso8601String();
  if (v is Map) return {for (final e in v.entries) e.key as String: normalize(e.value)};
  if (v is List) return v.map(normalize).toList();
  return v;
}

void main() {
  test('every fixture has a type mapping', () {
    expect(hontoFixtureTypes.keys.toSet(), hontoFixtures.keys.toSet());
  });

  for (final key in hontoFixtures.keys) {
    test('fixture $key round-trips through ${hontoFixtureTypes[key]}', () {
      final type = hontoFixtureTypes[key]!;
      final decoder = hontoModelDecoders[type];
      if (decoder == null) {
        markTestSkipped('$type is server-to-server only (x-dart: false)');
        return;
      }
      final json = jsonDecode(hontoFixtures[key]!) as Map<String, dynamic>;
      final model = decoder(json) as dynamic;
      final back = jsonDecode(jsonEncode(model.toJson()));
      expect(normalize(back), normalize(json));
    });
  }

  test('unknown enum values do not crash older clients', () {
    expect(ErrorCode.fromJson('something_new'), ErrorCode.unrecognized);
    expect(PushEventType.fromJson('photo.new'), PushEventType.photoNew);
  });

  test('PATCH semantics: omit vs explicit null', () {
    expect(const CouplePatch().toJson(), isEmpty);
    expect(const CouplePatch(reunion: Nullable(null)).toJson(), {'reunion': null});
    expect(CouplePatch.fromJson({'reunion': null}).reunion, isNotNull);
    expect(CouplePatch.fromJson({}).reunion, isNull);
  });
}
