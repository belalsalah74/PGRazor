package dev.pgrazor;

import org.json.JSONObject;

/** Regressions for mailbox polling and cancellation between native acknowledgements. */
public final class GameRoutesBridgeTest {
    static final String SNAPSHOT="{\"routes\":[{\"id\":\"a\",\"name\":\"A\",\"reversible\":false,\"distanceMeters\":500,\"points\":[[0,0],[0,0.005]]}],\"current\":null}";
    static final class Fixture {
        long now=1000;
        final MotionEngine engine=new MotionEngine();
        final GameRoutesController controller=new GameRoutesController(engine,()->now,()->1000000);
        Fixture(){engine.position(0,0);engine.speed(5);controller.setReady(true);controller.acceptSnapshot(SNAPSHOT);}
        void started() throws Exception {
            controller.start(1);controller.tick(true);
            String command=controller.command();
            check(new JSONObject(command).getString("action").equals("start"),"start queued");
            controller.acceptAction("{\"seq\":"+new JSONObject(command).getInt("seq")+",\"status\":\"submitted\"}");
            controller.acceptSnapshot(SNAPSHOT.replace("\"current\":null","\"current\":{\"id\":\"a\",\"started\":true}"));
            controller.tick(true);
        }
    }
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    public static void main(String[] args) throws Exception {
        Fixture f=new Fixture();f.controller.setPlanning(true);
        String command=f.controller.command();
        check(!command.isEmpty()&&command.equals(f.controller.command()),"host polls must not consume a command before guest receives it");
        int seq=new JSONObject(command).getInt("seq");
        f.controller.acceptAction("{\"seq\":"+seq+",\"status\":\"submitted\"}");
        check(f.controller.command().isEmpty(),"acknowledgement retires command");
        f=new Fixture();f.controller.start(1);f.controller.tick(true);f.controller.stop("cancelled");
        check(f.controller.command().isEmpty(),"cancellation discards unsent gameplay commands");
        f=new Fixture();f.now+=25000;f.controller.start(1);
        check(!f.controller.running()&&!f.engine.walking,"stale discovery cannot start movement");
        f=new Fixture();f.started();f.now+=25000;f.controller.tick(true);
        check(!f.controller.running()&&!f.engine.walking,"stale game state stops movement");
        f=new Fixture();f.controller.start(1);f.controller.tick(true);f.engine.input(1,0);f.controller.tick(true);
        check(!f.controller.running(),"manual input cancels even between start request and acknowledgement");
        check(f.engine.metersPerSecond()>0,"cancelling automation preserves manual input");
        f=new Fixture();f.started();
        f.controller.acceptSnapshot(SNAPSHOT.replace("\"current\":null","\"current\":{\"id\":\"different\",\"started\":true}"));
        f.controller.tick(true);
        check(!f.controller.running()&&!f.engine.walking,"a different in-game Route cannot inherit automation");
        f=new Fixture();check(!f.controller.acceptSnapshot("{}"),"missing current/routes is not an authoritative empty snapshot");
        f=new Fixture();f.started();
        f.controller.acceptSnapshot(SNAPSHOT.replace("\"current\":null","\"current\":{\"id\":\"a\",\"started\":true,\"completedWalk\":true,\"inRangeOfEnd\":true}"));
        f.controller.tick(true);
        check(!f.engine.walking,"stop at authoritative completion range before final path point");
        check(new JSONObject(f.controller.command()).getString("action").equals("complete"),"complete without overshooting endpoint");
        f.controller.tick(true);check(f.controller.running(),"own stop does not look like manual takeover");
        f=new Fixture();
        String completed=SNAPSHOT.replace("\"current\":null","\"current\":{\"id\":\"a\",\"started\":true,\"completedWalk\":true}");
        f.controller.acceptSnapshot(completed);f.controller.start(1);
        check(f.controller.running()&&f.engine.walking,"explicit start recovers an unrewarded completed walk");
        check(f.controller.command().isEmpty(),"recovery must not start a second native Route");
        f.controller.acceptSnapshot(completed.replace("\"completedWalk\":true","\"completedWalk\":true,\"inRangeOfEnd\":true"));f.controller.tick(true);
        int completionSeq=new JSONObject(f.controller.command()).getInt("seq");
        f.controller.acceptAction("{\"seq\":"+completionSeq+",\"status\":\"submitted\"}");
        f.controller.acceptSnapshot(completed.replace("\"completedWalk\":true","\"completedWalk\":true,\"acquiredReward\":true"));f.controller.tick(true);
        check(!f.controller.running()&&f.controller.status().contains("1 route"),"only confirmed reward counts a completion");
        f=new Fixture();f.started();
        f.controller.acceptSnapshot(SNAPSHOT.replace("\"current\":null","\"current\":{\"id\":\"a\",\"started\":true,\"completedWalk\":true,\"inRangeOfEnd\":true}"));f.controller.tick(true);
        completionSeq=new JSONObject(f.controller.command()).getInt("seq");
        f.controller.setPlanning(false);f.controller.setPlanning(true);
        check(new JSONObject(f.controller.command()).getInt("seq")==completionSeq,"opening dialog cannot replace completion request with discovery");
        f.controller.acceptSnapshot(SNAPSHOT);f.controller.tick(true);
        check(f.controller.running(),"disappearance alone is not completion");
        JSONObject done=new JSONObject(SNAPSHOT);done.put("completion",new JSONObject().put("id","a").put("seq",completionSeq-1));
        f.controller.acceptSnapshot(done.toString());f.controller.tick(true);
        check(f.controller.running(),"old response cannot complete a new request");
        done.getJSONObject("completion").put("seq",completionSeq);
        f.controller.acceptSnapshot(done.toString());f.controller.tick(true);
        check(!f.controller.running()&&f.controller.status().contains("1 route"),"matching server response survives current-route clearing");
        f=new Fixture();JSONObject ranked=new JSONObject(SNAPSHOT);
        ranked.getJSONArray("routes").put(new JSONObject("{\"id\":\"long\",\"name\":\"Long\",\"distanceMeters\":4300,\"points\":[[0,0],[0,0.04]]}"));
        f.controller.acceptSnapshot(ranked.toString());f.controller.start(1);f.controller.tick(true);
        check(new JSONObject(f.controller.command()).getString("id").equals("a"),"minimize total travel rather than choosing a long route at the same start");
        System.out.println("Route mailbox/cancellation regressions passed");
    }
}
