import copy
import unittest

import release


def fixture():
    return {
        'version': 1, 'source_sha': 'a' * 40, 'source_tree': 'b' * 40,
        'sequence': 42,
        'images': {name: 'ghcr.io/yask066/yaskapp-' + name + '@sha256:' + 'c' * 64
                   for name in ['api', 'web', 'moderation-web']},
        'migrations': {'001_initial.sql': 'd' * 64},
    }


class ManifestTests(unittest.TestCase):
    def test_valid_manifest_promotes_only_same_source_tree(self):
        manifest = fixture()
        release.verify_promotion(manifest, 'a' * 40, 'b' * 40)
        with self.assertRaises(ValueError):
            release.verify_promotion(manifest, 'a' * 40, 'e' * 40)
        with self.assertRaises(ValueError):
            release.verify_promotion(manifest, 'e' * 40, 'b' * 40)

    def test_rejects_mutable_foreign_or_missing_images(self):
        for value in ['ghcr.io/yask066/yaskapp-api:latest',
                      'ghcr.io/attacker/api@sha256:' + 'c' * 64,
                      'ghcr.io/yask066/yaskapp-web@sha256:' + 'c' * 64]:
            m = fixture()
            m['images']['api'] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                release.validate_manifest(m)
        m = fixture()
        del m['images']['web']
        with self.assertRaises(ValueError):
            release.validate_manifest(m)

    def test_rejects_malformed_and_unbounded_fields(self):
        for key, value in [('source_sha', '../../etc'), ('source_tree', 'a'),
                           ('sequence', -1), ('sequence', True),
                           ('migrations', {'../../a.sql': 'd' * 64}),
                           ('migrations', {'001.sql': 'invalid'})]:
            m = copy.deepcopy(fixture())
            m[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                release.validate_manifest(m)


if __name__ == '__main__':
    unittest.main()
