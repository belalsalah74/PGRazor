const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const feature=require('./feature-fixture.cjs');
function fixture(mode){let now=1000;const calls=[],hooks=new Map(),handles=new Set();const nil={isNull:()=>true},obj=(k,f={})=>({k,f,isNull:()=>false,equals(o){return this===o;}});const types={9308:'legacyCharge',9182:'legacyGesture',31285:'maxGesture',31499:'raidGesture',31280:'maxWidget',44226:'battleState',31623:'raidWarning',31263:'maxWarning'};const g=obj(mode===1?'legacyGesture':mode===2?'maxGesture':'raidGesture',{director:obj('director'),tap:obj('tap'),flick:obj('flick'),enabled:1}),button=obj('button',{interactable:1}),charge=obj(mode===1?'legacyCharge':'charge',{button,charged:1,visible:1}),max=obj('maxWidget',{button,maxType:7}),scope=obj('scope'+mode);
 const state=obj('battleState',{status:1});const names=['currentState','raidFastAction','destroy','enable','disable','buttons','raidFast','maxFast','legacyEnable','legacyDisable','legacyButtons','legacyFast','legacyInit','legacyCharged','legacyCharge','maxRefresh','maxCleanup','active','press','dodge','legacyDodge','raidWarning','gymWarning','maxWarning'];const methods=Object.fromEntries(names.map(n=>[n,{method:n,address:n}]));const scopes=[0,1,2].map(i=>({mode:i,klass:'scope'+i,enter:{address:'enter'+i},exit:{address:'exit'+i}}));
 const s={now:()=>now,battleMask:127,battleLease:10000,listeners:[],stopping:false},rocket={state:null};
 const ctx={s,rocketState:rocket,BATTLE_TYPES:types,RVCHARGE:'charge',classes:Object.fromEntries([...Object.values(types),'charge'].map(n=>[n,n])),p:{battles:{scopes,swaps:[{mode,klass:'swap',open:{address:'swapOpen'},close:[{address:'swapClose'}],show:{method:'show'}}],methods,statusActive:1,statusUnset:0,dodgeLeft:1,gymIterator:"gymIterator",gymWarningState:"state",maxAttack:7,fields:{director:'director',battleStatus:'status',legacyFlick:'flick',legacyTap:'tap',legacyButton:'button',maxButton:'button',maxType:'maxType',maxGesture:'gesture'}},rocket:{methods:{interactable:{method:'interactable'}},vnext:{fields:{tap:'tap',enabled:'enabled',button:'button'},methods:{observe:{address:'observe'},charged:{method:'charged'},visible:{method:'visible'},charge:{method:'charge'}}}}},unity:()=>true,hold:o=>{handles.add(o);return o;},freeHandle:o=>handles.delete(o),target:o=>o,alive:o=>!o.dead,exact:(o,k)=>o.k===k,readS32:(o,f)=>o.f[f],readPtr:(o,f)=>o.f[f]||nil,present:(o,f)=>!!o.f[f],rocketBool:(m,o)=>m.method==='active'?!o.disabled:m.method==='legacyCharged'?!!o.f.charged:!!o.f[m.method],ptr:()=>nil,Memory:{alloc:()=>({writePointer(){},writeS32(){},add(){return this;}})},invoke:m=>{if(m==='currentState')return state;calls.push(m);return nil;},event:()=>{},Interceptor:{attach:(a,h)=>{hooks.set(a,h);return{};}}};ctx.tick=feature('battles',ctx).tick;const hook=(n,args)=>{const c={threadId:1},h=hooks.get(n);h.onEnter.call(c,args);if(h.onLeave)h.onLeave.call(c,{toInt32:()=>0});};
 return{s,state,scope,rocket,calls,handles,g,charge,max,hook,obj,cue(){hook(mode===0?"raidWarning":mode===1?"gymWarning":"maxWarning",[obj(mode===0?"raidWarning":mode===1?"gymIterator":"maxWarning",{state:1})]);},advance(ms){now+=ms;},tick(){ctx.tick(now);now+=1000;},enter(){hook('enter'+mode,[scope]);hook(mode===1?'legacyEnable':'enable',[g]);hook(mode===1?'legacyInit':'observe',[charge]);if(mode===2)hook('maxRefresh',[max]);},exit(){hook('exit'+mode,[scope]);}};
}
for(let mode=0;mode<3;mode++){const f=fixture(mode);f.tick();assert.equal(f.calls.length,0);f.enter();f.s.battleMask=1<<(mode*2);f.tick();assert.deepEqual(f.calls,[mode===0?'raidFastAction':mode===1?'legacyFast':'maxFast']);f.s.battleMask=2<<(mode*2);f.charge.f.charged=0;f.tick();assert.equal(f.calls.length,1);f.charge.f.charged=1;f.tick();assert.equal(f.calls[1],mode===1?'legacyCharge':'charge');f.s.battleLease=0;f.tick();assert.equal(f.calls.length,2);f.exit();assert.equal(f.handles.size,0);}
{const f=fixture(2);f.enter();f.s.battleMask=64;f.max.f.maxType=8;f.tick();assert.equal(f.calls.length,0);f.max.f.maxType=7;f.tick();assert.deepEqual(f.calls,['press']);f.rocket.state={};f.tick();assert.equal(f.calls.length,1);f.s.stopping=true;f.tick();assert.equal(f.handles.size,0);}
{const f=fixture(0);f.enter();f.s.battleMask=12;f.tick();assert.equal(f.calls.length,0);f.exit();}
console.log('PASS other battles: isolated mode options/scope, native quick/charge, energy gate, Max attack excludes other moves, Rocket exclusion, lease/stop cleanup');

