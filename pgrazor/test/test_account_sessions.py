from pathlib import Path
import subprocess
import tempfile
import unittest
from test_control_java import java_tools
ROOT=Path(__file__).resolve().parents[1]
class AccountSessionTests(unittest.TestCase):
    def test_inactive_profile_deletion(self):
        compiler,runtime=java_tools()
        with tempfile.TemporaryDirectory(prefix='pgrazor-profile-delete-') as folder:
            work=Path(folder)
            sources=[ROOT/'src/dev/pgrazor/AccountProfileStore.java',ROOT/'src/dev/pgrazor/AccountProfileData.java',ROOT/'test/AccountProfileDataTest.java']
            result=subprocess.run([str(compiler),'-encoding','UTF-8','-d',str(work/'classes'),*map(str,sources)],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            result=subprocess.run([str(runtime),'-cp',str(work/'classes'),'dev.pgrazor.AccountProfileDataTest',str(work/'data')],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            self.assertIn('PASS:',result.stdout)
    def test_roundtrip_and_recovery(self):
        compiler,runtime=java_tools()
        with tempfile.TemporaryDirectory(prefix='pgrazor-session-test-') as folder:
            work=Path(folder)
            sources=[ROOT/'src/dev/pgrazor/AccountProfileStore.java',ROOT/'src/dev/pgrazor/AccountSessionTransaction.java',ROOT/'test/AccountSessionTransactionTest.java']
            result=subprocess.run([str(compiler),'-encoding','UTF-8','-d',str(work/'classes'),*map(str,sources)],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            result=subprocess.run([str(runtime),'-cp',str(work/'classes'),'dev.pgrazor.AccountSessionTransactionTest',str(work/'data')],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            self.assertIn('PASS:',result.stdout)
