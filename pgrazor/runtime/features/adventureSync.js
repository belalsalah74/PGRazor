// The current Adventure Sync SDK owns a dedicated Unity dialog controller.
(function(root){
'use strict';
function create(h){
 const {api,Memory,Interceptor}=h;
 let until=0;const pending=[];
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

 const controller=klass('Niantic.Platform.NiaAdvsyncPermissions.Internal.DialogController');
 const initial=method(controller,'InitializeAsInitial',4,202585836,'fe0f1af8fc6f01a9fa6702a9f85f03a9f65704a9f44f05a9');
 const instruction=method(controller,'InitializeAsInstruction',7,202588024,'fd7bbaa9fc6f01a9fa6702a9f85f03a9f65704a9f44f05a9');
 const result=method(controller,'InitializeAsResult',5,202592616,'ffc301d1fd7b01a9fc6f02a9fa6703a9f85f04a9f65705a9');
 const confirm=method(controller,'OnConfirm',0,202597316,'085440f9a80000b4002140f9011540f9020d40f940001fd6');
 const decline=method(controller,'OnDecline',0,202597344,'085840f9a80000b4002140f9011540f9020d40f940001fd6');
 const update=method(controller,'Update',0,202597372,'fe0f1ef8f44f01a9947d01f0f30300aa88ca46f9a80000b4');
 field(controller,'_onConfirm',0xa8);field(controller,'_onDecline',0xb0);
 function drop(i){const r=pending.splice(i,1)[0];h.freeHandle(r.handle);}
 function clear(o){for(let i=pending.length-1;i>=0;i--)if(h.target(pending[i].handle).equals(o))drop(i);}
 // Normal button handlers preserve the SDK's cancellation/completion callbacks.
 for(const m of [confirm,decline])h.addListener(Interceptor.attach(m.readPointer(),{onEnter(args){clear(args[0]);}}));
 for(const [m,action,offset,kind] of [[initial,decline,0xb0,'initial'],[instruction,decline,0xb0,'instruction'],[result,confirm,0xa8,'result']]){
  h.addListener(Interceptor.attach(m.readPointer(),{
   onEnter(args){this.o=args[0];this.eligible=h.now()<until&&h.unity(this.threadId)&&h.exact(args[0],controller);
    // Result's sole button acknowledges the outcome. Never invoke an enable action.
    h.event('adventure-sync-dialog',{dialog:kind,allowed:this.eligible});},
   onLeave(){try{
    clear(this.o);
    if(!this.eligible||h.now()>=until||pending.length>=4)return;
    const callback=this.o.add(offset).readPointer();if(callback.isNull())return;
    pending.push({handle:h.hold(this.o),action,offset,callback,kind,at:h.now()});
   }catch(e){h.event('adventure-sync-capture-error',{reason:String(e)});}}
  }));
 }
 h.addListener(Interceptor.attach(update.readPointer(),{
  onEnter(args){this.o=args[0];},onLeave(){try{
   if(!h.unity(this.threadId))return;
   for(let i=pending.length-1;i>=0;i--){const r=pending[i],o=h.target(r.handle);
    if(!o.equals(this.o))continue;
    if(h.now()>=until||h.now()-r.at>10000){drop(i);continue;}
    if(h.now()-r.at<100)continue;
    if(!h.exact(o,controller)||!o.add(r.offset).readPointer().equals(r.callback)){drop(i);continue;}
    // Remove before invoking: callbacks can synchronously create the result dialog.
    pending.splice(i,1);
    try{h.invoke(r.action,o);h.event('adventure-sync-native-dismissed',{dialog:r.kind});}
    finally{h.freeHandle(r.handle);}
   }
  }catch(e){h.event('adventure-sync-dismiss-error',{reason:String(e)});}}
 }));
 h.event('adventure-sync-native-ready',{});
 return {setAllowed(value){until=value?h.now()+2500:0;},tick(now,tid){
  if(!h.unity(tid))return;
  for(let i=pending.length-1;i>=0;i--)if(now>=until||now-pending[i].at>10000)drop(i);
 }};
}
root.PGRazorAdventureSync={create};
})(globalThis);
