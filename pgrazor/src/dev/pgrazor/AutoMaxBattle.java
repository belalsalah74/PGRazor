package dev.pgrazor;

/**
 * Foreground-only Max Battle assistant.
 *
 * <p>The native battle feature already automates quick, charged, Max attacks, dodging and Max-orb
 * movement while a Dynamax/Gigantamax battle scope is active. This coordinator arms those options
 * for a session without rewriting the user's saved battle preferences. Power Spot discovery,
 * particle spending, battle entry, party selection and post-battle rewards/catching remain manual:
 * this game build has no validated Power Spot map/entry adapter.
 */
public final class AutoMaxBattle {
    private AutoMaxBattle() {}

    public static final int QUICK = 1 << 4;
    public static final int CHARGED = 1 << 5;
    public static final int MAX_ATTACK = 1 << 6;
    public static final int DODGE = 1 << 9;
    public static final int OPTION_MASK = QUICK | CHARGED | MAX_ATTACK | DODGE;

    private static volatile int sessionOptions;
    private static volatile String message = "Not running";

    public static boolean running() { return sessionOptions != 0; }
    public static int optionMask() { return sessionOptions; }
    public static String status() { return message; }

    /** Arms a temporary battle-options overlay; saved Settings values are never modified. */
    public static synchronized void start(int requestedOptions) {
        int selected = requestedOptions & OPTION_MASK;
        if (selected != requestedOptions || (selected & (QUICK | CHARGED | MAX_ATTACK)) == 0) {
            throw new IllegalArgumentException("Enable at least one attack option; only Max Battle options are accepted.");
        }
        if (!Control.active() || !Control.battlesAllowed()) {
            throw new IllegalStateException("Wait for the game and battle support to be ready.");
        }
        if (AutoRaid.running() || OneShotAutomation.enabled() || GiftBatchSettings.running()
                || BatchEvolutionSettings.enabled() || ShundoSniper.active()
                || GymAutomationSettings.running()) {
            throw new IllegalStateException("Stop the current automation before starting Auto Max Battle.");
        }
        if (Control.engine.walking || Control.gameRoutesRunning() || Control.automationPlanning()) {
            throw new IllegalStateException("Stop the current walk or Route before starting Auto Max Battle.");
        }

        sessionOptions = selected;
        message = "Armed — enter a Dynamax or Gigantamax battle at a Power Spot.";
        Control.event("max-battle-session", "Started; Power Spot discovery and entry remain manual");
    }

    /** Disarms only this session's temporary options, preserving the saved battle settings. */
    public static synchronized void stop() {
        if (!running()) return;
        sessionOptions = 0;
        message = "Stopped — saved battle settings restored.";
        Control.event("max-battle-session", "Stopped; saved battle settings restored");
    }

    /** Sessions never resume after backgrounding, account changes, or a process restart. */
    public static synchronized void reset() {
        sessionOptions = 0;
        message = "Not running";
    }
}
