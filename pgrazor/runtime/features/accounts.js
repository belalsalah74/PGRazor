// Account identity comes from authenticated PlayerService data, never a provider token.
(function(root){
'use strict';
function create(h){
 const {api,Memory,Interceptor}=h;
 let next=0,until=0,command='',used='',identity='',lastIdentity=0,loggingOut=false,futureHandle=0,authHandle=0,logoutAt=0;
 function klass(name){
  const count=Memory.alloc(8);count.writeU64(0);
  const list=api.domain_get_assemblies(api.domain_get(),count),n=count.readU64().toNumber();
  if(n<1||n>256||list.isNull())throw Error('assemblies');
  const i=name.lastIndexOf('.');
  for(let a=0;a<n;a++){
   const k=api.class_from_name(api.assembly_get_image(list.add(a*8).readPointer()),Memory.allocUtf8String(name.slice(0,i)),Memory.allocUtf8String(name.slice(i+1)));
   if(!k.isNull())return k;
  }throw Error('class:'+name);
 }
 function method(k,name,count,rva,prefix){
  const m=api.class_get_method_from_name(k,Memory.allocUtf8String(name),count);
  if(m.isNull()||!api.method_get_class(m).equals(k)||!m.readPointer().equals(h.module.base.add(rva)))throw Error('method:'+name);
  const bytes=new Uint8Array(m.readPointer().readByteArray(prefix.length/2));
  if(Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')!==prefix)throw Error('prefix:'+name);
  return m;
 }
 function field(k,name,offset){const f=api.class_get_field_from_name(k,Memory.allocUtf8String(name));
  if(f.isNull()||!api.field_get_parent(f).equals(k)||Number(api.field_get_offset(f))!==offset)throw Error('field:'+name);return f;}


 const player=klass('Niantic.Holoholo.PlayerService');
 const playerContract=klass('Niantic.Holoholo.IPlayerService');
 const auth=klass('Niantic.Platform.Auth.AuthService'),authContract=klass('Niantic.Platform.Auth.IAuthService');
 const wrapper=klass('Niantic.Holoholo.Login.AuthServiceLogOutWrapper'),wrapperContract=klass('Niantic.Holoholo.Login.IAuthServiceLogOutWrapper');
 const playerId=method(player,'get_PlayerId',0,178458668,'088440f9880000b4007940f9400000b4c0035fd6e83502d0');
 const playerName=method(player,'get_PlayerName',0,178459312,'088440f9880000b4000d40f9400000b4c0035fd6e83502d0');
 const connected=method(auth,'get_IsConnected',0,204755248,'00604039c0035fd601600039c0035fd6fe57bea9f44f01a9');
 const cached=method(auth,'get_CachedCredentialsExist',0,204755468,'fe0f1ff80a000094c00000b4081040b98800003420008052');
 field(auth,'activeAuthProvider',0x98);
 const logout=method(wrapper,'Logout',0,175973768,'fe57bea9f44f01a9d44702f0f30300aa88be6639a8010037');
 const authLogout=method(auth,'Logout',0,204773516,'fe0f1cf8f85f01a9f65702a9f44f03a9936c0190f40300aa');
 const future=klass('Niantic.Platform.Promises.Future');field(future,'_status',0x40);field(future,'_isDisposed',0x30);
 const status=klass('Niantic.Platform.Promises.PromiseStatus');
 function literal(name){const f=api.class_get_field_from_name(status,Memory.allocUtf8String(name)),v=Memory.alloc(4);
  if(f.isNull()||(api.field_get_flags(f)&0x8050)!==0x8050)throw Error('literal:'+name);api.field_static_get_value(f,v);return v.readS32();}
 const succeeded=literal('CompletedSucceeded'),failed=literal('CompletedFailed');
 function free(){if(futureHandle)h.freeHandle(futureHandle);if(authHandle)h.freeHandle(authHandle);futureHandle=authHandle=0;}
 function str(o){if(o.isNull())return '';const n=api.string_length(o);if(n<1||n>256)return '';return api.string_chars(o).readUtf16String(n);}
 function flag(method,o){const v=h.invoke(method,o);if(v.isNull())throw Error('missing-auth-state');return api.object_unbox(v).readU8()!==0;}
 function isConnected(o){return flag(connected,o);}
 function resetSignIn(){
  const prefs=klass('UnityEngine.PlayerPrefs');
  const has=method(prefs,'HasKey',1,228907924,'ffc300d1fe5701a9f44f02a9d4b400d0f30300aa88b25539');
  const remove=method(prefs,'DeleteKey',1,228908396,'ffc300d1fe5701a9f44f02a9d4b400d0f30300aa88b65539');
  const save=method(prefs,'Save',0,228908844,'fe4fbfa9d3b400d060ba42f9600000b4fe4fc1a800001fd6');
  const roots=[];
  try{
   // LoginState.get_IsBirthdateValid and bkzf check these exact PlayerPrefs keys.
   // Deleting both restores the game's DOB prompt; it does not supply an age or pass the gate.
   for(const key of ['4b9b44d8-66f5-46dc-86bb-0215bfa90f5e','80a6f7e6-1a8d-442e-bd95-74c795242b3f']){
    const value=api.string_new(Memory.allocUtf8String(key));roots.push(h.hold(value));
    const args=Memory.alloc(8);args.writePointer(value);
    h.invoke(remove,h.ptr(0),args);
    const result=h.invoke(has,h.ptr(0),args);
    if(result.isNull()||api.object_unbox(result).readU8())throw Error('login-reset-not-saved');
   }
   h.invoke(save,h.ptr(0));
   h.event('account-login-reset-complete',{});
  }finally{for(const handle of roots)h.freeHandle(handle);}
 }
 h.addListener(Interceptor.attach(authLogout.readPointer(),{
  onEnter(args){this.capture=loggingOut&&h.exact(args[0],auth);identity='';h.event('account-session-ended',{});},
  onLeave(value){if(this.capture&&h.exact(value,future)){if(futureHandle)h.freeHandle(futureHandle);futureHandle=h.hold(value);}}
 }));
 h.event('accounts-ready',{available:true});
 return {setOptions(allowed,value){until=allowed?h.now()+2000:0;command=allowed?String(value||''):'';},tick(now,tid){
  if(!h.unity(tid)||now<next)return;next=now+250;
  if(loggingOut){
   try{
    // Calls made from the Unity hook can suppress nested Interceptor callbacks.
    // The wrapper still executes normally: verify that it cleared both the live
    // provider and cached login selection before allowing a cold restart.
    if(!futureHandle&&authHandle){const a=h.target(authHandle);
     if(!h.exact(a,auth))throw Error('logout-auth-invalid');
     if(!isConnected(a)&&a.add(0x98).readPointer().isNull()&&!flag(cached,a)){
      free();loggingOut=false;identity='';h.event('account-logout-complete',{confirmation:'cleared-auth-state'});return;
     }
    }
    if(futureHandle&&authHandle){const f=h.target(futureHandle),a=h.target(authHandle);
     if(!h.exact(f,future)||!h.exact(a,auth)||f.add(0x30).readU8())throw Error('logout-future-invalid');
     const result=f.add(0x40).readS32();
     if(result===failed)throw Error('logout-failed');
     if(result===succeeded&&!isConnected(a)){
      free();loggingOut=false;h.event('account-logout-complete',{});return;
     }
    }
    if(now-logoutAt>15000)throw Error('logout-timeout');
   }catch(e){free();loggingOut=false;identity='';h.event('account-logout-failed',{reason:String(e)});}return;
  }
  if(now>=until)return;
  if(command.startsWith('save-session:')&&command!==used){
   used=command;
   try{
    const prefs=klass('UnityEngine.PlayerPrefs');
    const save=method(prefs,'Save',0,228908844,'fe4fbfa9d3b400d060ba42f9600000b4fe4fc1a800001fd6');
    h.invoke(save,h.ptr(0));h.event('account-session-saved',{});
   }catch(e){h.event('account-logout-failed',{reason:'session-save-unavailable'});}return;
  }
  if(command.startsWith('reset-login:')&&command!==used){
   used=command;
   try{resetSignIn();}catch(e){h.event('account-logout-failed',{reason:'login-reset-unavailable'});}return;
  }
  const roots=[],own=o=>{if(!o.isNull())roots.push(h.hold(o));return o;};
  try{
   const a=own(h.resolve(authContract));if(!h.exact(a,auth)||!isConnected(a))return;
   const p=own(h.resolve(playerContract));if(!h.exact(p,player))return;
   const id=str(own(h.invoke(playerId,p))),name=str(own(h.invoke(playerName,p)));
   if(!id||!name)return;
   if(command&&command!==used){
    const w=own(h.resolve(wrapperContract));if(!h.exact(w,wrapper))throw Error('logout-wrapper');
    used=command;loggingOut=true;logoutAt=now;authHandle=h.hold(a);
    h.invoke(logout,w);h.event('account-logout-requested',{futureCaptured:!!futureHandle});return;
   }
   if(id!==identity||now-lastIdentity>=5000){identity=id;lastIdentity=now;h.event('account-identity',{id,name});}
  }catch(e){if(loggingOut){free();loggingOut=false;identity='';h.event('account-logout-failed',{});}else {next=now+5000;h.event('accounts-read-error',{reason:String(e)});}}
  finally{for(const r of roots)h.freeHandle(r);}
 }};
}
root.PGRazorAccounts={create};
})(globalThis);
