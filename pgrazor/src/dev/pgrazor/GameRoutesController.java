package dev.pgrazor;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashSet;
import java.util.Set;
import java.util.function.LongSupplier;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Pure, independently testable brain for automatic in-game Route walking. Owns route selection,
 * the one-session-at-a-time lifecycle, the movement-ownership token and the native-command queue;
 * it reuses {@link MotionEngine} for physical movement and never loops it (each game Route must be
 * completed and restarted individually — movement completion alone is not a game completion).
 *
 * <h3>API the coordinator wires (stable)</h3>
 * <ul>
 *   <li>{@code GameRoutesController(MotionEngine engine, LongSupplier monotonic, LongSupplier wallClock)}
 *       — monotonic is elapsed-ms for timeouts/staleness; wallClock is epoch-ms for cooldowns.</li>
 *   <li>{@link #setReady(boolean)} / {@link #ready()} — native Route support gate.</li>
 *   <li>{@link #setPlanning(boolean)} — dialog visible; queues a discovery request on enable.</li>
 *   <li>{@link #acceptSnapshot(String)} — latest native {@code {routes:[…],current:…|null}} JSON.</li>
 *   <li>{@link #acceptAction(String)} — native ack {@code {seq,status:'submitted'|'error'}}.</li>
 *   <li>{@link #tick(boolean hostAllowed)} — drive one step; hostAllowed is the hook/foreground lease.</li>
 *   <li>{@link #start(int)} / {@link #stop(String)} / {@link #running()} / {@link #status()}.</li>
 *   <li>{@link #snapshot()} — last accepted native snapshot (for the nearby list UI).</li>
 *   <li>{@link #command()} — returns the pending command until acknowledged (seq is monotonic).</li>
 * </ul>
 *
 * <p>Conservative MVP: skips routes already completed this session, stops after a bounded number of
 * confirmed completions, never claims endpoint arrival is success (completion is requested only when
 * native reports eligibility and is counted only when native reports {@code acquiredReward}), never
 * blind-retries a timed-out async request, and never auto-resumes after a cancellation, pause, lost
 * host lease or manual takeover.</p>
 */
final class GameRoutesController {
    static final int DEFAULT_MAX_COMPLETIONS = 5;
    static final int MAX_COMPLETIONS_CAP = 50;
    /** Async native requests get a bounded wait, then stop (no blind retry). */
    static final long REQUEST_TIMEOUT_MS = 30_000L;
    /** A snapshot older than this is treated as unknown; we never act on stale current state. */
    static final long SNAPSHOT_STALE_MS = 20_000L;

    private enum Phase { IDLE, WALK_TO_START, AWAIT_START, TRAVERSE, AWAIT_ELIGIBLE, AWAIT_COMPLETE }
    private enum Move { WALKING, ARRIVED, LOST }

    private static final class RouteInfo {
        final String id, name; final boolean reversible;
        final double distanceMeters; final long cooldownFinishMs; final double[][] points;
        RouteInfo(String id, String name, boolean reversible, double distanceMeters, long cooldownFinishMs, double[][] points) {
            this.id = id; this.name = name; this.reversible = reversible;
            this.distanceMeters = distanceMeters; this.cooldownFinishMs = cooldownFinishMs; this.points = points;
        }
    }
    private static final class CurrentRoute {
        final String id; final boolean started, paused, completedWalk, acquiredReward, inRangeOfEnd, isCompleting, reversed;
        CurrentRoute(String id, boolean started, boolean paused, boolean completedWalk, boolean acquiredReward,
                     boolean inRangeOfEnd, boolean isCompleting, boolean reversed) {
            this.id = id; this.started = started; this.paused = paused; this.completedWalk = completedWalk;
            this.acquiredReward = acquiredReward; this.inRangeOfEnd = inRangeOfEnd; this.isCompleting = isCompleting; this.reversed=reversed;
        }
    }

    private final Object lock = new Object();
    private final MotionEngine engine;
    private final LongSupplier monotonic, wallClock;
    private final Deque<String> pending = new ArrayDeque<>();
    private final Set<String> visited = new HashSet<>();

    private volatile boolean ready;
    private boolean planning;
    private boolean running;
    private Phase phase = Phase.IDLE;
    private String status = "Route automation idle.";

    private String rawSnapshot = "";
    private RouteInfo[] routes = new RouteInfo[0];
    private CurrentRoute current;
    private boolean hasCurrent;
    private String rewardedId=""; private int rewardedSeq=-1;
    private long snapshotAt;
    private boolean snapshotReceived;

    private int maxCompletions = DEFAULT_MAX_COMPLETIONS;
    private int completions;
    private String lastReward="", pendingReward="";
    private String selectedId; private boolean selectedReversed; private double[][] selectedPoints;
    private long ownedToken; private int ownedTotal;
    private int seq; private int outstandingSeq = -1; private String outstandingAction = ""; private long requestDeadline;

    GameRoutesController(MotionEngine engine, LongSupplier monotonic, LongSupplier wallClock) {
        if (engine == null || monotonic == null || wallClock == null) throw new IllegalArgumentException("null dependency");
        this.engine = engine; this.monotonic = monotonic; this.wallClock = wallClock;
    }

    void setReady(boolean value) { synchronized(lock) { ready=value; if(!value) { halt("Waiting for Route support."); snapshotReceived=false; } } }
    boolean ready() { return ready; }
    boolean running() { synchronized (lock) { return running; } }
    String status() { synchronized (lock) { return status; } }
    String lastReward() { synchronized(lock) { return lastReward; } }
    String takeRewardNotice() { synchronized(lock) { String value=pendingReward; pendingReward=""; return value; } }
    String snapshot() { synchronized (lock) { return rawSnapshot; } }

    /**
     * A compact, immutable JSON description of the active run for the details UI. Everything is copied
     * under the lock; no mutable engine or controller array is handed out. The polyline is downsampled
     * so even a multi-thousand-point GPX Route stays cheap to poll once a second. {@code walkVisited}/
     * {@code walkTotal} describe our own local walking position along the selected geometry — they are
     * not the game's route-completion progress and the UI must label them as such.
     */
    String details() {
        synchronized (lock) {
            JSONObject o = new JSONObject();
            try {
                o.put("running", running);
                  o.put("lastReward", lastReward);
                o.put("status", status);
                o.put("phase", phase.name());
                o.put("completions", completions);
                o.put("maxCompletions", maxCompletions);
                JSONArray pos = new JSONArray();
                pos.put(engine.latitude); pos.put(engine.longitude);
                o.put("currentPosition", pos);
                if (selectedId != null && selectedPoints != null && selectedPoints.length > 0) {
                    o.put("id", selectedId);
                    o.put("reversed", selectedReversed);
                    RouteInfo info = routeById(selectedId);
                    o.put("name", info != null ? label(info) : selectedId);
                    if (info != null) o.put("distanceMeters", info.distanceMeters);
                    o.put("points", downsample(selectedPoints, 120));
                    // Local walking progress only — never the game's completion state.
                    MotionEngine.RouteProgress p = engine.routeProgress();
                    if (ownedToken != 0 && engine.activeRouteToken() == ownedToken && p.total > 0) {
                        o.put("walkVisited", Math.min(p.visited, p.total));
                        o.put("walkTotal", p.total);
                    }
                }
            } catch (JSONException ignored) { /* fixed keys with finite numbers never throw */ }
            return o.toString();
        }
    }

    String command() {
        synchronized (lock) { String c = pending.peek(); return c == null ? "" : c; }
    }

    /** Dialog visibility toggle; enabling queues one discovery so native starts streaming nearby routes. */
    void setPlanning(boolean value) {
        synchronized (lock) {
            if (value && !planning && !running) queue("discover", null, null);
            planning = value;
        }
    }

    /** Latest native snapshot. A malformed payload is ignored and the previous snapshot is kept. */
    boolean acceptSnapshot(String json) {
        synchronized (lock) {
            try {
                if(json==null||json.length()>700000)return false;
                JSONObject root = new JSONObject(json);
                if(!root.has("current")||root.optJSONArray("routes")==null)return false;
                RouteInfo[] parsed = parseRoutes(root.optJSONArray("routes"));
                JSONObject cur = root.optJSONObject("current");
                routes = parsed;
                JSONObject reward=root.optJSONObject("completion");
                rewardedId=reward==null?"":reward.optString("id","");
                rewardedSeq=reward==null?-1:reward.optInt("seq",-1);
                if (cur == null) { current = null; hasCurrent = false; }
                else {
                    current = new CurrentRoute(cur.optString("id", ""), cur.optBoolean("started"),
                        cur.optBoolean("paused"), cur.optBoolean("completedWalk"), cur.optBoolean("acquiredReward"),
                        cur.optBoolean("inRangeOfEnd"), cur.optBoolean("isCompleting"), cur.optBoolean("reversed"));
                    hasCurrent = true;
                }
                rawSnapshot = json == null ? "" : json;
                snapshotAt = monotonic.getAsLong(); snapshotReceived=true;
                return true;
            } catch (JSONException malformed) { return false; }
        }
    }

    /** Native ack for a queued command; an error ends automation, a submit just means it was received. */
    void acceptAction(String json) {
        synchronized (lock) {
            try {
                JSONObject o = new JSONObject(json);
                int ackSeq = o.optInt("seq", -1);
                String st = o.optString("status", "");
                if(!"submitted".equals(st)&&!"error".equals(st))return;
                String head=pending.peek();
                if(head!=null&&new JSONObject(head).optInt("seq",-2)==ackSeq)pending.poll();
                if (running && ackSeq == outstandingSeq && "error".equals(st))
                    halt("Game rejected " + outstandingAction + ": " + o.optString("reason","unknown error"));
            } catch (JSONException ignored) { /* ignore unparsable acks */ }
        }
    }

    /** Begin automation; refuses if support is not ready or a game Route is already active. */
    void start(int max) {
        synchronized (lock) {
            if (running) return;
            if (!ready) { status = "Route support is not ready yet."; return; }
            if(!freshSnapshot()) { status="Waiting for a fresh Route list."; return; }
            if(engine.walking) { status="Stop the current walk first."; return; }
            if(engine.speedKmh<=0) { status="Choose a walking speed first."; return; }
            if (hasCurrent && !current.acquiredReward) {
                // Explicit Start can recover a completed walk that still needs its end/reward.
                if(current.started && current.completedWalk && !current.paused && !current.isCompleting) {
                    for(RouteInfo r:routes) if(r.id.equals(current.id)) {
                        maxCompletions=max<=0?DEFAULT_MAX_COMPLETIONS:Math.min(max,MAX_COMPLETIONS_CAP);
                        pending.clear();completions=0;visited.clear();running=true;selectedId=r.id;selectedReversed=current.reversed;
                        selectedPoints=current.reversed?reversed(r.points):copy(r.points);
                        if(!issueWalk(new double[][]{selectedPoints[selectedPoints.length-1]})){halt("Could not reach the Route endpoint.");return;}
                        phase=Phase.TRAVERSE;status="Returning to the completed Route's endpoint…";return;
                    }
                }
                status = "A game Route is already active. Finish or cancel it first."; return;
            }
            maxCompletions = max <= 0 ? DEFAULT_MAX_COMPLETIONS : Math.min(max, MAX_COMPLETIONS_CAP);
            pending.clear(); completions = 0; visited.clear(); running = true; selectedId = null; selectedPoints = null;
            status = "Selecting a route…";
            selectNext();
        }
    }

    void stop(String reason) { synchronized (lock) { halt(reason == null ? "Automation stopped." : reason); } }

    void tick(boolean hostAllowed) {
        synchronized (lock) {
            if (!running) return;
            if (!ready) { halt("Route support became unavailable."); return; }
            if (!hostAllowed) { halt("Automation stopped: host or hooks unavailable."); return; }
            // A different planned route taking over MotionEngine means a manual/other-route takeover.
            if(!freshSnapshot()){halt("Stopped: Route state is stale.");return;}
            if (phase != Phase.IDLE && ownedToken != 0 && engine.routeGeneration() != ownedToken) { halt("Stopped: movement was taken over."); return; }
            switch (phase) {
                case WALK_TO_START: pumpWalkToStart(); break;
                case AWAIT_START: pumpAwaitStart(); break;
                case TRAVERSE: pumpTraverse(); break;
                case AWAIT_ELIGIBLE: pumpAwaitEligible(); break;
                case AWAIT_COMPLETE: pumpAwaitComplete(); break;
                default: break;
            }
        }
    }

    // --- phases -------------------------------------------------------------

    private void selectNext() {
        if (completions >= maxCompletions) { finish("Done: " + completions + " route(s) completed."); return; }
        long now = wallClock.getAsLong();
        RouteInfo best = null; boolean bestReversed = false; double bestDistance = Double.MAX_VALUE;
        for (RouteInfo r : routes) {
            if (visited.contains(r.id)) continue;
            if (r.cooldownFinishMs > now) continue; // still cooling down
            double routeLength=Math.max(0,r.distanceMeters);
            double forward = distance(r.points[0])+routeLength;
            if (forward < bestDistance) { best = r; bestReversed = false; bestDistance = forward; }
            if (r.reversible) {
                double reverse = distance(r.points[r.points.length - 1])+routeLength;
                if (reverse < bestDistance) { best = r; bestReversed = true; bestDistance = reverse; }
            }
        }
        if (best == null) { finish("No eligible routes available."); return; }
        selectedId = best.id; selectedReversed = bestReversed;
        selectedPoints = bestReversed ? reversed(best.points) : copy(best.points);
        status = "Walking to the start of " + label(best) + "…";
        if (!issueWalk(new double[][]{selectedPoints[0]})) { halt("Could not walk to the route start."); return; }
        phase = Phase.WALK_TO_START;
    }

    private void pumpWalkToStart() {
        switch (observeMovement()) {
            case WALKING: return;
            case LOST: halt("Stopped before reaching the route start."); return;
            case ARRIVED:
                queue("start", selectedId, selectedReversed);
                requestDeadline = monotonic.getAsLong() + REQUEST_TIMEOUT_MS;
                status = "Requesting the game to start the route…";
                phase = Phase.AWAIT_START;
        }
    }

    private void pumpAwaitStart() {
        CurrentRoute c = freshCurrent();
        if (c != null && selectedId.equals(c.id) && c.started) {
            if(c.paused){halt("Route is paused in game.");return;}
            if (!issueWalk(selectedPoints)) { halt("Could not begin the route walk."); return; }
            status = "Walking the route…";
            phase = Phase.TRAVERSE;
            return;
        }
        if (timedOut()) halt("The game did not confirm the route start in time.");
    }

    private void pumpTraverse() {
        CurrentRoute c = freshCurrent();
        if(c==null||!selectedId.equals(c.id)){halt("Stopped: active game Route changed.");return;}
        if (c.paused) { halt("Route paused. Finish or cancel it in game before restarting."); return; }
        if(c.started && c.completedWalk && c.inRangeOfEnd && !c.isCompleting) { requestCompletion(); return; }
        switch (observeMovement()) {
            case WALKING: return;
            case LOST: halt("Stopped mid-route before the end."); return;
            case ARRIVED:
                status = "At the end — waiting for the game to allow completion…";
                requestDeadline = monotonic.getAsLong() + REQUEST_TIMEOUT_MS;
                phase = Phase.AWAIT_ELIGIBLE;
        }
    }

    private void pumpAwaitEligible() {
        CurrentRoute c = freshCurrent();
        if (c == null || !selectedId.equals(c.id)) { if (timedOut()) halt("Lost the active route before completion."); return; }
        if (c.paused) { halt("Route paused. Finish or cancel it in game before restarting."); return; }
        if (c.inRangeOfEnd && c.completedWalk && !c.isCompleting) {
            requestCompletion();
            return;
        }
        if (timedOut()) halt("The route did not become eligible for completion in time.");
    }

    private void requestCompletion() {
        engine.stop(); ownedToken=engine.routeGeneration(); ownedTotal=0;
        queue("complete",selectedId,null);
        requestDeadline=monotonic.getAsLong()+REQUEST_TIMEOUT_MS;
        status="Requesting route completion…";phase=Phase.AWAIT_COMPLETE;
    }

    private void pumpAwaitComplete() {
        CurrentRoute c = freshCurrent();
        if ((c != null && selectedId.equals(c.id) && c.acquiredReward) ||
            (selectedId.equals(rewardedId) && rewardedSeq==outstandingSeq)) {
            completions++; visited.add(selectedId);
            RouteInfo rewardedRoute=routeById(selectedId);
            lastReward=rewardedRoute==null?"Route":label(rewardedRoute);
            pendingReward="Route rewards received: " + lastReward;
            engine.stop(); ownedToken = 0; ownedTotal = 0;
            status = "Completed " + completions + " route(s). Selecting the next…";
            phase = Phase.IDLE;
            selectNext();
            return;
        }
        if (timedOut()) halt("The game did not confirm the reward in time.");
    }

    // --- helpers ------------------------------------------------------------

    /** Issues a one-shot (never looping) planned walk and records the ownership token/length. */
    private boolean issueWalk(double[][] pts) {
        try { engine.walkRoute(pts, false); } catch (IllegalArgumentException invalid) { return false; }
        ownedToken = engine.routeGeneration(); ownedTotal = pts.length;
        return true;
    }

    private Move observeMovement() {
        if(engine.routeGeneration()!=ownedToken)return Move.LOST;
        MotionEngine.RouteProgress p = engine.routeProgress();
        if (ownedTotal > 0 && !p.active && p.total == ownedTotal && p.visited >= ownedTotal) return Move.ARRIVED;
        long token = engine.activeRouteToken();
        if (token != 0 && token == ownedToken) return Move.WALKING;
        return Move.LOST;
    }

    private boolean freshSnapshot(){long age=monotonic.getAsLong()-snapshotAt;return snapshotReceived&&age>=0&&age<=SNAPSHOT_STALE_MS;}

    private CurrentRoute freshCurrent() {
        if (!hasCurrent || current == null) return null;
        if (monotonic.getAsLong() - snapshotAt > SNAPSHOT_STALE_MS) return null; // never act on stale state
        return current;
    }

    private boolean timedOut() { return monotonic.getAsLong() >= requestDeadline; }

    private void finish(String message) { halt(message); }

    private void halt(String message) {
        // Release movement only if we still own it, so we never cancel a manual takeover.
        if (ownedToken != 0 && engine.activeRouteToken() == ownedToken) engine.stop();
        ownedToken = 0; ownedTotal = 0; pending.clear(); outstandingSeq=-1; running = false; phase = Phase.IDLE; status = message;
    }

    private void queue(String action, String id, Boolean reversed) {
        try {
            JSONObject o = new JSONObject();
            o.put("seq", ++seq); o.put("action", action);
            if (id != null) o.put("id", id);
            if (reversed != null) o.put("reversed", reversed.booleanValue());
            pending.add(o.toString());
            outstandingSeq = seq; outstandingAction = action;
        } catch (JSONException ignored) { /* fixed keys never throw */ }
    }

    private RouteInfo[] parseRoutes(JSONArray array) {
        if (array == null) return new RouteInfo[0];
        java.util.List<RouteInfo> out = new java.util.ArrayList<>();
        for (int i = 0; i < Math.min(100,array.length()); i++) {
            JSONObject r = array.optJSONObject(i);
            if (r == null) continue;
            String id = r.optString("id", "");
            if (id.isEmpty()||id.length()>128) continue;
            double[][] pts = parsePoints(r.optJSONArray("points"));
            if (pts == null) continue; // malformed or out-of-bounds geometry: skip this route
            double[] start=parseAnchor(r.optJSONArray("start")),end=parseAnchor(r.optJSONArray("end"));
            int extra=(start==null?0:1)+(end==null?0:1);
            if(pts.length+extra>MotionEngine.MAX_ROUTE_STOPS)continue;
            if(extra>0){double[][] anchored=new double[pts.length+extra][];int at=0;
                if(start!=null)anchored[at++]=start;for(double[] point:pts)anchored[at++]=point;if(end!=null)anchored[at]=end;pts=anchored;}
            out.add(new RouteInfo(id, r.optString("name", id), r.optBoolean("reversible"),
                r.optDouble("distanceMeters", 0), r.optLong("cooldownFinishMs", 0), pts));
        }
        return out.toArray(new RouteInfo[0]);
    }

    private static double[] parseAnchor(JSONArray a) {
        if(a==null||a.length()!=2)return null;
        double lat=a.optDouble(0,Double.NaN),lon=a.optDouble(1,Double.NaN);
        return Double.isFinite(lat)&&Double.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180?new double[]{lat,lon}:null;
    }

    /** Null means invalid: empty, over the engine bound, or any non-finite/out-of-range coordinate. */
    private double[][] parsePoints(JSONArray pts) {
        if (pts == null || pts.length() < 2 || pts.length() > MotionEngine.MAX_ROUTE_STOPS) return null;
        double[][] out = new double[pts.length()][2];
        for (int i = 0; i < pts.length(); i++) {
            JSONArray pair = pts.optJSONArray(i);
            if (pair == null || pair.length() < 2) return null;
            double lat = pair.optDouble(0, Double.NaN), lon = pair.optDouble(1, Double.NaN);
            if (!Double.isFinite(lat) || !Double.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
            out[i][0] = lat; out[i][1] = lon;
        }
        return out;
    }

    private double distance(double[] p) {
        double r = 6371008.8, dLat = Math.toRadians(p[0] - engine.latitude), dLon = Math.toRadians(p[1] - engine.longitude);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(Math.toRadians(engine.latitude)) * Math.cos(Math.toRadians(p[0])) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
    }

    private static double[][] copy(double[][] in) {
        double[][] out = new double[in.length][2];
        for (int i = 0; i < in.length; i++) { out[i][0] = in[i][0]; out[i][1] = in[i][1]; }
        return out;
    }
    private static double[][] reversed(double[][] in) {
        double[][] out = new double[in.length][2];
        for (int i = 0; i < in.length; i++) { out[i][0] = in[in.length - 1 - i][0]; out[i][1] = in[in.length - 1 - i][1]; }
        return out;
    }
    private static String label(RouteInfo r) { return r.name == null || r.name.isEmpty() ? r.id : r.name; }

    private RouteInfo routeById(String id) { for (RouteInfo r : routes) if (r.id.equals(id)) return r; return null; }

    /** Even sampling that always keeps the first and last point, so the preview still spans start→end. */
    private static JSONArray downsample(double[][] pts, int max) throws JSONException {
        JSONArray arr = new JSONArray();
        int n = pts.length;
        if (n <= max) { for (double[] p : pts) arr.put(pair(p)); return arr; }
        for (int i = 0; i < max; i++) arr.put(pair(pts[(int) Math.round((double) i * (n - 1) / (max - 1))]));
        return arr;
    }
    private static JSONArray pair(double[] p) throws JSONException { JSONArray a = new JSONArray(); a.put(p[0]); a.put(p[1]); return a; }
}
