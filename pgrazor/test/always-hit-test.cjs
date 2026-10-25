const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../diagnostics/quick-ball.js'),'utf8');
const start=source.indexOf(' if(p.alwaysHit.available){'),end=source.indexOf(' if(p.throws.available)for',start);
assert(start>0&&end>start);
function fixture(){
 const calls=[],events=[],hooks={},replacements={};let time=10,thread=7;
 class P{constructor(v){this.v=v;}isNull(){return this.v===0;}equals(o){return this===o||this.v===o.v;}toString(){return String(this.v);}toUInt32(){return this.v>>>0;}}
 const obj=(id,klass,fields={})=>Object.assign(new P(id),{klass,fields}),nil=new P(0);
 const h={machine:'machine',action:'action',current:'current',state:'state',flying:'flying',falling:'falling',pokemon:'pokemon',hit:'hit',item:'item'};
 for(const n of ['invoke','collision','trigger','launch','release','makeThrow'])h[n]={address:n,method:n};
 const flying=obj('fly','state'),falling=obj('fall','state'),other=obj('other','state'),machine=obj('machine','machine',{current:flying});
 const ball=obj('ball','ball',{state:machine,flying,falling,pokemon:obj('pokemon','pokemon'),hit:obj('hit','action'),item:2,bread:0});
 const s={listeners:[],active:true,stopping:false,alwaysHitFault:false,throwAlwaysHit:true,throwUntil:100,now:()=>time};
 const c={s,p:{alwaysHit:{available:true,...h}},classes:{BALL:'ball'},BALL:'BALL',fields:{bread:'bread'},
  Process:{getCurrentThreadId:()=>thread},unity:t=>t===7,
  exact:(o,k)=>!o.isNull()&&o.klass===k,field:(o,k)=>o.fields[k],invoke:()=>calls.push('hit'),event:(s,k)=>events.push(k),ptr:v=>new P(v),
  NativeFunction:function(address){return ()=>calls.push('original:'+address);},NativeCallback:function(f){return f;},
  Interceptor:{attach(address,callbacks){hooks[address]=callbacks;return{detach(){delete hooks[address];}};},replace(a,f){replacements[a]=f;},revert(a){delete replacements[a];}}};
 vm.runInNewContext(source.slice(start,end),c);
 return{s,h,ball,machine,flying,falling,other,nil,calls,events,hooks,replacements,advance:n=>time+=n,thread:n=>thread=n,
  collide:()=>replacements.collision(ball,nil,nil),release:()=>hooks.release.onEnter([ball]),
  flags(flags){const context={x1:new P(flags)},call={context};hooks.makeThrow.onEnter.call(call,[ball]);hooks.makeThrow.onLeave.call(call);return context.x1.toUInt32();}};
}
let f=fixture();f.collide();f.collide();assert.deepEqual(f.calls,['hit'],'One hit per release despite repeated collisions');
f.machine.fields.current=f.other;f.collide();assert.equal(f.calls.at(-1),'original:collision','Post-hit physics continue normally');
f.machine.fields.current=f.flying;f.release();f.collide();assert.equal(f.calls.filter(x=>x==='hit').length,2,'Breakout/retry allows a fresh hit');
assert.equal(f.flags(0x10101),0x101,'Miss conversion preserves curve and bullseye');assert.equal(f.flags(0x100),0x100,'Clean throw unchanged');
f.s.throwAlwaysHit=false;assert.equal(f.flags(0x10000),0x10000);f.collide();assert.equal(f.calls.at(-1),'original:collision','Off restores collision');
f=fixture();f.advance(100);f.collide();assert.deepEqual(f.calls,['original:collision'],'Expired lease cannot force a hit');
f=fixture();f.thread(8);f.collide();assert.deepEqual(f.calls,['original:collision'],'Other threads cannot force a hit');
for(const [key,value]of [['bread',1],['item',4]]){f=fixture();f.ball.fields[key]=value;f.collide();assert.deepEqual(f.calls,['original:collision'],'Special balls unchanged');}
f=fixture();f.ball.fields.hit=f.nil;f.collide();assert.deepEqual(f.calls,['original:collision'],'Missing subscriber falls back');
f=fixture();f.machine.fields.current=f.other;f.collide();assert.deepEqual(f.calls,['original:collision'],'Held/inactive/captured states unchanged');
f=fixture();f.release();assert.deepEqual(f.calls,[],'Releasing never creates an automatic throw');
console.log('PASS Always Hit: collision dedup, retry, post-hit physics, missed flags, OFF, lease, thread, special balls, missing callback and state guards');
