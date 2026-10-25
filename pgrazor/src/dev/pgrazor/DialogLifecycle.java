package dev.pgrazor;

import android.app.Activity;
import android.app.Application;
import android.app.Dialog;
import android.os.Bundle;

/** Keeps quick-menu dialogs and their polling scoped to the foreground activity. */
final class DialogLifecycle {
    private DialogLifecycle() {}
    static void bind(Activity owner, Dialog dialog, Runnable cleanup) {
        bind(owner,dialog,cleanup,()->false,()->{},()->{});
    }
    /** A login form may survive a password-manager activity; its work still pauses. */
    static void bind(Activity owner, Dialog dialog, Runnable cleanup,
                     java.util.function.BooleanSupplier retainOnPause, Runnable pause, Runnable resume) {
        Application app=owner.getApplication();
        Application.ActivityLifecycleCallbacks callbacks=new Application.ActivityLifecycleCallbacks(){
            public void onActivityPaused(Activity a){if(a==owner){if(retainOnPause.getAsBoolean())pause.run();else dialog.dismiss();}}
            public void onActivityDestroyed(Activity a){if(a==owner)dialog.dismiss();}
            public void onActivityCreated(Activity a,Bundle b){}
            public void onActivityStarted(Activity a){}
            public void onActivityResumed(Activity a){if(a==owner&&dialog.isShowing())resume.run();}
            public void onActivityStopped(Activity a){}
            public void onActivitySaveInstanceState(Activity a,Bundle b){}
        };
        app.registerActivityLifecycleCallbacks(callbacks);
        dialog.setOnDismissListener(d->{app.unregisterActivityLifecycleCallbacks(callbacks);if(cleanup!=null)cleanup.run();});
    }
}
