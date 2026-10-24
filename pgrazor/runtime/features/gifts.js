// Native feature instance; dependencies and metadata are supplied by quick-close.
(function(root){
 const features=root.PGRazorFeatures||(root.PGRazorFeatures={});
 features.gifts=function({s,p,api,classes,fields,GIFT_TYPES,GIFT_OPEN_SEQUENCE,STATE_OPEN,ptr,Process,Memory,NativeFunction,NativeCallback,Interceptor,hold,target,freeHandle,alive,exact,readPtr,readS32,present,rocketBool,itemInt,itemArgs,itemNumber,invoke,event,unity}){
 // Gifts are scoped to the friend profile or incoming gift dialog the user opens.

 const guestOpenObservers=[];
 function guestOpenTick(){for(const observer of guestOpenObservers){
  if(!observer.root)continue;
  const gui=target(observer.root);
  if(s.stopping||!alive(gui)||(observer.fired&&readS32(gui,fields.currentState)!==STATE_OPEN)){
   freeHandle(observer.root);observer.root=null;observer.fired=false;continue;
  }
  if(!observer.fired&&readS32(gui,fields.currentState)===STATE_OPEN){observer.fired=true;observer.fn([gui]);}
 }}
 const incomingGift={gui:null,attempted:false,automated:false,deadline:0,next:0,wait:null};

 function incomingClear(){freeHandle(incomingGift.gui);Object.assign(incomingGift,{gui:null,attempted:false,automated:false,deadline:0,next:0,wait:null});}

 function incomingWait(reason){if(incomingGift.wait!==reason){incomingGift.wait=reason;event(s,'gift-wait',{reason,mask:s.giftMask||0});}}

 function incomingTick(now){const r=incomingGift,t=p.gifts;if(!t||!r.gui)return;

  try{const gui=target(r.gui);if(s.stopping||now>r.deadline||!alive(gui)){incomingClear();return;}

   if(r.attempted||now<r.next)return;r.next=now+100;

   if(!(s.giftMask&1)){incomingWait('Auto open is off');return;}if(!(now<s.giftLease)){incomingWait('Waiting for foreground readiness');return;}

   if(!giftOpen(r.gui)){incomingWait('Waiting for dialog to finish opening');return;}

   const details=readPtr(gui,t.fields.openDetails);if(!exact(details,classes['Holoholo.Rpc.GiftBoxDetailsProto'])||!giftText(readPtr(details,t.fields.sender))){incomingWait('Waiting for incoming gift details');return;}

   if(!giftButton(gui,t.fields.openButton)){incomingWait('Waiting for Open button');return;}

   r.attempted=true;r.automated=true;giftState.opened=true;giftState.checked=true;

   invoke(t.methods.open.method,gui);giftStatus('Opening gift');

  }catch(e){r.attempted=true;event(s,'gift-error',{reason:String(e)});}

 }

 const giftState={profile:null,open:null,send:null,list:null,sheet:null,giftWidgets:[],stickerWidgets:[],id:'',opened:false,checked:false,sent:false,chosen:false,stickerStarted:false,stickerClicked:false,phase:'idle',next:0,deadline:0,failed:false};

 function giftDrop(key){freeHandle(giftState[key]);giftState[key]=null;}

 function giftChildren(){giftSendRestore();for(const k of ['open','send','list','sheet','firstGift'])giftDrop(k);for(const w of giftState.giftWidgets){freeHandle(w.h);freeHandle(w.proto);}for(const h of giftState.stickerWidgets)freeHandle(h);giftState.giftWidgets=[];giftState.stickerWidgets=[];}

 function giftSendRestore(){const r=giftState.fastSend;if(!r)return;giftState.fastSend=null;try{const gui=target(r.gui);if(alive(gui))for(const [off,value] of r.values)gui.add(off).writeFloat(value);}finally{freeHandle(r.gui);}}

 function giftSendFast(gui){giftSendRestore();const values=p.gifts.sendDelays.map(off=>[off,gui.add(off).readFloat()]);if(values.some(v=>!Number.isFinite(v[1])))throw Error('gift-delay-invalid');giftState.fastSend={gui:hold(gui),values};for(const [off] of values)gui.add(off).writeFloat(0);}

 function giftReset(){giftChildren();giftDrop('profile');Object.assign(giftState,{id:'',opened:false,checked:false,sent:false,confirmed:false,listExiting:false,chosen:false,stickerStarted:false,stickerClicked:false,phase:'idle',next:0,deadline:0,failed:false});}

 function giftText(o){if(o.isNull())return '';const n=api.string_length(o);if(n<1||n>256)return '';return api.string_chars(o).readUtf16String(n);}

 function giftId(friend){if(!exact(friend,classes['Niantic.Platform.Internal.Protos.FriendDetailsProto']))return '';const player=readPtr(friend,p.gifts.fields.player);if(!exact(player,classes['Niantic.Platform.Internal.Protos.PlayerSummaryProto']))return '';return giftText(readPtr(player,p.gifts.fields.playerId));}

 function giftOpen(h){if(!h)return false;const o=target(h);return alive(o)&&readS32(o,fields.currentState)===STATE_OPEN;}

 function giftButton(o,f){const b=readPtr(o,f);return !b.isNull()&&alive(b)&&rocketBool(p.gifts.methods.active,b)&&rocketBool(p.gifts.methods.interactable,b);}

 function giftStatus(message){event(s,'gift-status',{message});}

 // A bundled send outlives the profile UI until the service completes it.

 let bundledGift=null;

 function giftVirtual(m,o,args){const concrete=api.object_get_virtual_method(o,m.method);if(concrete.isNull())throw Error('gift-virtual-method');return invoke(concrete,o,args);}

 function bundledClear(){const r=bundledGift;if(!r)return;bundledGift=null;

  try{if(r.reserved)invoke(p.gifts.methods.returnSticker.method,target(r.stickerService),itemArgs([target(r.stickerId),itemNumber(1)]));}catch(e){event(s,'gift-error',{reason:'sticker-release:'+e});}

  finally{for(const h of r.roots)freeHandle(h);}

 }

 function bundledQueue(panel){const f=p.gifts.fields,r={roots:[],issued:false,finished:false,result:null,reserved:false,deadline:s.now()+30000};

  const keep=o=>{const h=hold(o);r.roots.push(h);return h;};

  try{const data=readPtr(panel,f.data),friend=readPtr(data,f.panelFriend),id=giftId(friend);if(!id)throw Error('gift-recipient-missing');

   r.id=id;r.panel=keep(panel);r.friend=keep(friend);bundledGift=r;giftStatus('Preparing gift');

  }catch(e){for(const h of r.roots)freeHandle(h);throw e;}

 }

 function bundledTick(now){const r=bundledGift,t=p.gifts;if(!r)return;

  if(s.stopping){bundledClear();return;}

  if(r.issued){if(r.finished){giftStatus(r.result===t.sendSuccess?'Gift sent':r.result===null?'Gift send failed; no automatic retry':'Gift send failed (result '+r.result+')');event(s,'gift-bundled-result',{success:r.result===t.sendSuccess,result:r.result});bundledClear();}

   else if(now>r.deadline&&!r.timedOut){r.timedOut=true;giftStatus('Gift result pending; no automatic retry');}return;}

  if(!(s.giftMask&2)||!(now<s.giftLease)){bundledClear();return;}

  const m=t.methods,f=t.fields,keep=o=>{const h=hold(o);r.roots.push(h);return h;};

  try{const panel=target(r.panel),friend=target(r.friend);if(!alive(panel)||!giftState.profile||!invoke(m.panel.method,target(giftState.profile)).equals(panel)||giftId(readPtr(readPtr(panel,f.data),f.panelFriend))!==r.id){bundledClear();return;}

   if(!giftButton(panel,f.chooseButton)||present(panel,f.checkPending,1)||readS32(panel,f.checkResult)!==t.checkSuccess){giftStatus('Gift sending is not available for this friend yet');bundledClear();return;}

   const service=readPtr(panel,f.panelGifting),rpc=readPtr(panel,f.panelRpc);if(!exact(service,classes[GIFT_TYPES[6154]])||!exact(rpc,classes[GIFT_TYPES[6149]]))throw Error('gift-service-type');r.rpc=keep(rpc);

   const gifts=invoke(m.sendable.method,service);if(gifts.isNull())throw Error('gift-inventory-missing');keep(gifts);

   const enumerator=giftVirtual(m.getEnumerator,gifts);if(enumerator.isNull())throw Error('gift-enumerator-missing');keep(enumerator);let gift=null;

   try{const moved=giftVirtual(m.moveGift,enumerator);if(moved.isNull())throw Error('gift-enumerator-result');if(api.object_unbox(moved).readU8())gift=giftVirtual(m.currentGift,enumerator);if(gift&&!gift.isNull())keep(gift);}finally{giftVirtual(m.disposeGift,enumerator);}

   if(!gift||gift.isNull()){giftStatus('No gifts available');bundledClear();return;}if(!exact(gift,classes['Holoholo.Rpc.GiftBoxProto']))throw Error('gift-inventory-entry');

   const giftIdValue=Memory.alloc(8);api.field_get_value(gift,f.giftId,giftIdValue);if(giftIdValue.readU64().toString()==='0')throw Error('gift-id-zero');

   const player=readPtr(friend,f.player),playerId=readPtr(player,f.playerId),niaService=readPtr(panel,f.niaUtil);if(niaService.isNull())throw Error('gift-nia-service');

   const niaId=giftVirtual(m.niaId,niaService,itemArgs([player]));if(!giftText(niaId))throw Error('gift-nia-id');keep(niaId);

   let sticker=ptr(0);if(s.giftMask&4){const stock=readPtr(rpc,f.rpcStickers);if(!exact(stock,classes[GIFT_TYPES[6164]]))throw Error('gift-sticker-service');r.stickerService=keep(stock);

    const inventory=invoke(m.inventory.method,stock,itemArgs([itemNumber(0)]));if(!exact(inventory,t.stickerListClass))throw Error('sticker-inventory-type');keep(inventory);const count=itemInt(m.stickerCount,inventory);if(count<0||count>4096)throw Error('sticker-inventory-size');

    for(let i=0;i<count;i++){const candidate=invoke(m.stickerItem.method,inventory,itemArgs([itemNumber(i)]));if(!exact(candidate,classes['Holoholo.Rpc.StickerProto'])||itemInt(m.quantity,stock,itemArgs([candidate]))<=0)continue;

     sticker=candidate;keep(sticker);const stickerId=readPtr(sticker,f.stickerId);if(!giftText(stickerId))throw Error('gift-sticker-id');r.stickerId=keep(stickerId);invoke(m.reserve.method,stock,itemArgs([stickerId,itemNumber(1)]));r.reserved=true;break;}

   }

   // Do not override stamp errors or retry rejected requests silently.

   r.issued=true;r.deadline=now+30000;giftStatus('Sending gift');event(s,'gift-bundled-request',{sticker:!sticker.isNull()});

   const promise=invoke(m.rpcSend.method,rpc,itemArgs([giftIdValue,playerId,niaId,sticker,itemNumber(0)]));if(!promise.isNull())keep(promise);

  }catch(e){event(s,'gift-error',{reason:'bundled-send:'+e});if(r.issued){r.timedOut=true;giftStatus('Gift result uncertain; no automatic retry');}else bundledClear();}

 }

 function giftTick(now){const r=giftState,t=p.gifts;if(!t)return;guestOpenTick();bundledTick(now);incomingTick(now);if(s.stopping){incomingClear();giftReset();return;}

  if(!r.profile)return;if(!(now<s.giftLease)||!(s.giftMask&3)){if(r.phase!=='idle'){r.failed=true;giftChildren();}return;}if(r.failed||now<r.next)return;r.next=now+150;

  try{const m=t.methods,f=t.fields,profile=target(r.profile);if(!alive(profile)){giftReset();return;}

   const panel=invoke(m.panel.method,profile);if(!exact(panel,classes[GIFT_TYPES[5936]])||!alive(panel))return;

   const panelRoot=hold(panel);try{

    const data=readPtr(panel,f.data);if(data.isNull())return;const id=giftId(readPtr(data,f.panelFriend));if(!id)return;

    if(id!==r.id){if(r.id)giftChildren();Object.assign(r,{id,opened:false,checked:false,sent:false,confirmed:false,listExiting:false,chosen:false,stickerStarted:false,stickerClicked:false,phase:'idle',deadline:0});r.next=now+600;return;}

    if(r.deadline&&now>r.deadline){r.failed=true;giftChildren();giftStatus('Gift flow paused; finish manually or reopen this friend');return;}

    if(giftOpen(incomingGift.gui)||giftOpen(r.open))return;

    if(giftOpen(r.send)){

     if(!(s.giftMask&2)||r.sent)return;const gui=target(r.send);if(giftId(readPtr(gui,f.sendFriend))!==id){r.failed=true;return;}

     if((s.giftMask&4)&&!r.stickerStarted){

      r.stickerStarted=true;const selected=readPtr(gui,f.sendSticker);

      if(selected.isNull()){

       const service=readPtr(gui,f.stickerService);if(!exact(service,classes[GIFT_TYPES[6164]]))throw Error('sticker-service-type');

       // withEmptyStickers=false; recheck reservations before selecting an owned sticker.

       const inventory=invoke(m.inventory.method,service,itemArgs([itemNumber(0)]));if(!exact(inventory,t.stickerListClass))throw Error('sticker-inventory-type');

       const inventoryRoot=hold(inventory);try{const count=itemInt(m.stickerCount,inventory);if(count<0||count>4096)throw Error('sticker-inventory-size');

        for(let i=0;i<count;i++){const sticker=invoke(m.stickerItem.method,inventory,itemArgs([itemNumber(i)]));if(!exact(sticker,classes['Holoholo.Rpc.StickerProto'])||itemInt(m.quantity,service,itemArgs([sticker]))<=0)continue;

         const stickerRoot=hold(sticker);try{invoke(m.selectSticker.method,gui,itemArgs([sticker]));if(!readPtr(gui,f.sendSticker).equals(sticker))throw Error('sticker-selection-failed');r.stickerClicked=true;giftStatus('Added owned sticker');}finally{freeHandle(stickerRoot);}break;

        }

       }finally{freeHandle(inventoryRoot);}

      }

     }

     if(giftOpen(r.sheet))return;

     if(giftButton(gui,f.sendButton)){r.sent=true;r.phase='sent';r.deadline=now+30000;giftSendFast(gui);invoke(m.send.method,gui);giftStatus('Sending gift');}return;

    }

    if(giftOpen(r.list)){

     if(!(s.giftMask&2)||r.listExiting)return;

     const listGui=target(r.list);if(present(listGui,f.listSurprise,1))return;const rows=readPtr(listGui,f.rows);if(!exact(rows,t.rowsClass))return;const count=itemInt(m.rowCount,rows);

     if(r.confirmed||count===0){r.listExiting=true;r.phase='done';r.sent=true;r.deadline=0;invoke(m.listExit.method,listGui);giftStatus(r.confirmed?'Gift sent':'No gifts remaining');return;}

     if(r.chosen)return;

     if(!r.firstGift){const row=invoke(m.rowItem.method,rows,itemArgs([itemNumber(0)]));if(exact(row,classes[GIFT_TYPES[6211]])){const rowRoot=hold(row);try{const first=invoke(m.giftBox.method,row,itemArgs([itemNumber(0)]));if(exact(first,classes['Holoholo.Rpc.GiftBoxDetailsProto']))r.firstGift=hold(first);}finally{freeHandle(rowRoot);}}}

     if(!r.firstGift)return;const selected=readPtr(target(r.list),f.selected);if(!exact(selected,t.selectedClass))return;

     const callbackRoot=hold(selected);try{r.chosen=true;r.phase='selected';r.deadline=now+15000;invoke(m.selectFirst.method,selected,itemArgs([target(r.firstGift)]));giftStatus('Selected first inventory gift');}finally{freeHandle(callbackRoot);}return;

    }

    // Do not start another flow while a gift screen is still closing or loading.

    if(r.phase==='opening'||r.phase==='list'||r.phase==='selected'||r.phase==='sticker')return;

    if(!giftOpen(r.profile)||rocketBool(m.disabled,profile))return;

    if((s.giftMask&1)&&!r.checked){r.checked=true;r.next=now+1200;if(rocketBool(m.check,panel)){r.phase='opening';r.deadline=now+30000;r.next=now+500;}return;}

    // Sending is armed only by the player's OnGiftClick; visiting a profile never sends.

    r.deadline=0;

   }finally{freeHandle(panelRoot);}

  }catch(e){r.failed=true;giftChildren();event(s,'gift-error',{reason:String(e)});}

 }

 event(s,'gift-ready',{available:!!p.gifts,reason:p.giftsError});

 if(p.gifts){const m=p.gifts.methods,f=p.gifts.fields;

  function giftObserve(method,fn,after=false){
   // These exact-build HandleOpenComplete methods are a single RET. Houdini
   // cannot allocate a nearby hook trampoline. Observe the validated GUI's
   // completed-open state instead, after its normal visibility transition.
   if(typeof PGRazorGuestCode==='function'&&after&&(method===m.openReady||method===m.listReady)&&method.address.readU32()===0xd65f03c0){
    if(!p.catchCanvas)throw Error('guest-gift-visibility-unavailable');
    guestOpenObservers.push({klass:classes[GIFT_TYPES[method===m.openReady?6240:6268]],fn,root:null,fired:false});return;
   }
   s.listeners.push(Interceptor.attach(method.address,{onEnter(a){this.roots=[];this.args=null;if(!unity(this.threadId)||s.stopping)return;try{if(after){this.args=[a[0],a[1],a[2]];this.roots.push(hold(a[0]));if(method===m.giftUpdate&&!a[2].isNull())this.roots.push(hold(a[2]));}else fn(a);}catch(e){giftState.failed=true;event(s,'gift-error',{reason:String(e)});}},onLeave(){try{if(this.args&&!s.stopping)fn(this.args);}catch(e){giftState.failed=true;event(s,'gift-error',{reason:String(e)});}finally{for(const h of this.roots)freeHandle(h);}}}));}

  giftObserve(m.sequence,a=>{const r=incomingGift;if(!r.gui||!r.automated||!(s.giftMask&1)||!(s.now()<s.giftLease)||!exact(a[0],classes[GIFT_OPEN_SEQUENCE]))return;const gui=readPtr(a[0],f.sequenceGui),response=readPtr(a[0],f.sequenceResponse);if(!gui.equals(target(r.gui))||!exact(response,classes['Holoholo.Rpc.OpenGiftOutProto'])||readS32(response,f.openResult)!==p.gifts.openSuccess||readS32(a[0],f.sequenceState)!==0)return;

   // Exact-build state 3 retains friendship callback + normal Dismiss after successful response.

   // States 0..2 are gift animation, reward display preparation and reward presentation.

   a[0].add(0x10).writeS32(3);event(s,'gift-presentation-skipped',{kindOfGift:'received'});

  });

  const sendOriginal=new NativeFunction(m.choose.address,'void',['pointer','pointer'],{scheduling:'exclusive',exceptions:'propagate'});

  const sendReplacement=new NativeCallback(function(panel,info){

   if(!unity(Process.getCurrentThreadId())||s.stopping||!s.ready)return sendOriginal(panel,info);

   if(bundledGift){giftStatus('Gift send already pending');return;}

   if(!(s.giftMask&2)||!(s.now()<s.giftLease))return sendOriginal(panel,info);

   try{const r=giftState;if(!r.profile||!exact(panel,classes[GIFT_TYPES[5936]]))return sendOriginal(panel,info);const profile=target(r.profile);

    if(!alive(profile)||!invoke(m.panel.method,profile).equals(panel)||rocketBool(m.disabled,profile)||!giftButton(panel,f.chooseButton))return;

    bundledQueue(panel);

   }catch(e){event(s,'gift-error',{reason:'bundled-trigger:'+e});}

  },'void',['pointer','pointer']);

  Interceptor.replace(m.choose.address,sendReplacement);s.listeners.push({detach(){Interceptor.revert(m.choose.address);}});s.giftSendReplacement={original:sendOriginal,replacement:sendReplacement};

  function ownedCallback(o){const r=bundledGift;return r&&r.issued&&r.rpc&&exact(o,p.gifts.callbackClass)&&readPtr(o,f.callbackService).equals(target(r.rpc))&&giftText(readPtr(o,f.callbackId))===r.id;}

  giftObserve(m.rpcResult,a=>{if(ownedCallback(a[0])&&exact(a[1],classes['Holoholo.Rpc.SendGiftOutProto']))bundledGift.result=readS32(a[1],f.sendResult);});

  giftObserve(m.rpcFinally,a=>{if(ownedCallback(a[0]))bundledGift.finished=true;},true);

  giftObserve(m.profileOpen,a=>{giftReset();giftState.profile=hold(a[0]);giftState.next=s.now()+200;},true);

  giftObserve(m.profileClose,a=>{if(giftState.profile&&target(giftState.profile).equals(a[0]))giftReset();});

  giftObserve(m.openReady,a=>{if(!exact(a[0],classes[GIFT_TYPES[6240]]))return;incomingClear();incomingGift.gui=hold(a[0]);incomingGift.deadline=s.now()+30000;incomingGift.next=s.now()+100;if(giftState.profile){giftDrop('open');giftState.open=hold(a[0]);}event(s,'gift-dialog',{source:'incoming',profilePresent:!!giftState.profile});},true);

  giftObserve(m.open,a=>{if(incomingGift.gui&&target(incomingGift.gui).equals(a[0]))incomingGift.attempted=true;});

  giftObserve(m.openClose,a=>{if(incomingGift.gui&&target(incomingGift.gui).equals(a[0]))incomingClear();if(giftState.open&&target(giftState.open).equals(a[0]))giftDrop('open');giftState.checked=true;giftState.phase='idle';giftState.deadline=0;giftState.next=s.now()+600;});

  for(const [key,ready,close,owner] of [['send',m.sendReady,m.sendClose,6258],['sheet',m.sheetReady,m.sheetClose,6195]]){

   giftObserve(ready,a=>{const r=giftState;if(!r.profile||!exact(a[0],classes[GIFT_TYPES[owner]]))return;if(key==='send'&&r.phase!=='selected')return;if(key==='sheet'&&!r.stickerStarted)return;giftDrop(key);r[key]=hold(a[0]);},true);

   giftObserve(close,a=>{const r=giftState;if(r[key]&&target(r[key]).equals(a[0])){if(key==='send')giftSendRestore();giftDrop(key);r.next=s.now()+150;if(key==='open'){r.checked=true;r.phase='idle';r.deadline=0;}if(key==='send'){r.phase='done';r.deadline=0;}}});

  }

  giftObserve(m.listInit,a=>{if(giftState.profile&&giftState.phase==='list'&&!a[1].isNull()&&!present(a[1],f.surprise,1)){giftDrop('list');giftDrop('firstGift');giftState.list=hold(a[0]);const list=readPtr(a[1],f.listItems);if(exact(list,p.gifts.listClass)&&itemInt(m.listCount,list)>0){const first=invoke(m.listItem.method,list,itemArgs([itemNumber(0)]));if(exact(first,classes['Holoholo.Rpc.GiftBoxDetailsProto']))giftState.firstGift=hold(first);}event(s,'gift-list',{firstAvailable:!!giftState.firstGift,deleteIcons:present(a[1],f.deleteMode,1)});}});

  giftObserve(m.listReady,a=>{const r=giftState;if(!r.profile||!['list','selected','sent','done'].includes(r.phase)||present(a[0],f.listSurprise,1))return;giftDrop('list');r.list=hold(a[0]);r.listExiting=false;r.next=s.now()+100;event(s,'gift-list-ready',{phase:r.phase});},true);

  giftObserve(m.sendResult,a=>{const r=giftState;if(!r.sent||!r.send||!target(r.send).equals(a[0])||!exact(a[1],classes['Holoholo.Rpc.SendGiftOutProto']))return;r.confirmed=readS32(a[1],f.sendResult)===p.gifts.sendSuccess;event(s,'gift-send-result',{success:r.confirmed});});

  giftObserve(m.listClose,a=>{if(giftState.list&&target(giftState.list).equals(a[0])){giftDrop('list');if(!giftState.chosen&&!giftState.listExiting)giftState.failed=true;}});

  giftObserve(m.giftUpdate,a=>{const r=giftState,index=a[1].toInt32();if(!r.profile||r.phase!=='list'||index<0||index>1||!exact(a[2],classes['Holoholo.Rpc.GiftBoxDetailsProto']))return;const old=r.giftWidgets.findIndex(w=>target(w.h).equals(a[0])&&w.index===index);if(old>=0){freeHandle(r.giftWidgets[old].h);freeHandle(r.giftWidgets[old].proto);r.giftWidgets.splice(old,1);}if(r.giftWidgets.length<32)r.giftWidgets.push({h:hold(a[0]),index,proto:hold(a[2])});},true);

  giftObserve(m.stickerInit,a=>{const r=giftState;if(r.profile&&r.stickerStarted&&r.stickerWidgets.length<256&&!r.stickerWidgets.some(h=>target(h).equals(a[0])))r.stickerWidgets.push(hold(a[0]));},true);

  if(guestOpenObservers.length)s.listeners.push(Interceptor.attach(p.catchCanvas.address,{onEnter(a){
   if(!unity(this.threadId)||s.stopping)return;
   try{for(const observer of guestOpenObservers){if(!exact(a[0],observer.klass))continue;
    if(observer.root&&target(observer.root).equals(a[0]))continue;
    if(observer.root)freeHandle(observer.root);observer.root=hold(a[0]);observer.fired=false;
   }}catch(e){giftState.failed=true;event(s,'gift-error',{reason:'guest-visibility:'+e});}
  }}));
 }


 return {state:giftState,tick:giftTick,bundled:()=>bundledGift};
 };
})(globalThis);
