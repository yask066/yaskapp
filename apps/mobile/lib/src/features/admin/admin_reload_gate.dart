class AdminReloadGate {
  bool _running = false;
  bool _queued = false;

  Future<void> run(Future<void> Function() load) async {
    if (_running) {
      _queued = true;
      return;
    }

    _running = true;
    try {
      do {
        _queued = false;
        await load();
      } while (_queued);
    } finally {
      _running = false;
    }
  }
}
