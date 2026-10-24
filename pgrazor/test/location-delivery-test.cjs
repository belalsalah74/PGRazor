const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync('pgrazor/runtime/location.js','utf8');
let desired=true,active=true,permission=0,now=1000,disposed=false,locked=false;
const queue=[],delivered=[];
const handler={removeCallbacks:r=>{for(let i=queue.length-1;i>=0;i--)if(queue[i]===r)queue.splice(i,1)},post:r=>queue.push(r),postDelayed:r=>queue.push(r)};
function method(fn=()=>{}){const m={call:(self,...args)=>fn(self,...args)};return {overload:()=>m,m};}
const Manager={nativeLocationUpdate:method((self,p,fix,status)=>{if(fix)assert.ok(locked);delivered.push({self,p,fix,status});})};
const Service={invokeOnStart:method(),invokeOnStop:method(),invokeOnPause:method(),invokeOnResume:method(),getServiceHandler:()=>handler};
Manager.class={isInstance:o=>!!o.nativeClassPointer};
const running=3,failed=4,denied=5;
function manager(){
 const m={callbackLock:{value:{}},nativeClassPointer:{value:1},getContext:()=>({checkSelfPermission:()=>permission}),$dispose:()=>m.released=true,$isSameObject:o=>o===m};
 function native(fix,status){const was=locked;locked=true;try{Manager.nativeLocationUpdate.m.call(m,'gps',fix,status);}finally{locked=was;}}
 const original={onProviderStatus:s=>native(null,s),onProviderLocation:f=>native(f,failed),onProviderSatellites:()=>m.satellites=true,$dispose(){}};
 const provider={providerListener:{value:original},getClass:()=>({getName:()=> 'TestProvider'}),getProviderName:()=> 'gps',setListener(l){this.providerListener.value=l;},$isSameObject:o=>o===provider,$dispose(){}};
 m.provider=provider;m.original=original;m.providers={value:{values:()=>({iterator:()=>{let read=false;return {hasNext:()=>!read,next:()=>{read=true;return provider;}};}})}};
 return m;
}
const unityPermission=method(()=>false),pluginPermission=method(()=>false);
const permissionStatus=method(()=>"denied");
const classes={
 'TestProvider':{},'com.nianticlabs.nia.location.NianticLocationProvider$ProviderListener':{},
 'com.nianticlabs.platform.niaadvsynccore.permission.Permissions':{LOCATION:{value:null},PRECISE_LOCATION:{value:null},values(){this.LOCATION.value={getValue:()=>1};this.PRECISE_LOCATION.value={getValue:()=>16};return [this.LOCATION.value,this.PRECISE_LOCATION.value];}},
 'com.nianticlabs.platform.niaadvsynccore.permission.PermissionStatus':{GRANTED_IN_USE:{value:null},GRANTED_ALWAYS:{value:null},values(){this.GRANTED_IN_USE.value='in-use';this.GRANTED_ALWAYS.value='always';return ['in-use','always'];}},
 'com.nianticlabs.platform.niaadvsyncpermissions.internal.InternalPermissionManager':{permissionStatus},
 'com.unity3d.player.UnityPermissions':{hasUserAuthorizedPermission:unityPermission},
 'com.unity3d.plugin.UnityAndroidPermissions':{IsPermissionGranted:pluginPermission},
 'com.nianticlabs.nia.location.NianticLocationManager':Manager,
 'com.nianticlabs.nia.contextservice.ContextService':Service,
 'com.nianticlabs.nia.contextservice.ServiceStatus':{RUNNING:{value:running}},
 'android.location.Location':{$new:p=>{const f={provider:p,$dispose:()=>{}};for(const k of ['Latitude','Longitude','Speed','Bearing','Altitude','Accuracy','Time','ElapsedRealtimeNanos'])f['set'+k]=v=>f[k]=v;return f;}},
 'java.lang.System':{currentTimeMillis:()=>now},'android.os.SystemClock':{elapsedRealtimeNanos:()=>now*1000000},'java.lang.Runnable':{}
};
const ctx={hooks:[],disposed:false,control:{desiredEnabled:()=>desired,active:()=>active,latitude:()=>12,longitude:()=>34,speed:()=>2,bearing:()=>90,event:()=>{}},bootLog:()=>{},Java:{use:n=>{assert.ok(classes[n],n);return classes[n]},retain:o=>o,cast:o=>o,synchronized:(l,f)=>{locked=true;try{f()}finally{locked=false}},registerClass:spec=>({$new:()=>({key:{value:0},$dispose(){},...spec.methods})})}};
vm.createContext(ctx);vm.runInContext(code+'\nconst adapter=PGRazorLocation.create({Java,control,isDisposed:()=>disposed,bootLog});adapter.installPermissions();this.install=adapter.installDelivery;this.stop=adapter.stop;',ctx);ctx.install();
const invoke=(n,m,...args)=>{if(n==='nativeLocationUpdate'){const [,fix,status]=args;return fix===null?m.provider.providerListener.value.onProviderStatus(status):m.provider.providerListener.value.onProviderLocation(fix);}return Service['invoke'+n.slice(0,1).toUpperCase()+n.slice(1)].m.implementation.call(m,...args);};
assert.equal(Manager.nativeLocationUpdate.m.implementation,undefined,'Native method must never be replaced');
function tick(){assert.ok(queue.length);queue.shift().run();}
assert.equal(permissionStatus.m.implementation(1),'in-use');assert.equal(permissionStatus.m.implementation(16),'always');assert.equal(permissionStatus.m.implementation(32),'denied');
desired=false;assert.equal(permissionStatus.m.implementation(1),'denied');desired=true;
const a=manager();
for(const p of ['android.permission.ACCESS_FINE_LOCATION','android.permission.ACCESS_COARSE_LOCATION'])assert.equal(unityPermission.m.implementation({},p),true);
for(const p of ['android.permission.ACCESS_BACKGROUND_LOCATION','android.permission.CAMERA'])assert.equal(unityPermission.m.implementation({},p),false);
assert.equal(pluginPermission.m.implementation(null,'android.permission.ACCESS_FINE_LOCATION'),false);
active=false;assert.equal(unityPermission.m.implementation({},'android.permission.ACCESS_FINE_LOCATION'),true);
desired=false;assert.equal(unityPermission.m.implementation({},'android.permission.ACCESS_FINE_LOCATION'),false);desired=true;active=true;
invoke('onStart',a);tick();assert.equal(delivered.length,1);assert.equal(delivered[0].fix.Latitude,12);assert.equal(delivered[0].fix.Time,1000);
now=2000;tick();assert.equal(delivered[1].fix.Time,2000);assert.equal(delivered[1].fix.ElapsedRealtimeNanos,2000000000);
invoke('nativeLocationUpdate',a,'gps',null,failed);assert.equal(delivered.length,3);
assert.equal(delivered.at(-1).p,'gps');assert.equal(delivered.at(-1).status,running);
const stale={Time:1,Accuracy:500};now=3000;
invoke('nativeLocationUpdate',a,'gps',stale,failed);
assert.notEqual(delivered.at(-1).fix,stale);assert.equal(delivered.at(-1).fix.Time,3000);assert.equal(delivered.at(-1).fix.Accuracy,5);assert.equal(stale.Time,1);
invoke('nativeLocationUpdate',a,'gps',null,denied);assert.equal(delivered.at(-1).status,running);
let count=delivered.length;
active=false;tick();assert.equal(delivered.length,count);invoke('nativeLocationUpdate',a,'gps',null,failed);assert.equal(delivered.at(-1).status,failed);
// OFF leaves actual location objects and status untouched.
locked=true;invoke('nativeLocationUpdate',a,'gps',stale,failed);locked=false;assert.equal(delivered.at(-1).fix,stale);
active=true;permission=-1;count=delivered.length;tick();assert.equal(delivered.length,count+1);
active=false;invoke('nativeLocationUpdate',a,'gps',null,denied);assert.equal(delivered.at(-1).status,denied);active=true;count=delivered.length;
invoke('onPause',a);assert.equal(queue.length,0);invoke('onResume',a);tick();assert.equal(delivered.length,count+1);
a.nativeClassPointer.value=0;count=delivered.length;tick();assert.equal(delivered.length,count);
const b=manager();invoke('onStart',b);assert.ok(a.released);assert.equal(queue.length,1);tick();assert.equal(delivered.at(-1).self,b);
assert.equal(a.provider.providerListener.value,a.original,'Old provider listener restored on replacement');
invoke('onStop',a);assert.equal(queue.length,1);invoke('onStop',b);assert.equal(queue.length,0);assert.ok(b.released);assert.equal(b.provider.providerListener.value,b.original);
b.provider.providerListener.value.onProviderSatellites(1,[]);assert.ok(b.satellites);
invoke('onStart',manager());ctx.stop();assert.equal(queue.length,0);for(const v of [...Object.values(Manager),...Object.values(Service)])if(v.m&&v!==Manager.nativeLocationUpdate)assert.equal(v.m.implementation,null);
assert.equal(unityPermission.m.implementation,null);assert.equal(pluginPermission.m.implementation,null);assert.equal(permissionStatus.m.implementation,null);
ctx.stop(); // Disposal is idempotent.
console.log('PASS location delivery: GPS-independent start, fresh fixes, OFF gate and denied OS permission, pause/resume, zero pointer, manager replacement, stop and rollback');
