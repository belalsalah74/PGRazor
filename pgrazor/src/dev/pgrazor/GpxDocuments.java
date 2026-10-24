package dev.pgrazor;

import android.app.Activity;
import android.app.Fragment;
import android.app.FragmentManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

/**
 * Headless {@link Fragment} that drives the Android Storage Access Framework picker and routes its
 * result back to a one-shot callback, without editing the host Activity or the manifest.
 *
 * <p>SAF needs no permissions: {@link Intent#ACTION_OPEN_DOCUMENT} returns a readable content URI
 * for import and {@link Intent#ACTION_CREATE_DOCUMENT} a writable one for export. The picker is a
 * separate Activity, so opening it pauses the host (and any PGRazor dialog bound to it dismisses);
 * this fragment lives on the Activity rather than on a dialog, so it survives that round-trip and
 * still delivers the chosen URI when the host resumes. Reading or writing the stream is the
 * caller's job and belongs off the main thread.</p>
 */
public final class GpxDocuments extends Fragment {
    /** Delivered on the main thread exactly once; a cancelled or failed pick reports {@link #onCancelled()}. */
    public interface Callback {
        void onPicked(Uri uri);
        void onCancelled();
    }

    private static final String TAG = "pgrazor-gpx-documents";
    private static final int REQUEST = 0x6778; // android.app.Fragment allows only the lower 16 bits
    private Intent intent;
    private Callback callback;

    /** Opens the system picker to choose a readable document (import). */
    public static void open(Activity activity, Callback callback) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        launch(activity, intent, callback);
    }

    /** Opens the system picker to create a writable document (export) with a suggested file name. */
    public static void create(Activity activity, String suggestedName, Callback callback) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE).setType("application/gpx+xml")
            .putExtra(Intent.EXTRA_TITLE, suggestedName);
        launch(activity, intent, callback);
    }

    private static void launch(Activity activity, Intent intent, Callback callback) {
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
            if (callback != null) callback.onCancelled();
            return;
        }
        FragmentManager manager = activity.getFragmentManager();
        Fragment stale = manager.findFragmentByTag(TAG);
        if (stale != null) manager.beginTransaction().remove(stale).commitAllowingStateLoss();
        GpxDocuments fragment = new GpxDocuments();
        fragment.intent = intent;
        fragment.callback = callback;
        // commitAllowingStateLoss: the pick is a convenience, not state we must restore if the host is mid-transition.
        try { manager.beginTransaction().add(fragment, TAG).commitAllowingStateLoss(); }
        catch (RuntimeException e) { if (callback != null) callback.onCancelled(); }
    }

    public void onCreate(Bundle state) {
        super.onCreate(state);
        setRetainInstance(true); // keep the live callback across a configuration change while the picker is open
        if (state == null && intent != null) {
            try { startActivityForResult(intent, REQUEST); }
            catch (ActivityNotFoundException e) { deliver(null); }
        } else if (callback == null) {
            // Recreated without a live callback (e.g. after process death); there is nothing left to deliver.
            detach();
        }
    }

    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQUEST) { super.onActivityResult(requestCode, resultCode, data); return; }
        deliver(resultCode == Activity.RESULT_OK && data != null ? data.getData() : null);
    }

    private void deliver(Uri uri) {
        Callback done = callback;
        callback = null;
        if (done != null) { if (uri != null) done.onPicked(uri); else done.onCancelled(); }
        detach();
    }

    private void detach() {
        Activity activity = getActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) return;
        try { activity.getFragmentManager().beginTransaction().remove(this).commitAllowingStateLoss(); }
        catch (RuntimeException ignored) { }
    }
}
