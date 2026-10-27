"""Exercise the real AccountProfileStore on a JVM, offline and without Android or a device.

AccountProfileStore is deliberately dependency-free plain Java (java.io/java.nio/java.security only),
so it compiles and runs against the stock JDK with no Android stubs. The driver uses synthetic
identity strings and temp directories; only a SHA-256 of each identity is ever written, so no
credentials, tokens, or captured account data are involved. Temporary compiler outputs are removed
automatically.
"""
from pathlib import Path
import subprocess
import tempfile
import unittest

from test_control_java import java_tools

ROOT = Path(__file__).resolve().parents[1]


class AccountProfileStoreJavaTests(unittest.TestCase):
    def test_store(self):
        compiler, runtime = java_tools()
        with tempfile.TemporaryDirectory(prefix='pgrazor-account-store-') as directory:
            work = Path(directory)
            classes = work / 'classes'
            data = work / 'data'
            data.mkdir()
            sources = [ROOT / 'src/dev/pgrazor/AccountProfileStore.java',
                       ROOT / 'test/AccountProfileStoreTest.java']
            compiled = subprocess.run([str(compiler), '-encoding', 'UTF-8', '-d', str(classes), *map(str, sources)],
                                      capture_output=True, text=True, timeout=60)
            self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
            result = subprocess.run([str(runtime), '-cp', str(classes), 'AccountProfileStoreTest', str(data)],
                                    capture_output=True, text=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('PASS: AccountProfileStore', result.stdout)


if __name__ == '__main__':
    unittest.main()
