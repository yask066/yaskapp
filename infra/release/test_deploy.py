import copy
import tempfile
import unittest
from pathlib import Path

import deploy
from test_release import fixture


class Host:
    """Only external Docker/backup/HTTP effects are replaced in these tests."""
    def __init__(self, fail=None):
        self.events = []
        self.fail = fail

    def action(self, name, *args):
        self.events.append(name)
        if name == self.fail:
            raise RuntimeError(name)

    def pull(self, manifest): self.action('pull')
    def backup(self): self.action('backup')
    def stop(self): self.action('stop')
    def migrate(self, manifest): self.action('migrate')
    def start(self, manifest): self.action('start')
    def check(self, manifest): self.action('check')


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name)
        self.old = fixture()
        self.old['sequence'] = 41
        self.old['source_sha'] = 'e' * 40
        deploy.save(self.state / 'current.json', self.old)

    def run_deploy(self, host, manifest=None):
        return deploy.perform(host, self.state, manifest or fixture())

    def test_backup_failure_never_stops_or_migrates(self):
        h = Host('backup')
        with self.assertRaises(RuntimeError): self.run_deploy(h)
        self.assertEqual(h.events, ['pull', 'backup'])
        self.assertEqual(deploy.read(self.state / 'current.json'), self.old)

    def test_partial_migration_failure_leaves_writers_stopped(self):
        h = Host('migrate')
        with self.assertRaises(RuntimeError): self.run_deploy(h)
        self.assertEqual(h.events, ['pull', 'backup', 'stop', 'migrate', 'stop'])
        self.assertEqual(deploy.read(self.state / 'attempt.json')['status'], 'maintenance')

    def test_readiness_failure_rolls_back_only_unchanged_schema(self):
        h = Host('check')
        with self.assertRaises(RuntimeError): self.run_deploy(h)
        self.assertEqual(h.events.count('start'), 2)
        self.assertEqual(h.events[-1], 'stop')  # rollback readiness also fails
        self.assertEqual(deploy.read(self.state / 'current.json'), self.old)
        self.assertEqual(deploy.read(self.state / 'attempt.json')['status'], 'maintenance')

    def test_new_migration_prevents_automatic_rollback(self):
        m = fixture()
        m['migrations']['002_new.sql'] = 'f' * 64
        h = Host('check')
        with self.assertRaises(RuntimeError): self.run_deploy(h, m)
        self.assertEqual(h.events.count('start'), 1)
        self.assertEqual(h.events[-1], 'stop')

    def test_success_is_idempotent_and_rejects_older_release(self):
        h = Host()
        self.run_deploy(h)
        self.assertEqual(h.events, ['pull', 'backup', 'stop', 'migrate', 'start', 'check'])
        self.assertEqual(deploy.read(self.state / 'current.json'), fixture())
        self.run_deploy(h)
        self.assertEqual(len(h.events), 6)
        with self.assertRaises(ValueError): self.run_deploy(h, self.old)

    def test_interrupted_deployment_requires_recovery_before_retry(self):
        deploy.save(self.state / 'attempt.json', {'status': 'migrating'})
        h = Host()
        with self.assertRaises(ValueError): self.run_deploy(h)
        self.assertEqual(h.events, [])

    def test_same_sequence_with_other_content_is_rejected(self):
        m = copy.deepcopy(self.old)
        m['source_sha'] = 'f' * 40
        with self.assertRaises(ValueError): self.run_deploy(Host(), m)


if __name__ == '__main__': unittest.main()
