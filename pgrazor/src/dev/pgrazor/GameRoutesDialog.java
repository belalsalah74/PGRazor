package dev.pgrazor;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.text.InputFilter;
import android.text.InputType;
import android.view.Gravity;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.os.Handler;
import android.os.Looper;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Modal for automatic in-game Route walking. Mirrors {@link AutoWalkDialog}'s shape: while visible it
 * renews the native discovery stream through {@link Control#setGameRoutesPlanning(boolean)}, shows the
 * nearby Routes and live status from {@link Control#gameRoutesSnapshot()}/{@link Control#gameRoutesStatus()},
 * and starts/stops {@link GameRoutesController} through Control. All native work lives behind Control; the
 * dialog only reads cheap accessors on the UI thread and polls only while shown. Reached from the
 * Auto-walk entry the coordinator wires separately.
 */
public final class GameRoutesDialog {
    private GameRoutesDialog() {}
    private static final int MAX_COMPLETIONS = GameRoutesController.MAX_COMPLETIONS_CAP;
    private static final int DEFAULT_COMPLETIONS = GameRoutesController.DEFAULT_MAX_COMPLETIONS;

    public static AlertDialog show(Activity activity) {
        if (activity.isFinishing() || activity.isDestroyed()) return null;
        // A run is already active: there is nothing to set up, so show its live details instead.
        if (Control.gameRoutesRunning()) return GameRoutesDetailsDialog.show(activity);
        Context ctx = MapTheme.wrap(activity);
        LinearLayout layout = new LinearLayout(ctx);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = MapTheme.dp(ctx, 18);
        layout.setPadding(pad, MapTheme.dp(ctx, 8), pad, 0);

        layout.addView(label(ctx, "Walk eligible in-game Routes automatically, shortest total walk first. Each Route is "
            + "started, walked once and completed in game before the next.", 13));

        LinearLayout countRow = new LinearLayout(ctx);
        countRow.setOrientation(LinearLayout.HORIZONTAL);
        countRow.setGravity(Gravity.CENTER_VERTICAL);
        countRow.setPadding(0, MapTheme.dp(ctx, 10), 0, 0);
        countRow.addView(label(ctx, "Max completions (1–" + MAX_COMPLETIONS + "):", 15), new LinearLayout.LayoutParams(0, -2, 1));
        EditText countField = new EditText(ctx);
        countField.setInputType(InputType.TYPE_CLASS_NUMBER);
        countField.setFilters(new InputFilter[]{new InputFilter.LengthFilter(2)});
        countField.setText(String.valueOf(DEFAULT_COMPLETIONS));
        countField.setSingleLine(true);
        countRow.addView(countField, new LinearLayout.LayoutParams(MapTheme.dp(ctx, 72), -2));
        layout.addView(countRow);

        TextView status = label(ctx, "Waiting for Route support…", 13);
        status.setPadding(0, MapTheme.dp(ctx, 10), 0, 0);
        layout.addView(status);
        TextView nearby = label(ctx, "", 13);
        nearby.setPadding(0, MapTheme.dp(ctx, 8), 0, MapTheme.dp(ctx, 4));
        layout.addView(nearby);

        AlertDialog dialog = new AlertDialog.Builder(ctx)
            .setTitle("Walk Routes")
            .setView(layout)
            .setNegativeButton("Close", null)
            .setNeutralButton("Stop", null)
            .setPositiveButton("Start walking routes", null)
            .create();

        Controller controller = new Controller(activity, dialog, countField, status, nearby);
        DialogLifecycle.bind(activity, dialog, controller::close);
        dialog.setOnShowListener(d -> { MapTheme.style(layout); MapTheme.styleButtons(dialog); controller.attach(); });
        dialog.show();
        return dialog;
    }

    private static final class Controller {
        private final Activity activity; private final AlertDialog dialog;
        private final EditText countField; private final TextView status, nearby;
        private final Handler main = new Handler(Looper.getMainLooper());
        private final Runnable poll = this::poll;
        private boolean closed;

        Controller(Activity a, AlertDialog d, EditText countField, TextView status, TextView nearby) {
            this.activity = a; this.dialog = d; this.countField = countField; this.status = status; this.nearby = nearby;
        }

        void attach() {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> start());
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v -> stop());
            poll();
        }

        private void poll() {
            if (closed) return;
            if (activity.isFinishing() || activity.isDestroyed()) { if (dialog.isShowing()) dialog.dismiss(); else close(); return; }
            Control.setGameRoutesPlanning(true); // renew the native discovery stream while visible
            boolean ready = Control.gameRoutesReady(), running = Control.gameRoutesRunning();
            String reward=Control.gameRoutesLastReward();
            status.setText((ready ? Control.gameRoutesStatus() : "Waiting for Route support…")
                +(reward.isEmpty()?"":"\nLast rewards received: "+reward));
            nearby.setText(describeNearby(Control.gameRoutesSnapshot()));
            Button start = dialog.getButton(AlertDialog.BUTTON_POSITIVE);
            if (start != null) start.setEnabled(ready && !running);
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setEnabled(running);
            main.removeCallbacks(poll);
            main.postDelayed(poll, 1000);
        }

        private void start() {
            if (closed) return;
            int count;
            try { count = Integer.parseInt(countField.getText().toString().trim()); }
            catch (NumberFormatException e) { countField.setError("Enter 1–" + MAX_COMPLETIONS); return; }
            if (count < 1 || count > MAX_COMPLETIONS) { countField.setError("Enter 1–" + MAX_COMPLETIONS); return; }
            try { Control.startGameRoutes(count); }
            catch(IllegalArgumentException e){Toast.makeText(activity,e.getMessage(),Toast.LENGTH_SHORT).show();}
            // Dismiss only once a run truly began; otherwise keep the dialog so validation/errors stay visible.
            if (Control.gameRoutesRunning()) { dialog.dismiss(); }
            else poll();
        }

        private void stop() {
            if (closed) return;
            Control.stopGameRoutes();
            Toast.makeText(activity, "Route automation stopped.", Toast.LENGTH_SHORT).show();
            poll();
        }

        void close() {
            if (closed) return;
            closed = true;
            main.removeCallbacksAndMessages(null);
            Control.setGameRoutesPlanning(false);
        }
    }

    /** Reads the native snapshot into a short, readable nearby list; never throws on bad data. */
    private static String describeNearby(String snapshot) {
        if (snapshot == null || snapshot.isEmpty()) return "No Routes loaded yet. Move around in-game to discover some.";
        try {
            JSONArray routes = new JSONObject(snapshot).optJSONArray("routes");
            if (routes == null || routes.length() == 0) return "No Routes loaded yet. Move around in-game to discover some.";
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < routes.length() && i < 8; i++) {
                JSONObject r = routes.optJSONObject(i);
                if (r == null) continue;
                sb.append("• ").append(r.optString("name", r.optString("id", "Route")));
                double meters = r.optDouble("distanceMeters", 0);
                if (meters > 0) sb.append(String.format(Locale.US, " — %.0f m", meters));
                if (r.optBoolean("reversible")) sb.append(" (reversible)");
                sb.append('\n');
            }
            return sb.length() == 0 ? "No Routes loaded yet." : sb.toString().trim();
        } catch (org.json.JSONException bad) { return "Nearby Routes are unavailable right now."; }
    }

    private static TextView label(Context c, String text, int size) { TextView v = new TextView(c); v.setText(text); v.setTextSize(size); return v; }
}
