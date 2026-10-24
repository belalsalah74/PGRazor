package app.pogo.extension;

import android.app.Application;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Loads the bundled Frida gadget in script mode. Content providers are created before
 * Application.onCreate, so the agent is ready before the game's native code starts.
 * Any failure is logged and swallowed: the app must still start unmodified.
 */
public final class BootstrapProvider extends ContentProvider {
    private static final String TAG = "PogoBootstrap";

    @Override
    public boolean onCreate() {
        Context context = getContext();
        if (context == null) return true;
        try {
            if (Build.VERSION.SDK_INT >= 28
                    && !Application.getProcessName().equals(context.getApplicationInfo().processName)) {
                return true; // only the main process
            }
            if (Build.SUPPORTED_ABIS.length == 0 || !"arm64-v8a".equals(Build.SUPPORTED_ABIS[0])) {
                Log.w(TAG, "unsupported ABI, agent not loaded");
                return true;
            }
            File dir = new File(context.getCodeCacheDir(), "pogo");
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("cannot create " + dir);

            File library = copyAsset(context, "pogo/libfrida-gadget.so", dir, "libfrida-gadget.so");
            File script = copyAsset(context, "pogo/throw-catch-agent.js", dir, "throw-catch-agent.js");

            String config = "{\"interaction\":{\"type\":\"script\",\"path\":" + quote(script.getAbsolutePath())
                    + ",\"on_change\":\"ignore\"},\"runtime\":\"qjs\"}";
            writeAtomically(new File(dir, "libfrida-gadget.config"), config.getBytes(StandardCharsets.UTF_8));

            System.load(library.getAbsolutePath());
            Log.i(TAG, "gadget loaded");
        } catch (Throwable t) {
            Log.e(TAG, "bootstrap failed", t);
        }
        return true;
    }

    private static File copyAsset(Context context, String asset, File dir, String name) throws IOException {
        File out = new File(dir, name);
        try (InputStream in = context.getAssets().open(asset)) {
            writeAtomically(out, in);
        }
        return out;
    }

    private static void writeAtomically(File target, byte[] data) throws IOException {
        File tmp = new File(target.getParentFile(), target.getName() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(data);
            out.getFD().sync();
        }
        if (!tmp.renameTo(target)) throw new IOException("rename failed for " + target);
    }

    private static void writeAtomically(File target, InputStream in) throws IOException {
        File tmp = new File(target.getParentFile(), target.getName() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            byte[] buffer = new byte[64 * 1024];
            for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
            out.getFD().sync();
        }
        if (!tmp.renameTo(target)) throw new IOException("rename failed for " + target);
    }

    private static String quote(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    @Override public Cursor query(Uri uri, String[] p, String s, String[] a, String o) { return null; }
    @Override public String getType(Uri uri) { return null; }
    @Override public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override public int delete(Uri uri, String s, String[] a) { return 0; }
    @Override public int update(Uri uri, ContentValues v, String s, String[] a) { return 0; }
}
