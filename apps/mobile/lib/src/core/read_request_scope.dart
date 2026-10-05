import 'dart:async';

import 'package:http/http.dart' as http;

/// Gives each read a finite lifetime and drops a transport completion after the
/// caller has timed out or the owning API client has closed.
class ReadRequestScope {
  ReadRequestScope({this.timeout = const Duration(seconds: 10)});

  final Duration timeout;
  final Set<void Function()> _cancelPending = {};
  bool _closed = false;

  Future<http.Response> get(
    http.Client client,
    Uri uri, {
    Map<String, String>? headers,
  }) {
    return _run<http.Response>((abortTrigger) async {
      final request = http.AbortableRequest(
        'GET',
        uri,
        abortTrigger: abortTrigger,
      )..headers.addAll(headers ?? const {});
      return http.Response.fromStream(await client.send(request));
    });
  }

  Future<T> _run<T>(Future<T> Function(Future<void> abortTrigger) request) {
    if (_closed) return Future<T>.error(StateError('Read scope is closed.'));

    final result = Completer<T>();
    final abort = Completer<void>();
    late final Timer deadline;
    late final void Function() cancel;
    void finish({T? value, Object? error, StackTrace? stack}) {
      if (result.isCompleted) return;
      deadline.cancel();
      _cancelPending.remove(cancel);
      if (error != null) {
        result.completeError(error, stack ?? StackTrace.current);
      } else {
        result.complete(value as T);
      }
    }

    cancel = () {
      if (!abort.isCompleted) abort.complete();
      finish(error: StateError('Read scope is closed.'));
    };
    _cancelPending.add(cancel);
    deadline = Timer(
      timeout,
      () {
        if (!abort.isCompleted) abort.complete();
        finish(
            error: TimeoutException(
          'Read request exceeded ${timeout.inSeconds} seconds.',
          timeout,
        ));
      },
    );
    Future<T>.sync(() => request(abort.future)).then<void>(
      (value) => finish(value: value),
      onError: (Object error, StackTrace stack) =>
          finish(error: error, stack: stack),
    );
    return result.future;
  }

  void close() {
    if (_closed) return;
    _closed = true;
    for (final cancel in _cancelPending.toList()) {
      cancel();
    }
  }
}
