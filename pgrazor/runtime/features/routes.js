// Experimental, supported ARM64 build only. No native work on load. Optional
// feature: every failure is contained so the host (quick-close) and its other
// features keep running. Native live acceptance is pending coordinator on-device
// validation; this module only drives the game's own RouteConsumptionService and
// RoutesService through metadata-validated methods, never raw RPC construction.
//
// Scope (see .artifacts/route-research/ROUTE_FARMING_RESEARCH.txt and the
// fields.txt / methods.txt / lifecycle-code.json extracts from the supported
// APK, not yet proven at runtime):
//   * Observe nearby-route discovery and the authoritative current-route state.
//   * Submit discover / start / complete / pause actions through the real
//     service methods, each gated on readiness, permissions and matching id.
// It never auto-rates, exchanges gifts, triggers encounters, catches, builds
// reward RPCs, or continues routes on its own. The Java controller owns flow.
//
// Service capture uses validated method hooks (disasm-pinned instruction
// prefixes from lifecycle-code.json) to grab the live service `this` the first
// time the game calls one on the verified Unity thread, then pins a GC root.
// No arbitrary-heap scan and no raw method-address assumptions: methods are
// resolved from metadata by name and signature, and the four addresses that
// have disasm evidence are prefix-checked before any hook is placed. Until a
// service is captured the module reports waiting, never false ready.

