"""Exercise the actual Route controller with Android's JSON parser on the JVM."""
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

from test_control_java import java_tools

ROOT = Path(__file__).resolve().parents[1]


class GameRoutesJavaTests(unittest.TestCase):
    def test_controller(self):
        sdk = Path(os.environ.get('ANDROID_HOME', str(Path(os.environ['LOCALAPPDATA']) / 'Android/Sdk')))
        candidates = sorted((sdk / 'sources').glob('android-*/org/json'), reverse=True)
        if not candidates:
            self.skipTest('Android SDK JSON sources unavailable')
        compiler, runtime = java_tools()
        with tempfile.TemporaryDirectory(prefix='pgrazor-game-routes-') as directory:
            work = Path(directory)
            sources = []
            for original in candidates[0].glob('*.java'):
                text = original.read_text(encoding='utf-8')
                text = re.sub(r'^import (?:static )?(?:android\.|libcore\.).*;\s*$', '', text, flags=re.M)
                text = re.sub(r'@(?:UnsupportedAppUsage|SystemApi|NonNull|Nullable)(?:\([^)]*\))?\s*', '', text)
                target = work / original.name
                target.write_text(text, encoding='utf-8')
                sources.append(target)
            sources += [ROOT / 'src/dev/pgrazor/MotionEngine.java',
                        ROOT / 'src/dev/pgrazor/GameRoutesController.java',
                        ROOT / 'test/GameRoutesTest.java', ROOT / 'test/GameRoutesBridgeTest.java']
            result = subprocess.run([str(compiler), '-encoding', 'UTF-8', '-d', str(work), *map(str, sources)],
                                    capture_output=True, text=True, timeout=45)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            result = subprocess.run([str(runtime), '-cp', str(work), 'dev.pgrazor.GameRoutesBridgeTest'],
                                    capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            test = (ROOT / 'test/GameRoutesTest.java').read_text(encoding='utf-8')
            package = re.search(r'^package\s+([\w.]+);', test, re.M)
            main = (package.group(1) + '.' if package else '') + 'GameRoutesTest'
            result = subprocess.run([str(runtime), '-cp', str(work), main], capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
