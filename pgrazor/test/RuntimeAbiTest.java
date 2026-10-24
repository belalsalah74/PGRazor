import dev.pgrazor.RuntimeAbi;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;

public class RuntimeAbiTest {
    interface Checked { void run() throws Exception; }
    static void check(boolean value, String detail) { if(!value) throw new AssertionError(detail); }
    static void rejects(String text, Checked action) throws Exception {
        try { action.run(); throw new AssertionError("Expected rejection: "+text); }
        catch(IOException expected) { check(expected.getMessage().contains(text), expected.getMessage()); }
    }
    static byte[] elf(int machine) {
        byte[] bytes=new byte[64];
        bytes[0]=0x7f; bytes[1]='E'; bytes[2]='L'; bytes[3]='F';
        bytes[4]=2; bytes[5]=1; bytes[6]=1;
        bytes[18]=(byte)machine; bytes[19]=(byte)(machine>>8);
        return bytes;
    }
    public static void main(String[] args) throws Exception {
        check(RuntimeAbi.readElfAbi(new ByteArrayInputStream(elf(183))).equals("arm64-v8a"),"ARM64 executable");
        check(RuntimeAbi.readElfAbi(new ByteArrayInputStream(elf(62))).equals("x86_64"),"x86_64 executable");
        InputStream fragmented=new ByteArrayInputStream(elf(62)) {
            public synchronized int read(byte[] b,int off,int len) { return super.read(b,off,Math.min(1,len)); }
        };
        check(RuntimeAbi.readElfAbi(fragmented).equals("x86_64"),"Short reads handled");
        for(int length:new int[]{0,1,19,63}) {
            final int size=length;
            rejects("Truncated",()->RuntimeAbi.readElfAbi(new ByteArrayInputStream(new byte[size])));
        }
        byte[] badMagic=elf(62); badMagic[0]=0;
        rejects("not ELF",()->RuntimeAbi.readElfAbi(new ByteArrayInputStream(badMagic)));
        byte[] elf32=elf(3); elf32[4]=1;
        rejects("64-bit",()->RuntimeAbi.readElfAbi(new ByteArrayInputStream(elf32)));
        byte[] bigEndian=elf(183); bigEndian[5]=2;
        rejects("byte order",()->RuntimeAbi.readElfAbi(new ByteArrayInputStream(bigEndian)));
        byte[] badVersion=elf(62); badVersion[6]=0;
        rejects("version",()->RuntimeAbi.readElfAbi(new ByteArrayInputStream(badVersion)));
        rejects("machine: 243",()->RuntimeAbi.readElfAbi(new ByteArrayInputStream(elf(243))));
        rejects("read denied",()->RuntimeAbi.readElfAbi(new InputStream() {
            public int read() throws IOException { throw new IOException("read denied"); }
        }));
        check(RuntimeAbi.requireMatch("arm64-v8a","arm64-v8a").equals("arm64-v8a"),"Matching phone");
        check(RuntimeAbi.requireMatch("x86_64","x86_64").equals("x86_64"),"Matching emulator");
        check(RuntimeAbi.requireMatch("","x86_64").equals("x86_64"),"Empty preference uses measured ABI");
        rejects("does not match",()->RuntimeAbi.requireMatch("arm64-v8a","x86_64"));
        rejects("does not match",()->RuntimeAbi.requireMatch("x86_64","arm64-v8a"));
        rejects("Unsupported Gadget ABI",()->RuntimeAbi.requireMatch("armeabi-v7a","arm64-v8a"));
        rejects("Unsupported native process ABI",()->RuntimeAbi.requireMatch("arm64-v8a","unknown"));
        String[] bundled={"arm64-v8a","x86_64"};
        check(RuntimeAbi.select("","arm64-v8a",bundled).equals("arm64-v8a"),"Unified APK selects phone runtime");
        check(RuntimeAbi.select("","x86_64",bundled).equals("x86_64"),"Same APK selects emulator runtime");
        rejects("No bundled runtime",()->RuntimeAbi.select("","x86_64",new String[]{"arm64-v8a"}));
        rejects("does not match",()->RuntimeAbi.select("arm64-v8a","x86_64",bundled));
        System.out.println("PASS: native ARM64/x64 ELF, short reads, malformed/unsupported/read-error handling, ABI matches and mismatches");
    }
}
