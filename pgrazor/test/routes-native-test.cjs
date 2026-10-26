// Unit tests for the native Routes module's host-independent logic: command
// parsing, bounded snapshot shaping, the sequence/replay/lease gate, and the
// controller's bridge surface + failure isolation. The managed il2cpp paths are
// pending coordinator on-device validation and are not exercised here; instead
// we prove the module fails closed (reports waiting, never throws) when native
// metadata cannot be built.
const assert=require('node:assert/strict');
const routes=require('../runtime/features/routes.js');
const {parseCommand,boundSnapshot,createGate,createController,LIMITS}=routes;

// ---- parseCommand ----
assert.equal(parseCommand('').ok,false);
assert.equal(parseCommand('not json').ok,false);
assert.equal(parseCommand(JSON.stringify({seq:0,action:'discover'})).reason,'bad-seq');
assert.equal(parseCommand(JSON.stringify({seq:1.5,action:'discover'})).reason,'bad-seq');
assert.equal(parseCommand(JSON.stringify({seq:1,action:'noop'})).reason,'bad-action');
assert.equal(parseCommand(JSON.stringify({seq:1,action:'start'})).reason,'id-required');
assert.equal(parseCommand(JSON.stringify({seq:1,action:'complete'})).reason,'id-required');
assert.equal(parseCommand(JSON.stringify({seq:2,action:'start',id:'r1',reversed:'yes'})).reason,'bad-reversed');
{
 const ok=parseCommand(JSON.stringify({seq:3,action:'start',id:'r1',reversed:true}));
 assert.equal(ok.ok,true);assert.equal(ok.command.seq,3);assert.equal(ok.command.id,'r1');assert.equal(ok.command.reversed,true);
}
assert.equal(parseCommand(JSON.stringify({seq:4,action:'discover'})).ok,true);
assert.equal(parseCommand(JSON.stringify({seq:5,action:'pause'})).ok,true);

// ---- boundSnapshot ----
{
 const many=[];for(let i=0;i<150;i++)many.push({id:'r'+i,points:[[1,2],[2,3]]});
 const shaped=boundSnapshot(many);
 assert.equal(shaped.length,LIMITS.routesMax);
 const pts=[];for(let i=0;i<LIMITS.pointsMax+50;i++)pts.push([1,2]);
 const one=boundSnapshot([{id:'x',name:'N',reversible:true,distanceMeters:12,cooldownFinishMs:99,points:pts}]);
 assert.equal(one.length,0,'oversized paths rejected, never truncated');
 // junk entries and malformed points are dropped, not faked
 const mixed=boundSnapshot([{id:''},{noId:true},{id:'ok',points:[[1,2],[NaN,3],[4],'bad']}]);
 assert.equal(mixed.length,0,'invalid points reject the entire path');
 assert.equal(boundSnapshot([{id:'bad-lat',points:[[91,0],[0,0]]}]).length,0);
}

// ---- gate: sequencing, replay, lease ----
{
 const g=createGate(100);
 // not allowed -> never accepts, clears pending
 assert.equal(g.set(false,parseCommand(JSON.stringify({seq:1,action:'discover'})),1000).ok,false);
 assert.equal(g.set(true,parseCommand(JSON.stringify({seq:1,action:'discover'})),1000).ok,true);
 // replay / stale sequence rejected
 assert.equal(g.set(true,parseCommand(JSON.stringify({seq:1,action:'discover'})),1000).reason,'stale-seq');
 assert.equal(g.set(true,parseCommand(JSON.stringify({seq:0,action:'pause'})),1000).reason,'bad-seq');
 // take consumes once (no retry)
 const first=g.take(1050);assert.equal(first.command.seq,1);assert.ok(!first.expired);
 assert.equal(g.take(1050),null);
 // lease active window
 assert.equal(g.leaseActive(1050),true);assert.equal(g.leaseActive(1200),false);
 // a command taken after the lease expired is flagged, not executed
 assert.equal(g.set(true,parseCommand(JSON.stringify({seq:2,action:'start',id:'r'})),1000).ok,true);
 const stale=g.take(2000);assert.equal(stale.expired,true);assert.equal(stale.command.seq,2);
}

// ---- gate: a revoked lease dooms the pending command (no silent drop, no replay) ----
{
 const g=createGate(100);
 assert.equal(g.set(true,parseCommand(JSON.stringify({seq:1,action:'start',id:'r'})),1000).ok,true);
 // lease revoked before the command was taken: pending is retained, not dropped
 assert.equal(g.set(false,null,1010).ok,false);
 // re-granting the lease (even well within a fresh window) must NOT replay it:
 // the same seq is now stale, and the doomed command stays cancelled
 assert.equal(g.set(true,parseCommand(JSON.stringify({seq:1,action:'start',id:'r'})),1020).reason,'stale-seq');
 // draining yields an expired ack despite the lease being active, so Java gets an
 // ack instead of a 30s mailbox timeout, and the mutation never executes
 assert.equal(g.leaseActive(1030),true);
 const drained=g.take(1030);
 assert.equal(drained.command.seq,1);assert.equal(drained.expired,true);
 // once drained it is gone for good — no retry, no replay on later ticks
 assert.equal(g.take(1040),null);
}

// ---- controller bridge surface + failure isolation ----
{
 const events=[];let time=5000;
 const nul={isNull:()=>true,add:()=>nul,readU8:()=>0};
 const host={
  api:{domain_get:()=>nul,thread_current:()=>nul},
  module:{base:{add:()=>nul}},Memory:{alloc:()=>({writeU64(){},writeU8(){},writePointer(){},readPointer:()=>nul})},
  ptr:()=>nul,Interceptor:{attach:()=>({detach(){}})},
  event:(k,f)=>events.push([k,f]),now:()=>time,
  hold:()=>({}),target:()=>nul,freeHandle:()=>{},invoke:()=>nul,exact:()=>false,readPtr:()=>nul,
  unity:()=>false,addListener:()=>{},isStopping:()=>false};
 const c=createController(host);
 // setOptions records intent without touching native
 assert.deepEqual(c.setOptions(false,'{}'),{status:'off'});
 assert.equal(c.setOptions(true,'bogus').status,'rejected');
 const acc=c.setOptions(true,JSON.stringify({seq:10,action:'discover'}));
 assert.equal(acc.status,'accepted');assert.equal(acc.seq,10);
 // replay of same sequence is rejected at the gate
 assert.equal(c.setOptions(true,JSON.stringify({seq:10,action:'discover'})).status,'rejected');
 // tick with un-buildable metadata must not throw and must report waiting, not ready
 assert.doesNotThrow(()=>c.tick(time));
 const ready=events.filter(e=>e[0]==='routes-ready');
 assert.ok(ready.length>=1);
 assert.equal(ready[ready.length-1][1].available,false);
 // readiness event is de-duplicated across repeated failing ticks
 const before=events.filter(e=>e[0]==='routes-ready').length;
 c.tick(time);
 assert.equal(events.filter(e=>e[0]==='routes-ready').length,before);
 assert.doesNotThrow(()=>c.release());
}

console.log('Routes native module tests passed');

{ const g=createGate(100); g.set(true,parseCommand('{"seq":1,"action":"start","id":"r"}'),0); g.set(true,parseCommand(''),1); assert.equal(g.take(2).expired,true,'clearing Java command cancels native pending command'); }
