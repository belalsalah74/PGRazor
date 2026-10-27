// Exercise the real account bridge with synthetic managed objects; no game data or credentials.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../runtime/features/accounts.js'),'utf8');
function fixture(capture=true){
 const zero={isNull:()=>true,equals:o=>o===zero};
 const pointer=extra=>Object.assign({isNull:()=>false,equals(o){return o===this;}},extra);
 const cell=()=>pointer({value:0,writePointer(v){this.value=v;},writeU64(v){this.value=v;},readU64(){return {toNumber:()=>this.value};},readS32(){return this.value;}});
 const classes=new Map(),methods=new Map(),fields=new Map(),addresses=new Map(),events=[],handles=new Map();
 const cls=name=>{if(!classes.has(name))classes.set(name,pointer({name}));return classes.get(name);};
 const names=['Niantic.Holoholo.PlayerService','Niantic.Holoholo.IPlayerService','Niantic.Platform.Auth.AuthService','Niantic.Platform.Auth.IAuthService','Niantic.Holoholo.Login.AuthServiceLogOutWrapper','Niantic.Holoholo.Login.IAuthServiceLogOutWrapper','Niantic.Platform.Promises.Future','Niantic.Platform.Promises.PromiseStatus'];
 names.forEach(cls);
 cls('UnityEngine.PlayerPrefs');
 const preferences=new Map([['4b9b44d8-66f5-46dc-86bb-0215bfa90f5e','synthetic-dob'],['80a6f7e6-1a8d-442e-bd95-74c795242b3f',true],['unrelated-game-setting',42]]);
 // Pin lookup is incidental to these state tests; construct the metadata declared by the module.
 for(const match of source.matchAll(/method\((\w+),'([^']+)',(\d+),(\d+),'([0-9a-f]+)'\)/g)){
  const owner=cls({player:names[0],auth:names[2],wrapper:names[4],prefs:'UnityEngine.PlayerPrefs'}[match[1]]);
  const address=pointer({readByteArray:()=>Buffer.from(match[5],'hex')});addresses.set(+match[4],address);
  methods.set(owner.name+':'+match[2],pointer({owner,name:match[2],readPointer:()=>address}));
 }
 for(const [name,offset]of [['_status',0x40],['_isDisposed',0x30]])fields.set(name,pointer({owner:cls(names[6]),offset}));
 fields.set('activeAuthProvider',pointer({owner:cls(names[2]),offset:0x98}));
 fields.set('CompletedSucceeded',pointer({value:2}));fields.set('CompletedFailed',pointer({value:1}));
 let now=1000,connected=true,logoutCount=0,hook,nextHandle=1,disposed=false,status=0,cached=true,provider=true;
 const auth=pointer({klass:cls(names[2]),add:()=>({readPointer:()=>provider?auth:zero})}),player=pointer({klass:cls(names[0])}),wrapper=pointer({klass:cls(names[4])});
 const future=pointer({klass:cls(names[6]),add:offset=>({readU8:()=>disposed?1:0,readS32:()=>status})});
 const str=value=>pointer({value});
 const api={domain_get:()=>zero,domain_get_assemblies:(_,n)=>{n.value=1;return pointer({add:()=>({readPointer:()=>zero})});},
  assembly_get_image:()=>zero,class_from_name:(_,ns,name)=>classes.get(ns+'.'+name)||zero,
  class_get_method_from_name:(k,name)=>methods.get(k.name+':'+name)||zero,method_get_class:m=>m.owner,
  class_get_field_from_name:(_,name)=>fields.get(name)||zero,field_get_parent:f=>f.owner,field_get_offset:f=>f.offset,
  field_get_flags:()=>0x8050,field_static_get_value:(f,v)=>v.value=f.value,
  string_new:str,string_length:o=>o.value.length,string_chars:o=>({readUtf16String:()=>o.value}),object_unbox:o=>({readU8:()=>o.value?1:0})};
 const h={api,ptr:()=>zero,Memory:{alloc:cell,allocUtf8String:s=>s},Interceptor:{attach:(_,callbacks)=>{hook=callbacks;return {}; }},
  module:{base:{add:n=>addresses.get(n)}},now:()=>now,unity:tid=>tid===7,
  exact:(o,k)=>!!o&&o.klass===k,hold:o=>{const id=nextHandle++;handles.set(id,o);return id;},target:id=>handles.get(id)||zero,freeHandle:id=>handles.delete(id),
  event:(kind,data)=>events.push({kind,data}),addListener:()=>{},resolve:k=>({[names[1]]:player,[names[3]]:auth,[names[5]]:wrapper}[k.name]||zero),
  invoke:(method,o,args)=>{
   if(method.name==='DeleteKey'){preferences.delete(args.value.value);return zero;}
   if(method.name==='HasKey')return pointer({value:preferences.has(args.value.value)});
   if(method.name==='Save')return zero;
   if(method.name==='get_IsConnected')return {value:connected,isNull:()=>false};
   if(method.name==='get_CachedCredentialsExist')return {value:cached,isNull:()=>false};
   if(method.name==='get_PlayerId')return str('synthetic-player');
   if(method.name==='get_PlayerName')return str('Synthetic');
   if(method.name==='Logout'){logoutCount++;if(capture){const invocation={};hook.onEnter.call(invocation,[auth]);hook.onLeave.call(invocation,future);}return zero;}
   throw Error('Unexpected method');
  }};
 const context={};vm.createContext(context);vm.runInContext(source,context);const bridge=context.PGRazorAccounts.create(h);
 return {events,handles,preferences,bridge,tick(delta=250,tid=7){now+=delta;bridge.tick(now,tid);},options(command=''){bridge.setOptions(true,command);},
  connected:v=>connected=v,cached:v=>cached=v,provider:v=>provider=v,status:v=>status=v,disposed:v=>disposed=v,logoutCount:()=>logoutCount};
}
{
 const f=fixture(false);f.options('no-nested-hook');f.tick();f.connected(false);f.tick();
 assert.equal(f.events.filter(e=>e.kind==='account-logout-complete').length,0,'disconnect alone is insufficient');
 f.provider(false);f.tick();assert.equal(f.events.filter(e=>e.kind==='account-logout-complete').length,0,'cached login must be cleared');
 f.cached(false);f.tick();assert.equal(f.events.filter(e=>e.kind==='account-logout-complete').length,1);
 assert.equal(f.handles.size,0,'state-confirmed logout releases roots');
}
{
 const f=fixture();f.tick();assert.equal(f.events.filter(e=>e.kind==='account-identity').length,0);
 f.options();f.tick(250,8);assert.equal(f.events.filter(e=>e.kind==='account-identity').length,0);
 f.connected(false);f.tick();assert.equal(f.events.filter(e=>e.kind==='account-identity').length,0);
 f.connected(true);f.tick();assert.equal(f.events.filter(e=>e.kind==='account-identity').length,1);
 f.options('request-a');f.tick();assert.equal(f.logoutCount(),1);
 f.tick();assert.equal(f.logoutCount(),1);
 f.status(2);f.tick();assert.equal(f.events.filter(e=>e.kind==='account-logout-complete').length,0);
 f.connected(false);f.tick();assert.equal(f.events.filter(e=>e.kind==='account-logout-complete').length,1);
 assert.equal(f.handles.size,0,'completed logout releases managed roots');
}
for(const failure of ['failed','disposed','timeout']){
 const f=fixture();f.options('request');f.tick();
 if(failure==='failed')f.status(1);
 if(failure==='disposed')f.disposed(true);
 f.tick(failure==='timeout'?16000:250);
 assert.equal(f.events.filter(e=>e.kind==='account-logout-failed').length,1,failure);
 assert.equal(f.events.filter(e=>e.kind==='account-logout-complete').length,0,failure);
 assert.equal(f.handles.size,0,failure+' releases roots');
}
{
 const f=fixture();f.options('reset-login:request');f.tick();
 assert.equal(f.events.filter(e=>e.kind==='account-login-reset-complete').length,1);
 assert.deepEqual([...f.preferences],[['unrelated-game-setting',42]],'reset only removes DOB and cached age result');
 assert.equal(f.logoutCount(),0,'reset never signs out a provider');
 assert.equal(f.handles.size,0,'reset releases managed strings');
}
{
 const f=fixture();f.options('save-session:request');f.tick();f.tick();
 assert.equal(f.events.filter(e=>e.kind==='account-session-saved').length,1);
 assert.equal(f.logoutCount(),0,'remembered switching must not revoke the session');
 assert.equal(f.preferences.size,3,'session save preserves all existing preferences');
}
console.log('PASS: account identity/lease/Unity gates, logout confirmation, session save, failed/disposed/timeout cleanup');