for(let mode=0;mode<3;mode++){const f=fixture(mode);f.enter();f.s.battleMask|=128<<mode;f.cue();f.tick();assert.equal(f.calls[0],mode===1?'legacyDodge':'dodge');f.tick();assert.notEqual(f.calls[1],'dodge');f.cue();f.s.battleMask=0;f.tick();assert.equal(f.calls.length,2);f.s.battleMask=128<<mode;f.cue();f.advance(451);f.tick();assert.equal(f.calls.length,2);f.cue();f.exit();f.tick();assert.equal(f.calls.length,2);assert.equal(f.handles.size,0);}
console.log('PASS dodge: all modes, warning priority, no repeated swipe, off/expiry/scope cleanup');

for(const mode of [0,2]){for(const status of [2,3,4,5,6]){const f=fixture(mode);f.enter();f.s.battleMask|=128<<mode;f.cue();f.state.f.status=status;f.tick();assert.equal(f.calls.length,0,'terminal status must precede dodge and charged attack');assert.equal(f.handles.size,0);f.tick();assert.equal(f.calls.length,0);}}
{const f=fixture(0);f.enter();f.state.f.status=0;f.tick();assert.equal(f.calls.length,0);f.state.f.status=1;f.tick();assert.equal(f.calls.length,1);f.hook('destroy',[f.g]);f.tick();assert.equal(f.calls.length,1);}
console.log('PASS victory/defeat/timeout/quit/error, pre-battle and destroyed gesture suppress all automated actions');

// All battle actions yield to a real picker, even if gesture/input flags stay enabled.
for(let mode=0;mode<3;mode++){
 const f=fixture(mode);f.enter();const swap=f.obj('swap',{show:1});
 f.s.battleMask=(3<<(mode*2))|(128<<mode)|(mode===2?64:0);
 f.hook('swapOpen',[swap]);f.cue();f.tick();f.tick();f.tick();
 assert.equal(f.calls.length,0,'open picker blocks fast/charged/Max/dodge in mode '+mode);
 f.hook('swapClose',[swap]);f.tick();assert.equal(f.calls.length,0,'close grace');
 f.tick();assert.equal(f.calls.length,1,'resume after close');assert.notEqual(f.calls[0],'dodge','discard stale dodge');
 f.hook('swapOpen',[swap]);f.advance(700);swap.f.show=0;f.tick();assert.equal(f.calls.length,1,'implicit close yields one last grace');
 f.tick();assert.equal(f.calls.length,2,'resume after implicit close');
 f.hook('swapOpen',[swap]);f.exit();assert.equal(f.handles.size,0,'scope exit releases picker root');
}
console.log('PASS manual picker: gym/raid/Max all actions yield, explicit and implicit close resume, stale dodge discarded, roots released');

// Dynamax's injected handler may be initialized before EnterState fires.
{const f=fixture(2);f.scope.f.gesture=f.g;f.hook('enter2',[f.scope]);f.s.battleMask=16;f.tick();assert.deepEqual(f.calls,['maxFast']);f.hook('observe',[f.charge]);f.s.battleMask=32;f.tick();assert.deepEqual(f.calls,['maxFast','charge']);f.exit();assert.equal(f.handles.size,0);}
{const f=fixture(2);f.scope.f.gesture=f.g;f.g.disabled=true;f.hook('enter2',[f.scope]);f.tick();assert.equal(f.calls.length,0);f.g.disabled=false;f.tick();assert.equal(f.calls.length,1);f.exit();assert.equal(f.handles.size,0);}
console.log('PASS Dynamax scope-owned input recovery without setup callbacks; inactive handlers yield');
