import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


@unittest.skipUnless(shutil.which('docker'), 'Docker Compose CLI required')
class ComposeIsolationTests(unittest.TestCase):
    def test_rendered_test_stack_has_no_public_ports_or_production_volumes(self):
        repo = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ['infra/docker/docker-compose.staging.yml', 'infra/release/compose.test.yml']:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(repo / name, target)
            env = root / 'services/api/.env.staging'
            env.parent.mkdir(parents=True)
            env.write_text((repo / 'services/api/.env.staging.example').read_text())
            result = subprocess.run(['docker', 'compose', '-f', str(root / 'infra/docker/docker-compose.staging.yml'),
                '-f', str(root / 'infra/release/compose.test.yml'), 'config', '--format', 'json'],
                capture_output=True, text=True, check=True)
            config = json.loads(result.stdout)
            self.assertEqual(config['name'], 'yaskapp-test')
            self.assertFalse(config['services']['https'].get('ports'))
            self.assertTrue(all(v['name'].startswith('yaskapp-test_') for v in config['volumes'].values()))
            self.assertEqual(config['services']['api']['deploy']['replicas'], 1)
            source = config['services']['https']['volumes'][0]['source'].replace('\\', '/')
            self.assertTrue(source.endswith('/infra/release/Caddyfile.test'))
            self.assertEqual(config['networks']['test-ingress']['name'], 'yaskapp-test-ingress')


if __name__ == '__main__': unittest.main()
