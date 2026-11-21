package dev.pgrazor;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.graphics.drawable.ColorDrawable;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

/** Session controls for the existing in-battle Dynamax/Gigantamax automation. */
public final class AutoMaxBattleDialog {
    private AutoMaxBattleDialog() {}

    public static void show(Activity activity) {
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) return;
        Context ui = MapTheme.wrap(activity);
        LinearLayout body = new LinearLayout(ui);
        body.setOrientation(LinearLayout.VERTICAL);
        int pad = MapTheme.dp(ui, 16);
        body.setPadding(pad, pad, pad, pad);

        TextView description = new TextView(ui);
        description.setText("Arms PGRazor's automatic combat controls for Dynamax and Gigantamax battles. "
            + "Start this session, then enter a Max Battle at a Power Spot. Quick, charged and Max attacks, "
            + "dodging and Max-orb movement use the existing native battle controller.\n\n"
            + "Power Spot discovery, Max Particle spending, battle entry, party selection and the reward/catch "
            + "flow are not automated in this build. Those steps remain under your control.");
        body.addView(description);

        TextView status = new TextView(ui);
        body.addView(status);

        final CheckBox quick = new CheckBox(ui);
        quick.setText("Auto quick attack");
        body.addView(quick);
        final CheckBox charged = new CheckBox(ui);
        charged.setText("Auto charged attack");
        body.addView(charged);
        final CheckBox maxAttack = new CheckBox(ui);
        maxAttack.setText("Auto Max attack");
        body.addView(maxAttack);
        final CheckBox dodge = new CheckBox(ui);
        dodge.setText("Auto dodge");
        body.addView(dodge);

        int saved = Control.battleOptions();
        int selected = saved & AutoMaxBattle.OPTION_MASK;
        if (selected == 0) selected = AutoMaxBattle.OPTION_MASK;
        quick.setChecked((selected & AutoMaxBattle.QUICK) != 0);
        charged.setChecked((selected & AutoMaxBattle.CHARGED) != 0);
        maxAttack.setChecked((selected & AutoMaxBattle.MAX_ATTACK) != 0);
        dodge.setChecked((selected & AutoMaxBattle.DODGE) != 0);

        Button start = new Button(ui);
        start.setAllCaps(false);
        start.setText("Start");
        body.addView(start);
        Button stop = new Button(ui);
        stop.setAllCaps(false);
        stop.setText("Stop");
        body.addView(stop);

        View[] options = {quick, charged, maxAttack, dodge};
        Runnable update = () -> {
            boolean running = AutoMaxBattle.running();
            status.setText(AutoMaxBattle.status() + "\nBattle support: " + Control.battleStatus());
            for (View option : options) SettingsUi.enabled(option, !running);
            start.setEnabled(!running);
            stop.setEnabled(running);
        };

        start.setOnClickListener(v -> {
            int mask = (quick.isChecked() ? AutoMaxBattle.QUICK : 0)
                | (charged.isChecked() ? AutoMaxBattle.CHARGED : 0)
                | (maxAttack.isChecked() ? AutoMaxBattle.MAX_ATTACK : 0)
                | (dodge.isChecked() ? AutoMaxBattle.DODGE : 0);
            try {
                AutoMaxBattle.start(mask);
            } catch (IllegalArgumentException | IllegalStateException refused) {
                Toast.makeText(activity, refused.getMessage(), Toast.LENGTH_LONG).show();
            }
            update.run();
        });
        stop.setOnClickListener(v -> {
            AutoMaxBattle.stop();
            update.run();
        });

        update.run();
        ScrollView scroll = new ScrollView(ui);
        scroll.addView(body);
        AlertDialog dialog = new AlertDialog.Builder(ui).setTitle("Auto Max Battle")
            .setView(scroll).setPositiveButton("Done", null).create();
        DialogLifecycle.bind(activity, dialog, null);
        dialog.setOnShowListener(ignored -> {
            MapTheme.style(body);
            MapTheme.styleButtons(dialog);
            dialog.getWindow().setBackgroundDrawable(new ColorDrawable(MapTheme.surface()));
        });
        dialog.show();
    }
}
