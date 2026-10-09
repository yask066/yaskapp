# Yaskapp mobile client

## Motion rollout

Reactions and entry motion are independent build-time flags. Both default to
off. For a local run with reactions enabled and entry motion disabled:

```bash
flutter run \
  --dart-define=YASKAPP_REACTIONS_MOTION=true \
  --dart-define=YASKAPP_ENTRY_MOTION=false
```

Use the same defines when producing a release build, for example:

```bash
flutter build appbundle --release \
  --dart-define=YASKAPP_REACTIONS_MOTION=true \
  --dart-define=YASKAPP_ENTRY_MOTION=false
```

Enable reactions on a verified build first, then entry motion after its smoke
checks. To roll back, build and distribute a new APK/app bundle with the
affected flag set to `false` or omitted. These values are compiled into the
application; there is no remote kill switch.

## Local development

Run `flutter pub get`, then `flutter run` from this directory. See the
[Flutter documentation](https://docs.flutter.dev/) for SDK setup.
