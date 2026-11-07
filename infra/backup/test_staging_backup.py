import importlib.util
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


class BackupTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name('staging_backup.py')
        self.assertTrue(path.exists(), 'Backup coordinator has not been implemented')
        spec = importlib.util.spec_from_file_location('staging_backup', path)
        self.mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mod)
        if os.name == 'nt':
            # NTFS cannot enforce the POSIX guard; the same suite runs unmocked on Linux.
            permissions = patch.object(self.mod, 'private_file')
            permissions.start()
            self.addCleanup(permissions.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.cfg = SimpleNamespace(work=self.root, project_name='test-project')

    def test_rejects_overlapping_repository_and_work_directory(self):
        with self.assertRaises(self.mod.BackupError):
            self.mod.check_paths(self.root, self.root / 'work')

    def test_rejects_repository_at_filesystem_root(self):
        with self.assertRaises(self.mod.BackupError):
            self.mod.check_paths(Path(self.root.anchor), self.root / 'work')

    def test_low_free_space_is_rejected(self):
        with patch.object(self.mod.shutil, 'disk_usage', return_value=SimpleNamespace(free=10)):
            with self.assertRaises(self.mod.BackupError):
                self.mod.require_space(self.root, 11)

    @unittest.skipIf(os.name == 'nt', 'POSIX permission enforcement is verified on Linux')
    def test_rejects_group_readable_password(self):
        secret = self.root / 'password'
        secret.write_text('test-password')
        secret.chmod(0o640)
        with self.assertRaises(self.mod.BackupError):
            self.mod.private_file(secret)

    def test_snapshot_failure_resumes_original_container(self):
        info = {'Config': {'Labels': {'com.docker.compose.project': 'test-project',
                                     'com.docker.compose.service': 'api'}},
                'State': {'Running': False}}
        calls = []
        def command(args, **kwargs):
            calls.append(args)
            if args[:2] == ['docker', 'start']:
                info['State']['Running'] = True
            return ''
        with patch.object(self.mod, 'command', side_effect=command), \
             patch.object(self.mod, 'docker_inspect', return_value=info):
            with self.assertRaisesRegex(RuntimeError, 'snapshot failed'):
                with self.mod.maintenance(self.cfg, ['original-api'], []):
                    raise RuntimeError('snapshot failed')
        self.assertIn(['docker', 'stop', 'original-api'], calls)
        self.assertIn(['docker', 'start', 'original-api'], calls)
        self.assertFalse((self.root / 'maintenance.json').exists())

    def test_resume_does_not_restart_already_running_container(self):
        self.mod.write_json(self.root / 'maintenance.json', {'containers': ['api'], 'timers': []})
        info = {'Config': {'Labels': {'com.docker.compose.project': 'test-project',
                                     'com.docker.compose.service': 'api'}},
                'State': {'Running': True}}
        with patch.object(self.mod, 'command') as run, \
             patch.object(self.mod, 'docker_inspect', return_value=info):
            self.mod.resume(self.cfg)
        run.assert_not_called()

    def test_resume_refuses_container_from_another_project(self):
        self.mod.write_json(self.root / 'maintenance.json', {'containers': ['other'], 'timers': []})
        info = {'Config': {'Labels': {'com.docker.compose.project': 'other-project',
                                     'com.docker.compose.service': 'api'}},
                'State': {'Running': False}}
        with patch.object(self.mod, 'command') as run, \
             patch.object(self.mod, 'docker_inspect', return_value=info):
            with self.assertRaises(self.mod.BackupError):
                self.mod.resume(self.cfg)
        run.assert_not_called()
        self.assertTrue((self.root / 'maintenance.json').exists())

    def test_resume_settles_interrupted_stop_before_start(self):
        self.mod.write_json(self.root / 'maintenance.json', {'containers': ['api'], 'timers': [], 'stopping': ['api']})
        info = {'Config': {'Labels': {'com.docker.compose.project': 'test-project',
                                     'com.docker.compose.service': 'api'}},
                'State': {'Running': True}}
        calls = []
        def command(args, **kwargs):
            calls.append(args)
            if args[:2] == ['docker', 'stop']:
                info['State']['Running'] = False
            elif args[:2] == ['docker', 'start']:
                info['State']['Running'] = True
            return ''
        with patch.object(self.mod, 'command', side_effect=command), \
             patch.object(self.mod, 'docker_inspect', return_value=info):
            self.mod.resume(self.cfg)
        self.assertEqual(calls, [['docker', 'stop', 'api'], ['docker', 'start', 'api']])
        self.assertFalse((self.root / 'maintenance.json').exists())

    def test_restore_admission_uses_expanded_db_on_docker_volume(self):
        pg = self.root / 'pg-volume'
        media = self.root / 'media-volume'
        pg.mkdir()
        media.mkdir()
        self.cfg.reserve = 100
        context = {'database_bytes': 2000, 'media_bytes': 100, 'minio_image_bytes': 20}
        with patch.object(self.mod.shutil, 'disk_usage', return_value=SimpleNamespace(free=5000)):
            with self.assertRaises(self.mod.BackupError):
                self.mod.require_restore_space(self.cfg, context, pg, media)

    def test_minio_image_default_is_allowed_when_key_file_is_absent(self):
        with patch.object(self.mod, 'command', return_value='absent\n') as run:
            self.mod.validate_minio_kms('minio', {'MINIO_KMS_SECRET_KEY_FILE': 'kms_master_key'})
        run.assert_called_once()

    def test_minio_default_file_with_a_key_is_rejected(self):
        with patch.object(self.mod, 'command', return_value='present\n'):
            with self.assertRaises(self.mod.BackupError):
                self.mod.validate_minio_kms('minio', {'MINIO_KMS_SECRET_KEY_FILE': 'kms_master_key'})

    def test_minio_explicit_kms_config_is_rejected_without_reading_key(self):
        for env in ({'MINIO_KMS_SECRET_KEY_FILE': '/run/secrets/custom-key'},
                    {'MINIO_KMS_KES_ENDPOINT': 'https://kes.example.invalid'}):
            with self.subTest(keys=list(env)), patch.object(self.mod, 'command') as run:
                with self.assertRaises(self.mod.BackupError):
                    self.mod.validate_minio_kms('minio', env)
                run.assert_not_called()

    def test_cleanup_refuses_unlabelled_volume(self):
        with patch.object(self.mod, 'docker_inspect', return_value={'Labels': {}}), \
             patch.object(self.mod, 'command') as run:
            with self.assertRaises(self.mod.BackupError):
                self.mod.remove_resource('volume', 'yaskapp-restore-test-media', 'test')
        run.assert_not_called()

    def test_cleanup_removes_only_own_labelled_volume(self):
        with patch.object(self.mod, 'docker_inspect', return_value={'Labels': {'io.yaskapp.backup-drill': 'test'}}), \
             patch.object(self.mod, 'command') as run:
            self.mod.remove_resource('volume', 'yaskapp-restore-test-media', 'test')
        run.assert_called_once_with(['docker', 'volume', 'rm', 'yaskapp-restore-test-media'])


if __name__ == '__main__':
    unittest.main()
