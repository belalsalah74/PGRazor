"""Binary-manifest tests for the appended, unexported AccountRestartActivity.

Reuses the string-pool/XML fixtures in test_axml.py so the restart helper's manifest editing is
exercised with the same synthetic binary manifests as the rest of the axml surface.
"""
import importlib.util
from pathlib import Path
import struct
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pgrazor_axml', ROOT / 'axml.py')
axml = importlib.util.module_from_spec(spec)
spec.loader.exec_module(axml)

test_spec = importlib.util.spec_from_file_location('pgrazor_test_axml', Path(__file__).resolve().parent / 'test_axml.py')
test_axml = importlib.util.module_from_spec(test_spec)
test_spec.loader.exec_module(test_axml)
fixture = test_axml.fixture
chunk = test_axml.chunk
node = test_axml.node


def fixture_with_restart_activity(exported=False, process=axml.RESTART_PROCESS, intent_filter=False):
    """A fixture carrying a preexisting AccountRestartActivity with the given shape, for conflict tests."""
    original = fixture()
    expanded = axml.patch_manifest(original)
    _, chunks, pool, _, _ = axml._parse(expanded)
    ns = pool.add(axml.ANDROID_NS)
    activity = pool.add('activity')
    name = pool.add(axml.RESTART_ACTIVITY)
    attributes = struct.pack('<IIIHBBI', ns, pool.strings.index('name'), name, 8, 0, 3, name)
    count = 1
    if exported is not None:
        attributes += struct.pack('<IIIHBBI', ns, pool.strings.index('exported'), 0xffffffff, 8, 0, 0x12,
                                   0xffffffff if exported else 0)
        count += 1
    if process is not None:
        value = pool.add(process)
        attributes += struct.pack('<IIIHBBI', ns, pool.add('process'), value, 8, 0, 3, value)
        count += 1
    extra = node(0x102, struct.pack('<IIHHHHHH', 0xffffffff, activity, 20, 20, count, 0, 0, 0) + attributes)
    if intent_filter:
        tag = pool.add('intent-filter')
        extra += node(0x102, struct.pack('<IIHHHHHH', 0xffffffff, tag, 20, 20, 0, 0, 0, 0))
        extra += node(0x103, struct.pack('<II', 0xffffffff, tag))
    extra += node(0x103, struct.pack('<II', 0xffffffff, activity))
    _, old_chunks, _, _, _ = axml._parse(original)
    original_nodes = [raw for kind, raw in old_chunks if 0x100 <= kind < 0x180]
    resource_chunk = next(raw for kind, raw in chunks if kind == 0x180)
    return chunk(3, pool.build() + resource_chunk + b''.join(original_nodes[:2]) + extra + b''.join(original_nodes[2:]))


class AccountRestartManifestTests(unittest.TestCase):
    def test_adds_unexported_private_process_activity(self):
        base = axml.patch_manifest(fixture())
        before = axml.inspect_manifest(base)
        patched = axml.add_account_restart_activity(base)
        after = axml.inspect_manifest(patched)
        # Existing provider and LogActivity survive; the restart activity is appended last, unexported.
        self.assertEqual(after['providers'], before['providers'])
        self.assertEqual(after['activities'][:len(before['activities'])], before['activities'])
        restart = after['activities'][-1]
        self.assertEqual(restart['name'], axml.RESTART_ACTIVITY)
        self.assertIs(restart['exported'], False)
        # The private process and the absence of any intent-filter are confirmed by a walk.
        _, chunks, pool, _, _ = axml._parse(patched)
        process = depth = None
        inside = filtered = False
        for _, event, tag, attrs, level in axml._walk(chunks, pool):
            if event == 'start' and tag == 'activity' and attrs.get((axml.ANDROID_NS, 'name')) == axml.RESTART_ACTIVITY:
                process, depth, inside = attrs.get((axml.ANDROID_NS, 'process')), level, True
            elif event == 'end' and tag == 'activity':
                inside = False
            elif event == 'start' and tag == 'intent-filter' and inside:
                filtered = True
        self.assertEqual(process, axml.RESTART_PROCESS)
        self.assertEqual(depth, 2)
        self.assertFalse(filtered)

    def test_preserves_pool_and_original_nodes(self):
        base = axml.patch_manifest(fixture())
        patched = axml.add_account_restart_activity(base)
        _, old_chunks, old_pool, _, _ = axml._parse(base)
        _, new_chunks, new_pool, _, _ = axml._parse(patched)
        self.assertEqual(new_pool.strings[:old_pool.count], old_pool.strings)
        self.assertEqual(new_pool.offsets[:old_pool.count], old_pool.offsets)
        # Every original XML node is preserved byte-for-byte and in order.
        old_nodes = [raw for kind, raw in old_chunks if 0x100 <= kind < 0x180]
        new_nodes = [raw for kind, raw in new_chunks if 0x100 <= kind < 0x180]
        cursor = 0
        for raw in old_nodes:
            cursor = new_nodes.index(raw, cursor) + 1

    def test_exact_existing_definition_allowed_and_idempotent(self):
        base = axml.patch_manifest(fixture())
        once = axml.add_account_restart_activity(base)
        twice = axml.add_account_restart_activity(once)
        self.assertEqual(once, twice)
        info = axml.inspect_manifest(twice)
        self.assertEqual(sum(1 for a in info['activities'] if a['name'] == axml.RESTART_ACTIVITY), 1)

    def test_conflicting_activity_rejected(self):
        for case in (dict(exported=True), dict(exported=None), dict(process=None),
                     dict(process=':other'), dict(intent_filter=True)):
            with self.subTest(**case), self.assertRaisesRegex(ValueError, 'account restart activity'):
                axml.add_account_restart_activity(fixture_with_restart_activity(**case))

    def test_split_rejected(self):
        with self.assertRaisesRegex(ValueError, 'split'):
            axml.add_account_restart_activity(fixture(split=True))


if __name__ == '__main__':
    unittest.main()
