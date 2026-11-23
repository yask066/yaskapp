from concurrent.futures import ThreadPoolExecutor, TimeoutError
import io
import json
import os
from pathlib import Path
import tempfile
from threading import Barrier, Event
import unittest
from unittest.mock import patch

import deploy
import submit
from test_deploy import Host
from test_release import fixture


@unittest.skipUnless(os.name == 'posix', 'Requires Linux filesystem rename semantics')
class AtomicSaveTests(unittest.TestCase):
    def test_concurrent_writes_use_separate_temporary_files(self):
        both_writes = Barrier(2)
        replace = os.replace
        sources = []

        def synchronized_replace(source, target):
            sources.append(source)
            both_writes.wait(timeout=5)
            replace(source, target)

        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'request.json'
            with patch.object(deploy.os, 'replace', synchronized_replace):
                with ThreadPoolExecutor(max_workers=2) as pool:
                    writes = [pool.submit(deploy.save, target, data) for data in ({'value': 1}, {'value': 2})]
                    for write in writes:
                        write.result(timeout=10)
            self.assertEqual(len(set(sources)), 2)
            self.assertIn(deploy.read(target), ({'value': 1}, {'value': 2}))
            self.assertEqual(list(target.parent.iterdir()), [target])


@unittest.skipUnless(os.name == 'posix', 'Requires Linux advisory file locking')
class SubmitTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        self.state = root / 'staging'
        (self.state / 'incoming').mkdir(parents=True)
        (self.state / 'requests').mkdir()
        self.manifest = fixture()
        self.sha = self.manifest['source_sha']
        self.incoming = self.state / 'incoming' / (self.sha + '.json')
        self.incoming.write_text(json.dumps(self.manifest))
        self.target = self.state / 'requests' / self.incoming.name
        for replacement in (
            patch.object(submit, 'Path', return_value=root),
            patch.object(submit.os, 'geteuid', return_value=0),
            patch.object(submit.os, 'umask'),
            patch.object(submit.sys, 'argv', ['submit.py', 'staging', self.sha]),
        ):
            replacement.start()
            self.addCleanup(replacement.stop)

    def test_overlapping_submissions_apply_the_release_once(self):
        first_unit_started = Event()
        second_request_started = Event()
        allow_deploy = Event()
        host = Host()
        units = []

        def run_unit(args, *, check):
            units.append(next(arg for arg in args if arg.startswith('--unit=')))
            self.assertEqual(len(units), len(set(units)), 'systemd unit names collided')
            first_unit_started.set()
            self.assertTrue(allow_deploy.wait(timeout=5))
            deploy.perform(host, self.state, deploy.read(self.target))

        def resubmit():
            second_request_started.set()
            submit.main()

        with patch.object(submit.subprocess, 'run', run_unit):
            with ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(submit.main)
                try:
                    self.assertTrue(first_unit_started.wait(timeout=5))
                    second = pool.submit(resubmit)
                    self.assertTrue(second_request_started.wait(timeout=5))
                finally:
                    allow_deploy.set()
                first.result(timeout=10)
                second.result(timeout=10)
        self.assertEqual(deploy.read(self.state / 'current.json'), self.manifest)
        self.assertEqual(host.events, ['pull', 'backup', 'stop', 'migrate', 'start', 'check'])

    def test_overlapping_conflict_cannot_replace_the_first_manifest(self):
        writing_first = Event()
        allow_publish = Event()
        save = deploy.save

        def delayed_save(path, manifest):
            if manifest == self.manifest:
                writing_first.set()
                self.assertTrue(allow_publish.wait(timeout=5))
            save(path, manifest)

        with patch.object(submit.subprocess, 'run') as run_unit, patch.object(submit, 'save', delayed_save):
            with ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(submit.main)
                try:
                    self.assertTrue(writing_first.wait(timeout=5))
                    self.incoming.write_text(json.dumps({**self.manifest, 'sequence': 100}))
                    second = pool.submit(submit.main)
                    with self.assertRaises(TimeoutError):
                        second.result(timeout=0.2)
                finally:
                    allow_publish.set()
                first.result(timeout=10)
                with self.assertRaisesRegex(ValueError, 'immutable request'):
                    second.result(timeout=10)
        self.assertEqual(deploy.read(self.target), self.manifest)
        run_unit.assert_called_once()

    def test_accepts_streamed_manifest_without_an_incoming_file(self):
        self.incoming.unlink()
        stream = io.StringIO(json.dumps(self.manifest))
        args = ['submit.py', 'staging', self.sha, '--stdin']
        with patch.multiple(submit.sys, argv=args, stdin=stream):
            with patch.object(submit.subprocess, 'run') as run_unit:
                submit.main()
        self.assertEqual(deploy.read(self.target), self.manifest)
        run_unit.assert_called_once()