(function(root){
'use strict';

const VERSION='routes-native-0.1.0';

const LIMITS=Object.freeze({
 routesMax:100,         // snapshot routes<=100
 pointsMax:5000,        // points per route<=5000
 nameBytes:256,
 strChars:4096,
 assemblies:256,
 leaseMs:2500,          // matches quick-close foreground-lease window
 statusMs:1000,         // emit current status at most ~1/s under lease
 discoverMs:5000});     // throttle discovery reads

// ---- il2cpp type/field/method metadata, named exactly as the APK exposes it ----
// Public names survive obfuscation; obfuscated members (didn) are pinned by
// offset + reference/value kind so a renamed layout fails closed.
const CLS={
 consumption:'Niantic.Holoholo.Routes.RouteConsumptionService',
 routes:'Niantic.Holoholo.Routes.RoutesService',
 nearby:'Niantic.Holoholo.Routes.NearbyRoutesInfo',
 startData:'Niantic.Holoholo.Routes.RoutesConsumptionStartData',
 shared:'Holoholo.Rpc.SharedRouteProto',
 anchor:'Holoholo.Rpc.RoutePoiAnchor',
 waypoint:'Holoholo.Rpc.RouteWaypointProto',
 play:'Holoholo.Rpc.RoutePlayProto',
 progress:'Holoholo.Rpc.ProgressRouteOutProto',
 gui:'Niantic.Holoholo.NUI.GuiController',
 rewardGui:'Niantic.Holoholo.Routes.RouteCompletionGuiController',
 ratingGui:'Niantic.Holoholo.Routes.RouteRatingGuiController',
 playerStats:'Holoholo.Rpc.PlayerRouteStats',
 bool:'System.Boolean'};

// [name, offset, kind] - kind is 'ref'|'bool'|'i64'|'f64'|'str'
const FIELDS={
 [CLS.progress]:[['Status',0x14,'enum']],
 [CLS.gui]:[['currentState',0x70,'enum']],
 [CLS.routes]:[['didn',0x210,'ref'],['dica',0x80,'ref']],
 [CLS.nearby]:[['<Routes>k__BackingField',0x10,'ref']],
 [CLS.startData]:[['PublishedRouteProto',0x10,'ref'],['Reversed',0x18,'bool']],
 [CLS.anchor]:[['Anchor',0x10,'ref']],
 [CLS.shared]:[['StartPoi',0xa8,'ref'],['EndPoi',0xb0,'ref'],['Id',0x10,'str'],['Waypoints',0x18,'ref'],['Name',0x28,'str'],['Reversible',0x48,'bool'],['RouteDistanceMeters',0x58,'i64'],['PlayerStats',0x90,'ref']],
 [CLS.waypoint]:[['LatDegrees',0x18,'f64'],['LngDegrees',0x20,'f64']],
 [CLS.play]:[['Route',0x10,'ref'],['CompletedWalk',0x3c,'bool'],['Paused',0x3d,'bool'],['AcquiredReward',0x3e,'bool'],['TravelInReverse',0x70,'bool']],
 [CLS.playerStats]:[['CooldownFinishMs',0x18,'i64']]};

// Named getters/actions resolved purely from metadata by signature.
// RETURN/PARAM use fully-qualified managed type names.
const VOID='System.Void',BOOL='System.Boolean',PROMISE='Niantic.Promises.IPromise';
const METHODS={
 dismissGui:[CLS.gui,'Dismiss',VOID,[]],
 isConsuming:[CLS.consumption,'get_IsConsumingRoute',BOOL,[]],
 isCompleting:[CLS.consumption,'get_IsCompletingRoute',BOOL,[]],
 hasStarted:[CLS.consumption,'get_RouteHasStarted',BOOL,[]],
 inRangeOfEnd:[CLS.consumption,'get_InRangeOfEnd',BOOL,[]],
 inRangeToResume:[CLS.consumption,'get_InRangeToResume',BOOL,[]],
 isPaused:[CLS.consumption,'get_IsRoutePaused',BOOL,[]],
 enabledForPlayer:[CLS.consumption,'get_RouteConsumptionEnabledForPlayer',BOOL,[]],
 flagInitialized:[CLS.consumption,'get_FeatureFlagInitialized',BOOL,[]],
 currentRoute:[CLS.consumption,'get_CurrentRoute',CLS.play,[]],
 start:[CLS.consumption,'StartRoute',VOID,[CLS.startData]],
 complete:[CLS.consumption,'CompleteRouteButtonClick',VOID,[]],
 confirmComplete:[CLS.consumption,'bizv',VOID,[]],
 completionResponse:[CLS.consumption,'bjan',VOID,[CLS.progress]],
 pause:[CLS.consumption,'PauseRoute',PROMISE,[BOOL]],
 requestNearby:[CLS.routes,'RequestNearbyRoutes',null,[]]};

// Disasm-validated (owner typedef index, rva, instruction prefix) from
// lifecycle-code.json. Hooked for service `this` capture after a prefix check,
// so we never attach to a guessed address.
const CAPTURE=[
 {service:'consumption',owner:4930,rva:174741504,prefix:'eb2bbc6de923016dfe5702a9f44f03a954510290f30300aa'}, // get_InRangeOfEnd
 {service:'consumption',owner:4930,rva:174765544,prefix:'fe0f1bf8fa6701a9f85f02a9f65703a9f44f04a9145102d0'}, // StartRoute
 {service:'consumption',owner:4930,rva:174791308,prefix:'fe0f1cf8f85f01a9f65702a9f44f03a9f4500290f30300aa'}, // CompleteRouteButtonClick
 {service:'routes',owner:5033,rva:175049024,prefix:'fe67bca9f85f01a9f65702a9f44f03a9f34e02b0f40300aa'}];// RequestNearbyRoutes

// ------------------------------- pure helpers --------------------------------
// Validate and normalise a bridge command. Returns {ok,command}|{ok:false,reason}.
function parseCommand(json){
 if(typeof json!=='string'||!json.length||json.length>4096)return{ok:false,reason:'no-command'};
 let raw;try{raw=JSON.parse(json);}catch(_){return{ok:false,reason:'bad-json'};}
 if(!raw||typeof raw!=='object')return{ok:false,reason:'bad-shape'};
 const seq=raw.seq;
 if(!Number.isInteger(seq)||seq<=0)return{ok:false,reason:'bad-seq'};
 const action=raw.action;
 if(['discover','start','complete','pause'].indexOf(action)<0)return{ok:false,reason:'bad-action'};
 const command={seq,action};
 if(raw.id!==undefined){if(typeof raw.id!=='string'||!raw.id||raw.id.length>128)return{ok:false,reason:'bad-id'};command.id=raw.id;}
 if(raw.reversed!==undefined){if(typeof raw.reversed!=='boolean')return{ok:false,reason:'bad-reversed'};command.reversed=raw.reversed;}
 if((action==='start'||action==='complete')&&!command.id)return{ok:false,reason:'id-required'};
 return{ok:true,command};
}

// Clamp a discovered snapshot to the bounded shape the bridge promises.
function boundSnapshot(routes){
 const out=[];let budget=0;
 if(!Array.isArray(routes))return out;
 for(const r of routes){
  if(out.length>=LIMITS.routesMax)break;
  if(!r||typeof r.id!=='string'||!r.id||r.id.length>128||!Array.isArray(r.points)||r.points.length<2||r.points.length>LIMITS.pointsMax)continue;
  if(!r.points.every(p=>Array.isArray(p)&&p.length===2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180))continue;
  const shaped={id:r.id,name:typeof r.name==='string'?r.name.slice(0,LIMITS.nameBytes):'',reversible:r.reversible===true,
   distanceMeters:Number.isFinite(r.distanceMeters)?r.distanceMeters:0,cooldownFinishMs:Number.isFinite(r.cooldownFinishMs)?r.cooldownFinishMs:0,points:r.points};
  for(const k of ['start','end']){const p=r[k];if(Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180)shaped[k]=p;}
  const bytes=JSON.stringify(shaped).length;if(budget+bytes>500000)break;budget+=bytes;out.push(shaped);
 }
 return out;
}

// Sequence/replay/lease gate. Pure and unit-testable: no native work, no retry.
function createGate(leaseMs){
 let lastSeq=0,leaseUntil=0,pending=null,cancelled=false;
 return{
  set(allowed,parsed,now){
   leaseUntil=allowed===true?now+leaseMs:0;
   if(allowed!==true){
    // Revoking the lease dooms any pending command: keep it queued so take()
    // can emit an expired ack (never a silent drop that times the mailbox out),
    // and mark it cancelled so re-granting the lease can never replay the
    // mutation. lastSeq already advanced, so the same seq resend is stale-seq.
    if(pending)cancelled=true;
    return{ok:false,reason:'not-allowed'};
   }
   if(!parsed||!parsed.ok){if(pending&&(!parsed||parsed.reason==='no-command'))cancelled=true;return{ok:false,reason:parsed?parsed.reason:'no-command'};}
   const c=parsed.command;
   if(c.seq<=lastSeq)return{ok:false,reason:'stale-seq'};
   lastSeq=c.seq;pending=c;cancelled=false; // consume the sequence once
   return{ok:true};
  },
  // Hand out the pending command exactly once; never replay or retry a mutation.
  // A command doomed by a revoked lease drains as expired, never executes.
  take(now){if(!pending)return null;const c=pending,dead=cancelled;pending=null;cancelled=false;
   if(dead||now>=leaseUntil)return{command:c,expired:true};return{command:c};},
  leaseActive(now){return leaseUntil!==0&&now<leaseUntil;},
  clear(){pending=null;cancelled=false;},
  get lastSeq(){return lastSeq;}
 };
}

// ------------------------------- native controller ---------------------------
// host supplies the verified-Unity-thread primitives already bound by
// quick-close: {api,module,Memory,ptr,Interceptor,event,now,hold,target,
// freeHandle,invoke,exact,readPtr,addListener,isStopping}.
function createController(host){
 const {api,module,Memory,ptr,Interceptor,event}=host;
 const gate=createGate(LIMITS.leaseMs);
 const held=new Map();      // kind -> gchandle (services, cached route protos)
 const routeCache=new Map();// routeId -> gchandle(SharedRouteProto) for start
 let lastCurrentKey='',lastTrackingError=null,lastWaypointAt=0;
 let completing=null,completion=null,rewardAt=0;
 const pendingUi=[];
 const trackingCalls=new Map();
 let meta=null,ready=false,readyReason='awaiting-metadata',lastReadyKey='';
 let lastStatusMs=0,lastDiscoverMs=0,nextMeta=0,cachedRoutes=[],consumptionSrc=null;

 function text(p){if(p.isNull())return'';let n=0;while(n<LIMITS.nameBytes&&p.add(n).readU8())n++;return n?p.readUtf8String(n):'';}
 function typeName(type){const v=api.type_get_name(type);if(v.isNull())return'';try{return text(v);}finally{api.free(v);}}

 function resolveClass(name){
  const domain=api.domain_get();if(domain.isNull())throw Error('no-domain');
  if(api.thread_current().isNull())throw Error('unattached-thread');
  const count=Memory.alloc(8);count.writeU64(0);
  const list=api.domain_get_assemblies(domain,count),total=count.readU64();
  if(total.compare(0)===0||total.compare(LIMITS.assemblies)>0||list.isNull())throw Error('assembly-limit');
  const i=name.lastIndexOf('.'),ns=Memory.allocUtf8String(name.slice(0,i)),sh=Memory.allocUtf8String(name.slice(i+1));
  let found=null;
  for(let a=0;a<total.toNumber();a++){const image=api.assembly_get_image(list.add(a*8).readPointer());if(image.isNull())continue;
   const k=api.class_from_name(image,ns,sh);if(k.isNull())continue;
   if(typeName(api.class_get_type(k))!==name)throw Error('class-name-mismatch:'+name);
   if(found&&!found.equals(k))throw Error('class-dup:'+name);found=k;}
  if(!found)throw Error('class-missing:'+name);return found;
 }

 function field(klass,name,offset,kind){
  const f=api.class_get_field_from_name(klass,Memory.allocUtf8String(name));
  if(f.isNull()||!api.field_get_parent(f).equals(klass)||(api.field_get_flags(f)&0x10))throw Error('field-mismatch:'+name);
  if(Number(api.field_get_offset(f).toString())!==offset)throw Error('field-offset:'+name);
  const tk=api.class_from_type(api.field_get_type(f));
  if(tk.isNull())throw Error('field-type:'+name);
  const isValue=api.class_is_valuetype(tk);
  const expected={bool:'System.Boolean',i64:'System.Int64',f64:'System.Double',str:'System.String'}[kind];
  if(expected&&typeName(api.field_get_type(f))!==expected)throw Error('field-type-mismatch:'+name);
  if(kind==='enum'&&!isValue)throw Error('field-not-enum:'+name);
  if(kind==='ref'&&isValue)throw Error('field-not-ref:'+name);
  if((kind==='bool'||kind==='i64'||kind==='f64')&&!isValue)throw Error('field-not-value:'+name);
  return f;
 }

 function method(klass,name,ret,params,allowInflated){
  const m=api.class_get_method_from_name(klass,Memory.allocUtf8String(name),params.length);
  if(m.isNull()||!api.method_get_class(m).equals(klass)||text(api.method_get_name(m))!==name)throw Error('method-mismatch:'+name);
  const impl=Memory.alloc(4);
  if((api.method_get_flags(m,impl)&16)!==0)throw Error('method-static:'+name);        // instance only
  if(api.method_get_param_count(m)!==params.length||api.method_is_generic(m))throw Error('method-shape:'+name);
  if(!allowInflated&&api.method_is_inflated(m))throw Error('method-inflated:'+name);
  if(ret!==null&&typeName(api.method_get_return_type(m))!==ret)throw Error('method-return:'+name);
  for(let i=0;i<params.length;i++)if(typeName(api.method_get_param(m,i))!==params[i])throw Error('method-param:'+name);
  return m;
 }

 function checkPrefix(address,hex){
  const bytes=new Uint8Array(address.readByteArray(hex.length/2));
  if(bytes.length!==hex.length/2)throw Error('short-read');
  for(let i=0;i<bytes.length;i++)if(bytes[i]!==parseInt(hex.slice(i*2,i*2+2),16))throw Error('prefix-mismatch');
 }

 // ---- metadata build (once) ----
 function buildMeta(){
  const classes={};for(const k of Object.values(CLS))classes[k]=resolveClass(k);
  const fields={};
  for(const cn of Object.keys(FIELDS)){fields[cn]={};
   for(const [n,off,kind] of FIELDS[cn])fields[cn][n]=field(classes[cn],n,off,kind);}
  const m={};
  for(const key of Object.keys(METHODS)){const [cn,name,ret,ps]=METHODS[key];m[key]=method(classes[cn],name,ret,ps,false);}
  // List<SharedRouteProto> accessors from the actual field type (inflated generics).
  const listClass=api.class_from_type(api.field_get_type(fields[CLS.nearby]['<Routes>k__BackingField']));
  if(listClass.isNull())throw Error('list-class');
  const listCount=method(listClass,'get_Count','System.Int32',[],true);
  const listItem=method(listClass,'get_Item',CLS.shared,['System.Int32'],true);
  // RepeatedField<RouteWaypointProto> accessors from SharedRouteProto.Waypoints.
  const wpClass=api.class_from_type(api.field_get_type(fields[CLS.shared]['Waypoints']));
  if(wpClass.isNull())throw Error('waypoint-field-class');
  const wpCount=method(wpClass,'get_Count','System.Int32',[],true);
  const wpItem=method(wpClass,'get_Item',CLS.waypoint,['System.Int32'],true);
  // The host already validates and hooks this shared method before Routes installs.
  // Its live prologue is therefore patched; validate the metadata address instead.
  if(!m.dismissGui.readPointer().equals(module.base.add(0xa375344)))throw Error('dismiss-address');
  checkPrefix(module.base.add(174801868),'fe5fbda9f65701a9f44f02a9d45002b0f30300aa883a4e39');
  const ctor=api.class_get_method_from_name(classes[CLS.startData],Memory.allocUtf8String('.ctor'),0);
  if(ctor.isNull())throw Error('startdata-ctor');
  return{classes,fields,m,listCount,listItem,wpCount,wpItem,ctor};
 }

 // ---- invoke helpers (verified Unity thread only) ----
 function invokeBool(m,obj){const r=host.invoke(m,obj,ptr(0));if(r.isNull())throw Error('null-bool');
  const h=host.hold(r);try{const b=host.target(h);if(!host.exact(b,meta.classes[CLS.bool]))throw Error('bool-class');
   const v=api.object_unbox(b);if(v.isNull())throw Error('bool-unbox');const n=v.readU8();if(n>1)throw Error('bool-range');return n===1;}finally{host.freeHandle(h);}}
 function invokeInt(m,obj){const r=host.invoke(m,obj,ptr(0));if(r.isNull())throw Error('null-int');
  const h=host.hold(r);try{const b=host.target(h);const v=api.object_unbox(b);if(v.isNull())throw Error('int-unbox');return v.readS32();}finally{host.freeHandle(h);}}
 function invokeObj(m,obj,argsPtr){const r=host.invoke(m,obj,argsPtr||ptr(0));return r;}

 function readBool(o,f){const out=Memory.alloc(1);out.writeU8(0);api.field_get_value(o,f,out);return out.readU8()===1;}
 function readI64(o,f){const out=Memory.alloc(8);out.writeU64(0);api.field_get_value(o,f,out);return out.readS64();}
 function readF64(o,f){const out=Memory.alloc(8);out.writeU64(0);api.field_get_value(o,f,out);return out.readDouble();}
 function readStr(o,f){const p=host.readPtr(o,f);if(p.isNull())return'';
  const len=api.string_length(p);if(len<=0)return'';const n=Math.min(len,LIMITS.strChars);
  const chars=api.string_chars(p);if(chars.isNull())return'';return chars.readUtf16String(n);}

 // Observe the game's own tracking decisions without suppressing errors.
 function installTrackingDiagnostics(){
  const errorAddress=module.base.add(174921352);
  checkPrefix(errorAddress,'ff8301d1fe6f01a9fa6702a9f85f03a9f65704a9f44f05a9');
  host.addListener(Interceptor.attach(errorAddress,{onEnter(){
   this.observe=host.unity(this.threadId)&&gate.leaseActive(host.now());
   if(this.observe)trackingCalls.set(this.threadId,(trackingCalls.get(this.threadId)||0)+1);
  },onLeave(ret){
   if(!this.observe)return;const depth=trackingCalls.get(this.threadId)||0;if(depth<=1)trackingCalls.delete(this.threadId);else trackingCalls.set(this.threadId,depth-1);const code=ret.toInt32();if(code!==lastTrackingError){lastTrackingError=code;event('routes-tracking-status',{code});}
  }}));
  // Route tracking calls Unity's OS-service check directly, bypassing the game's
  // foreground permission adapter. Only that nested check recognizes our fresh
  // synthetic-location lease; network, breadcrumb freshness and path checks run normally.
  try{
   const resolverAddress=module.getExportByName('il2cpp_resolve_icall');host.executable(module,resolverAddress,4);
   const resolve=new host.NativeFunction(resolverAddress,'pointer',['pointer']);
   const enabledAddress=resolve(Memory.allocUtf8String('UnityEngine.LocationService::IsServiceEnabledByUser()'));
   const unityModule=host.Process.findModuleByAddress(enabledAddress);
   if(!unityModule||unityModule.name!=='libunity.so')throw Error('location-icall-owner');
   host.executable(unityModule,enabledAddress,4);
   host.addListener(Interceptor.attach(enabledAddress,{onLeave(ret){
    if(trackingCalls.has(this.threadId)&&gate.leaseActive(host.now())&&!(host.isStopping&&host.isStopping()))ret.replace(ptr(1));
   }}));
   event('routes-location-gate-ready',{});
  }catch(e){event('routes-location-gate-unavailable',{reason:String(e)});}
  const waypointAddress=module.base.add(174925564);
  checkPrefix(waypointAddress,'fe0f1df8f65701a9f44f02a9d54f02f0f40301aaf30300aa');
  host.addListener(Interceptor.attach(waypointAddress,{onEnter(args){try{
   const now=host.now();if(!host.unity(this.threadId)||!gate.leaseActive(now)||now-lastWaypointAt<10000)return;
   if(!host.exact(args[1],meta.classes[CLS.waypoint]))return;lastWaypointAt=now;
   const f=meta.fields[CLS.waypoint];event('routes-waypoint',{lat:readF64(args[1],f.LatDegrees),lon:readF64(args[1],f.LngDegrees)});
  }catch(_){}}}));
 }

 // ---- service capture by validated-prefix hook ----
 function installCapture(){
  for(const [key,rva,prefix,cn] of [
   ['rewardReady',175272412,'ff4303d1ea2b00fde923066dfd7b07a9fc6f08a9fa6709a9',CLS.rewardGui],
   ['ratingReady',175286128,'ff8301d1fe6f01a9fa6702a9f85f03a9f65704a9f44f05a9',CLS.ratingGui]]){
   const address=module.base.add(rva);checkPrefix(address,prefix);
   const init=api.class_get_method_from_name(meta.classes[cn],Memory.allocUtf8String('Initialize'),1);
   if(init.isNull()||!api.method_get_class(init).equals(meta.classes[cn])||!init.readPointer().equals(address))throw Error('ui-method-address:'+key);
   host.addListener(Interceptor.attach(address,{onEnter(args){try{
    if(!completion||host.now()-rewardAt>15000||!host.unity(this.threadId)||!gate.leaseActive(host.now()))return;
    if(!host.exact(args[0],meta.classes[cn])||pendingUi.length>=4)return;
    this.captured={handle:host.hold(args[0]),at:host.now(),cn};
   }catch(_){}},onLeave(){if(this.captured)pendingUi.push(this.captured);}}));
  }
  const responseAddress=module.base.add(174816912);
  if(!meta.m.completionResponse.readPointer().equals(responseAddress))throw Error('completion-response-address');
  checkPrefix(responseAddress,'fe67bca9f85f01a9f65702a9f44f03a9b55002d0f40301aa');
  // bjan is bizv's ProgressRoute success continuation. Status 1 is its success
  // branch; current-route disappearance alone also occurs on errors/cancellation.
  host.addListener(Interceptor.attach(responseAddress,{onEnter(args){try{
   if(!completing||!host.unity(this.threadId)||!gate.leaseActive(host.now())||host.now()-completing.at>30000)return;
   if(!host.exact(args[0],meta.classes[CLS.consumption])||!host.exact(args[1],meta.classes[CLS.progress]))return;
   const svc=serviceObj('consumption');if(!svc||!svc.equals(args[0]))return;
   const status=args[1].add(0x14).readS32();
   const state=readCurrent();if(!state||!state.current||state.current.id!==completing.id)return;
   if(status===1){completion={id:completing.id,seq:completing.seq};rewardAt=host.now();event('routes-reward-confirmed',completion);}
   else event('routes-reward-rejected',{id:completing.id,status});
   completing=null;
  }catch(_){}}}));
  for(const c of CAPTURE){
   let address;try{address=module.base.add(c.rva);checkPrefix(address,c.prefix);}
   catch(e){event('routes-capture-skipped',{service:c.service,rva:c.rva,reason:String(e)});continue;}
   const klass=meta.classes[c.service==='consumption'?CLS.consumption:CLS.routes];
   const listener=Interceptor.attach(address,{onEnter(args){
    try{
     if(!host.unity(this.threadId))return;
     const self=args[0];if(self.isNull()||!host.exact(self,klass))return;
     const existing=held.get(c.service);
     if(existing){try{if(host.target(existing).equals(self))return;}catch(_){}host.freeHandle(existing);}
     held.set(c.service,host.hold(self));
     event('routes-service-captured',{service:c.service});
    }catch(_){/* capture is best-effort; never disturb the game call */}
   }});
   host.addListener(listener);
  }
 }

 function serviceObj(kind){const h=held.get(kind);if(!h)return null;try{const o=host.target(h);return o.isNull()?null:o;}catch(_){return null;}}
 function safeEquals(handle,obj){try{return host.target(handle).equals(obj);}catch(_){return false;}}

 // ---- discovery + current state reads ----
 function readAnchor(obj,f){const anchor=host.readPtr(obj,f);if(anchor.isNull())return null;
  const wp=host.readPtr(anchor,meta.fields[CLS.anchor].Anchor);if(wp.isNull())return null;
  return [readF64(wp,meta.fields[CLS.waypoint].LatDegrees),readF64(wp,meta.fields[CLS.waypoint].LngDegrees)];}
 function readShared(obj){ // obj: SharedRouteProto*
  const f=meta.fields[CLS.shared];
  // Every raw field read below happens before any managed invoke, so obj is
  // stable here and needs no root.
  const id=readStr(obj,f['Id']);if(!id)return null;
  const name=readStr(obj,f['Name']);
  const reversible=readBool(obj,f['Reversible']);
  const distanceMeters=Number(readI64(obj,f['RouteDistanceMeters']).toString());
  let cooldownFinishMs=0;const stats=host.readPtr(obj,f['PlayerStats']);
  if(!stats.isNull())cooldownFinishMs=Number(readI64(stats,meta.fields[CLS.playerStats]['CooldownFinishMs']).toString());
  const start=readAnchor(obj,f.StartPoi),end=readAnchor(obj,f.EndPoi);
  const points=[];
  const wpsRaw=host.readPtr(obj,f['Waypoints']);
  if(!wpsRaw.isNull()){
   const wpsHandle=host.hold(wpsRaw); // Waypoints collection lives across the item invokes
   try{
    const count=invokeInt(meta.wpCount,host.target(wpsHandle));if(count<2||count>LIMITS.pointsMax)return null;
    const arg=Memory.alloc(8),idx=Memory.alloc(4);arg.writePointer(idx);
    const wf=meta.fields[CLS.waypoint];
    for(let i=0;i<count;i++){idx.writeS32(i);
     // Re-target the rooted collection after each invoke; the waypoint is read
     // immediately with no further invoke before the next iteration.
     const wp=invokeObj(meta.wpItem,host.target(wpsHandle),arg);if(wp.isNull())continue;
     points.push([readF64(wp,wf['LatDegrees']),readF64(wp,wf['LngDegrees'])]);}
   }catch(e){event('routes-waypoints-unavailable',{id,reason:String(e)});return null;}
   finally{host.freeHandle(wpsHandle);}
  }
  return{id,name,reversible,distanceMeters,cooldownFinishMs,points,start,end};
 }

 function readDiscovery(){
  const svc=serviceObj('routes');if(!svc)return null;
  const info=host.readPtr(svc,meta.fields[CLS.routes]['didn']);
  if(info.isNull()||!host.exact(info,meta.classes[CLS.nearby]))return[];
  const listRaw=host.readPtr(info,meta.fields[CLS.nearby]['<Routes>k__BackingField']);
  if(listRaw.isNull())return[];
  const listHandle=host.hold(listRaw); // the backing list lives across every item invoke
  try{
   let count=invokeInt(meta.listCount,host.target(listHandle));if(count<0)count=0;if(count>LIMITS.routesMax)count=LIMITS.routesMax;
   const out=[],seen=new Set(),arg=Memory.alloc(8),idx=Memory.alloc(4);arg.writePointer(idx);
   for(let i=0;i<count;i++){idx.writeS32(i);
    // Re-target the rooted list after each item invoke, and root each proto so it
    // survives readShared's own waypoint invokes.
    const sr=invokeObj(meta.listItem,host.target(listHandle),arg);if(sr.isNull())continue;
    const srHandle=host.hold(sr);
    try{const shaped=readShared(host.target(srHandle));if(!shaped||seen.has(shaped.id))continue;
     seen.add(shaped.id);out.push(shaped);cacheRoute(shaped.id,host.target(srHandle));}
    finally{host.freeHandle(srHandle);}}
   pruneCache(seen);
   return boundSnapshot(out);
  }finally{host.freeHandle(listHandle);}
 }

 function readCurrent(){
  const svc=serviceObj('consumption');if(!svc)return null;
  const play=invokeObj(meta.m.currentRoute,svc);
  if(play.isNull()||!host.exact(play,meta.classes[CLS.play]))return{current:null};
  const playHandle=host.hold(play); // play lives across the getter invokes below
  try{
   const pf=meta.fields[CLS.play];
   // Run every managed getter first (each invoke can relocate play), then read
   // the re-targeted object's raw fields with no further invoke in between.
   const started=safeBool('hasStarted',svc);
   const inRangeOfEnd=safeBool('inRangeOfEnd',svc);
   const inRangeToResume=safeBool('inRangeToResume',svc);
   const isCompleting=safeBool('isCompleting',svc);
   const p=host.target(playHandle);
   const route=host.readPtr(p,pf['Route']);
   const id=route.isNull()?'':readStr(route,meta.fields[CLS.shared]['Id']);
   return{current:{
    id,
    started,
    paused:readBool(p,pf['Paused']),
    completedWalk:readBool(p,pf['CompletedWalk']),
    acquiredReward:readBool(p,pf['AcquiredReward']),
    inRangeOfEnd,
    inRangeToResume,
    isCompleting,
    reversed:readBool(p,pf['TravelInReverse'])}};
  }finally{host.freeHandle(playHandle);}
 }
 function safeBool(key,svc){try{return invokeBool(meta.m[key],svc);}catch(_){return false;}}

 // ---- bounded rooted route-definition cache ----
 function cacheRoute(id,sharedObj){
  const prev=routeCache.get(id);
  if(prev){try{if(host.target(prev).equals(sharedObj))return;}catch(_){}host.freeHandle(prev);}
  if(routeCache.size>=LIMITS.routesMax){const first=routeCache.keys().next().value;host.freeHandle(routeCache.get(first));routeCache.delete(first);}
  routeCache.set(id,host.hold(sharedObj));
 }
 function pruneCache(seen){for(const id of [...routeCache.keys()])if(!seen.has(id)){host.freeHandle(routeCache.get(id));routeCache.delete(id);}}
 function releaseAll(){completing=null;completion=null;while(pendingUi.length)host.freeHandle(pendingUi.shift().handle);for(const h of held.values())host.freeHandle(h);held.clear();
  for(const h of routeCache.values())host.freeHandle(h);routeCache.clear();
  if(consumptionSrc){host.freeHandle(consumptionSrc);consumptionSrc=null;}}

 // ---- actions (each one-shot, guarded, no retry) ----
 function doDiscover(seq){
  const svc=serviceObj('routes');if(!svc){action(seq,'discover','error','awaiting-service');return;}
  try{host.invoke(meta.m.requestNearby,svc,ptr(0));action(seq,'discover','submitted');}
  catch(e){action(seq,'discover','error',String(e));}
 }
 function doStart(seq,id,reversed){
  const svc=serviceObj('consumption');if(!svc){action(seq,'start','error','awaiting-service');return;}
  try{
   if(!invokeBool(meta.m.flagInitialized,svc)){action(seq,'start','error','feature-not-initialized');return;}
   if(!invokeBool(meta.m.enabledForPlayer,svc)){action(seq,'start','error','not-permitted');return;}
   if(invokeBool(meta.m.isConsuming,svc)){action(seq,'start','error','route-already-active');return;}
   const h=routeCache.get(id);if(!h){action(seq,'start','error','route-not-discovered');return;}
   const shared=host.target(h);if(shared.isNull()||!host.exact(shared,meta.classes[CLS.shared])){action(seq,'start','error','route-stale');return;}
   if(readStr(shared,meta.fields[CLS.shared]['Id'])!==id){action(seq,'start','error','route-id-mismatch');return;}
   if(reversed===true&&!readBool(shared,meta.fields[CLS.shared]['Reversible'])){action(seq,'start','error','not-reversible');return;}
   const data=api.object_new(meta.classes[CLS.startData]);if(data.isNull()){action(seq,'start','error','alloc-failed');return;}
   const dataHandle=host.hold(data);
   try{
    host.invoke(meta.ctor,host.target(dataHandle),ptr(0));
    // Re-target both managed objects after the ctor invoke may have moved them;
    // the route proto stays rooted in routeCache via handle h.
    const d=host.target(dataHandle),sh=host.target(h);
    if(sh.isNull()||!host.exact(sh,meta.classes[CLS.shared])){action(seq,'start','error','route-stale');return;}
    const sf=meta.fields[CLS.startData];
    api.field_set_value_object(d,sf['PublishedRouteProto'],sh);
    const rv=Memory.alloc(1);rv.writeU8(reversed===true?1:0);api.field_set_value(d,sf['Reversed'],rv);
    const arg=Memory.alloc(8);arg.writePointer(d);
    host.invoke(meta.m.start,svc,arg);
    action(seq,'start','submitted');
   }finally{host.freeHandle(dataHandle);}
  }catch(e){action(seq,'start','error',String(e));}
 }
 function doComplete(seq,id){
  const svc=serviceObj('consumption');if(!svc){action(seq,'complete','error','awaiting-service');return;}
  try{
   const state=readCurrent();if(!state||!state.current){action(seq,'complete','error','no-current-route');return;}
   const c=state.current;
   if(c.id!==id){action(seq,'complete','error','route-id-mismatch');return;}
   if(c.isCompleting){action(seq,'complete','error','already-completing');return;}
   if(c.acquiredReward){action(seq,'complete','error','already-rewarded');return;}
   if(c.paused||!c.started||!c.completedWalk||!c.inRangeOfEnd){action(seq,'complete','error','not-eligible');return;}
   // The game's Yes callback: normal ProgressRoute reward path, without opening its confirmation modal.
   completing={id,seq,at:host.now()};completion=null;
   host.invoke(meta.m.confirmComplete,serviceObj('consumption'),ptr(0));
   action(seq,'complete','submitted');
  }catch(e){completing=null;action(seq,'complete','error',String(e));}
 }
 function doPause(seq){
  const svc=serviceObj('consumption');if(!svc){action(seq,'pause','error','awaiting-service');return;}
  try{
   if(!invokeBool(meta.m.isConsuming,svc)){action(seq,'pause','error','no-current-route');return;}
   if(invokeBool(meta.m.isPaused,svc)){action(seq,'pause','error','already-paused');return;}
   const rv=Memory.alloc(1),arg=Memory.alloc(8);rv.writeU8(1);arg.writePointer(rv);
   invokeObj(meta.m.pause,svc,arg); // returns an IPromise we do not observe
   action(seq,'pause','submitted');
  }catch(e){action(seq,'pause','error',String(e));}
 }
 function run(cmd){switch(cmd.action){
  case'discover':return doDiscover(cmd.seq);
  case'start':return doStart(cmd.seq,cmd.id,cmd.reversed===true);
  case'complete':return doComplete(cmd.seq,cmd.id);
  case'pause':return doPause(cmd.seq);}}

 function action(seq,act,status,reason){const f={seq,action:act,status};if(reason)f.reason=String(reason).slice(0,180);event('routes-action',f);}
 function emitReady(available,reason){const key=available+':'+(reason||'');if(key===lastReadyKey)return;lastReadyKey=key;event('routes-ready',{available,reason:reason||null});}

 // ---- public surface ----
 return{
  version:VERSION,
  // JS-thread safe: records intent only; no managed calls happen here.
  setOptions(allowed,commandJson){
   let now=0;try{now=host.now();}catch(_){}
   const parsed=parseCommand(commandJson);
   const res=gate.set(allowed,parsed,now);
   if(allowed!==true)return{status:'off'};
   if(!res.ok)return{status:'rejected',reason:res.reason};
   return{status:'accepted',seq:parsed.command.seq,action:parsed.command.action};
  },
  // Called from the host cleanupTick on the verified Unity thread.
  tick(now,tid){
   try{
    if(!meta){if(now<nextMeta)return;nextMeta=now+2000;meta=buildMeta();installCapture();try{installTrackingDiagnostics();}catch(e){event('routes-diagnostic-unavailable',{reason:String(e)});}ready=true;readyReason=null;
     event('routes-metadata-ready',{version:VERSION,leaseMs:LIMITS.leaseMs,statusMs:LIMITS.statusMs});}
   }catch(e){if(!ready){readyReason='metadata:'+String(e);emitReady(false,readyReason);}return;}

   if(!ready){emitReady(false,readyReason);return;}
   if(host.isStopping&&host.isStopping()){releaseAll();gate.clear();return;}

   const routeService=serviceObj('routes');
   if(routeService){
    // Derive the consumption service from the routes dependency when we have none
    // yet, or re-derive it when the backing RoutesService instance has changed
    // (a replaced RoutesService points its dica at a fresh consumption service).
    let srcStale=true;if(consumptionSrc){try{srcStale=!host.target(consumptionSrc).equals(routeService);}catch(_){srcStale=true;}}
    if(!serviceObj('consumption')||srcStale){try{const c=host.readPtr(routeService,meta.fields[CLS.routes].dica);
     if(!c.isNull()&&host.exact(c,meta.classes[CLS.consumption])){
      const existing=held.get('consumption');
      if(!existing||!safeEquals(existing,c)){if(existing)host.freeHandle(existing);held.set('consumption',host.hold(c));event('routes-service-captured',{service:'consumption',source:'routes-dependency'});}
      if(consumptionSrc)host.freeHandle(consumptionSrc);consumptionSrc=host.hold(routeService);
     }}catch(_){}}
   }
   const haveConsumption=!!serviceObj('consumption')&&!!routeService;
   emitReady(haveConsumption,haveConsumption?null:'awaiting-service');

   const leaseOn=gate.leaseActive(now);
   for(let i=pendingUi.length-1;i>=0;i--){const p=pendingUi[i];if(now-p.at<100)continue;
    let remove=false;try{const gui=host.target(p.handle);
     if(!leaseOn||now-p.at>=10000||!host.exact(gui,meta.classes[p.cn]))remove=true;
     else if(gui.add(0x70).readS32()===2){remove=true;
      host.invoke(meta.m.dismissGui,gui,ptr(0));event('routes-result-dismissed',{screen:p.cn});}
    }catch(e){remove=true;event('routes-result-dismiss-error',{reason:String(e)});}
    if(remove){pendingUi.splice(i,1);host.freeHandle(p.handle);}
   }

   // Authoritative current state + discovery snapshot while the lease is fresh.
   if(leaseOn&&haveConsumption&&now-lastStatusMs>=LIMITS.statusMs){lastStatusMs=now;
    try{const cur=readCurrent();const currentKey=JSON.stringify(cur);if(currentKey!==lastCurrentKey){lastCurrentKey=currentKey;event('routes-current',cur||{current:null});}
     if(serviceObj('routes')&&now-lastDiscoverMs>=LIMITS.discoverMs){lastDiscoverMs=now;cachedRoutes=readDiscovery()||[];}
     event('routes-snapshot',{routes:cachedRoutes,current:cur?cur.current:null,completion:completion&&now-rewardAt>=3000&&!pendingUi.length?completion:null});
    }catch(e){event('routes-read-error',{reason:String(e)});}
   }

   // One command per fresh sequence; a stale lease still drains (never executes).
   const next=gate.take(now);
   if(next){if(next.expired||!leaseOn)action(next.command.seq,next.command.action,'error','lease-expired');
    else run(next.command);}
  },
  release(){releaseAll();}
 };
}

const mod={VERSION,LIMITS,parseCommand,boundSnapshot,createGate,createController};
root.PGRazorRoutes=mod;
if(typeof module!=='undefined'&&module.exports)module.exports=mod;

})(typeof globalThis!=='undefined'?globalThis:this);
