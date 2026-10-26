package dev.pgrazor;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Live details for the Route run the coordinator surfaces from the draggable overlay icon (or from
 * {@link GameRoutesDialog} once a run is active). While visible it polls {@link Control#gameRoutesDetails()}
 * about once a second and redraws the Route name, phase, direction, length and completed count plus a
 * simple {@link GameRoutesPathView} preview with the start/end markers and the current avatar. All
 * native work stays behind Control; the dialog only reads a cheap immutable JSON snapshot on the UI
 * thread and polls only while shown. Themed with {@link MapTheme}; scoped by {@link DialogLifecycle}.
 */
public final class GameRoutesDetailsDialog {
    private GameRoutesDetailsDialog() {}

    public static AlertDialog show(Activity activity) {
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) return null;
        Context ctx = MapTheme.wrap(activity);
        LinearLayout layout = new LinearLayout(ctx);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = MapTheme.dp(ctx, 18);
        layout.setPadding(pad, MapTheme.dp(ctx, 8), pad, 0);

        TextView name = label(ctx, "Route run", 18);
        layout.addView(name);
        TextView meta = label(ctx, "", 13);
        meta.setPadding(0, MapTheme.dp(ctx, 6), 0, MapTheme.dp(ctx, 10));
        layout.addView(meta);

        GameRoutesPathView path = new GameRoutesPathView(ctx);
        layout.addView(path, new LinearLayout.LayoutParams(-1, MapTheme.dp(ctx, 200)));

        TextView note = label(ctx, "", 11);
        note.setGravity(Gravity.CENTER_HORIZONTAL);
        note.setPadding(0, MapTheme.dp(ctx, 8), 0, 0);
        layout.addView(note);

        AlertDialog dialog = new AlertDialog.Builder(ctx)
            .setTitle("Route run")
            .setView(layout)
            .setNegativeButton("Close", null)
            .setNeutralButton("Stop", null)
            .create();

        Controller controller = new Controller(activity, dialog, name, meta, path, note);
        DialogLifecycle.bind(activity, dialog, controller::close);
        dialog.setOnShowListener(d -> { MapTheme.style(layout); MapTheme.styleButtons(dialog); controller.attach(); });
        dialog.show();
        return dialog;
    }

    private static final class Controller {
        private final Activity activity; private final AlertDialog dialog;
        private final TextView name, meta, note; private final GameRoutesPathView path;
        private final Handler main = new Handler(Looper.getMainLooper());
        private final Runnable poll = this::poll;
        private boolean closed;

        Controller(Activity a, AlertDialog d, TextView name, TextView meta, GameRoutesPathView path, TextView note) {
            this.activity = a; this.dialog = d; this.name = name; this.meta = meta; this.path = path; this.note = note;
        }

        void attach() {
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v -> stop());
            poll();
        }

        private void poll() {
            if (closed) return;
            if (activity.isFinishing() || activity.isDestroyed()) { if (dialog.isShowing()) dialog.dismiss(); else close(); return; }
            render(Control.gameRoutesDetails());
            main.removeCallbacks(poll);
            main.postDelayed(poll, 1000);
        }

        /** Never throws on bad data; a missing route just shows the status line and an empty preview. */
        private void render(String json) {
            boolean running = false;
            try {
                JSONObject o = new JSONObject(json == null ? "{}" : json);
                running = o.optBoolean("running");
                String routeName = o.optString("name", "");
                name.setText(routeName.isEmpty() ? (running ? "Route run" : "No Route running") : routeName);

                StringBuilder sb = new StringBuilder();
                sb.append(phaseText(o.optString("phase", "IDLE")));
                if (o.has("name")) {
                    sb.append("  •  ").append(o.optBoolean("reversed") ? "Reverse" : "Forward");
                    double meters = o.optDouble("distanceMeters", 0);
                    if (meters > 0) sb.append(String.format(Locale.US, "  •  %.0f m", meters));
                }
                sb.append("\nCompleted ").append(o.optInt("completions"))
                  .append(" of ").append(o.optInt("maxCompletions"));
                sb.append('\n').append(o.optString("status", ""));
                String reward=o.optString("lastReward", "");
                if(!reward.isEmpty())sb.append("\nLast rewards received: ").append(reward);
                meta.setText(sb.toString());

                path.setData(parsePolyline(o.optJSONArray("points")), parsePoint(o.optJSONArray("currentPosition")));
                note.setText("Green: start / Red: finish / Ring: you");
            } catch (JSONException bad) {
                name.setText("Route run");
                meta.setText("Route details are unavailable right now.");
                path.setData(null, null);
            }
            Button stop = dialog.getButton(AlertDialog.BUTTON_NEUTRAL);
            if (stop != null) stop.setEnabled(running);
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
        }
    }

    private static String phaseText(String phase) {
        switch (phase) {
            case "WALK_TO_START":  return "Walking to the start";
            case "AWAIT_START":    return "Starting the Route";
            case "TRAVERSE":       return "Walking the Route";
            case "AWAIT_ELIGIBLE": return "Reaching the end";
            case "AWAIT_COMPLETE": return "Completing the Route";
            default:               return "Idle";
        }
    }

    private static double[][] parsePolyline(JSONArray arr) {
        if (arr == null || arr.length() < 2) return null;
        double[][] out = new double[arr.length()][];
        int n = 0;
        for (int i = 0; i < arr.length(); i++) { double[] p = parsePoint(arr.optJSONArray(i)); if (p != null) out[n++] = p; }
        if (n < 2) return null;
        if (n == out.length) return out;
        double[][] trimmed = new double[n][]; System.arraycopy(out, 0, trimmed, 0, n); return trimmed;
    }

    private static double[] parsePoint(JSONArray a) {
        if (a == null || a.length() < 2) return null;
        double lat = a.optDouble(0, Double.NaN), lon = a.optDouble(1, Double.NaN);
        return Double.isFinite(lat) && Double.isFinite(lon) ? new double[]{lat, lon} : null;
    }

    private static TextView label(Context c, String text, int size) { TextView v = new TextView(c); v.setText(text); v.setTextSize(size); return v; }
}
