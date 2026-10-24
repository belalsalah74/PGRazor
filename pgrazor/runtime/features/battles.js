// Native feature instance; dependencies and metadata are supplied by quick-close.
(function(root){
 const features=root.PGRazorFeatures||(root.PGRazorFeatures={});
 features.battles=function({s,p,classes,rocketState,BATTLE_TYPES,RVCHARGE,unity,hold,freeHandle,target,alive,exact,readS32,readPtr,present,rocketBool,ptr,Memory,invoke,event,Interceptor}){
 const battleState={scope:null,mode:-1,swap:null,swapUntil:0,gesture:null,legacy:false,charges:[],maxMoves:[],next:0,dodgeUntil:0,dodgeNext:0,failed:false,lastLog:0};

 function battleDropGesture(){freeHandle(battleState.gesture);battleState.gesture=null;battleState.dodgeUntil=0;}

 function battleClear(){battleDropGesture();if(battleState.swap)freeHandle(battleState.swap.handle);battleState.swap=null;battleState.swapUntil=0;freeHandle(battleState.scope);for(const list of [battleState.charges,battleState.maxMoves])for(const h of list)freeHandle(h);Object.assign(battleState,{scope:null,mode:-1,charges:[],maxMoves:[],next:0,dodgeUntil:0,dodgeNext:0,failed:false});}

 function battleDodgeCue(mode){const r=battleState,now=s.now();if(r.scope&&r.mode===mode&&!r.failed&&now<s.battleLease&&(s.battleMask&(128<<mode))&&now>=r.dodgeNext&&!r.dodgeUntil){r.dodgeUntil=now+450;event(s,'battle-dodge-cue',{mode});}}

 function battleCapture(list,o){for(let i=list.length-1;i>=0;i--)if(!alive(target(list[i]))){freeHandle(list[i]);list.splice(i,1);}if(!list.some(h=>target(h).equals(o))&&list.length<8)list.push(hold(o));}

 // Open/close hooks yield before the game's picker code runs. Query its real visibility
 // so an animation or an implicit close cannot leave automation permanently paused.
 function battleSwapBlocked(now){const r=battleState;
  if(now<r.swapUntil)return true;
  if(!r.swap)return false;
  const o=target(r.swap.handle);
  if(alive(o)&&rocketBool(r.swap.show,o)){r.dodgeUntil=0;return true;}
  freeHandle(r.swap.handle);r.swap=null;r.swapUntil=now+600;r.next=Math.max(r.next,r.swapUntil);r.dodgeUntil=0;return true;
 }

 function battleTick(now){if(!p.battles)return;const r=battleState,t=p.battles,m=t.methods;

  if(s.stopping){battleClear();return;}if(!(now<s.battleLease)||!(s.battleMask&(128<<r.mode))||now>r.dodgeUntil)r.dodgeUntil=0;if(!r.scope||r.failed||!(now<s.battleLease)||rocketState.state)return;

  const mask=(s.battleMask>> (r.mode*2))&(r.mode===2?7:3);

  try{

   // Bread injects its gesture handler before entering the battle scope, so its
   // OnEnable/SetChargeAttackButtons callbacks may already have run. Recover the
   // scope-owned handler without depending on a first manual tap.
   if(r.mode===2&&!r.gesture){const scope=target(r.scope);if(alive(scope)){
    const g=readPtr(scope,t.fields.maxGesture);
    if(!g.isNull()&&exact(g,classes[BATTLE_TYPES[31285]])&&alive(g)&&rocketBool(m.active,g)){r.gesture=hold(g);r.legacy=false;event(s,'battle-input',{mode:2,legacy:false,source:'scope'});}
   }}

   // A battle scope survives the victory/results animation. Require live Active status

   // before any attack/button/dodge call; UI active/enabled alone is insufficient.

   if(!r.legacy){if(!r.gesture)return;const g=target(r.gesture);if(!alive(g)||!rocketBool(m.active,g))return;const director=readPtr(g,t.fields.director);if(director.isNull())return;

    const h=hold(invoke(m.currentState.method,director));let status;try{const state=target(h);if(!exact(state,classes[BATTLE_TYPES[44226]]))return;status=readS32(state,t.fields.battleStatus);}finally{freeHandle(h);}

    if(status!==t.statusActive){r.dodgeUntil=0;if(status!==t.statusUnset){event(s,'battle-ended',{mode:r.mode,status});battleClear();}return;}

   }

   if(battleSwapBlocked(now)){r.dodgeUntil=0;return;}

   if(r.dodgeUntil&&r.gesture){const g=target(r.gesture);if(alive(g)&&rocketBool(m.active,g)&&(r.legacy||present(g,p.rocket.vnext.fields.enabled,1))){

    const args=Memory.alloc(16),direction=Memory.alloc(4);direction.writeS32(t.dodgeLeft);

    if(r.legacy){const flick=readPtr(g,t.fields.legacyFlick);if(flick.isNull())return;args.writePointer(flick);args.add(8).writePointer(ptr(0));}else args.writePointer(direction);

    r.dodgeUntil=0;r.dodgeNext=now+700;r.next=now+500;invoke((r.legacy?m.legacyDodge:m.dodge).method,g,args);event(s,'battle-action',{mode:r.mode,action:'dodge'});return;

   }return;}

   if(now<r.next||!mask)return;

   if(r.mode===2&&(mask&4)){for(const h of r.maxMoves){const o=target(h);if(!alive(o)||readS32(o,t.fields.maxType)!==t.maxAttack)continue;const b=readPtr(o,t.fields.maxButton);

    if(!b.isNull()&&alive(b)&&rocketBool(m.active,b)&&rocketBool(p.rocket.methods.interactable,b)){r.next=now+700;invoke(m.press.method,b);event(s,'battle-action',{mode:r.mode,action:'max-attack'});return;}

   }}

   if(mask&2){for(const h of r.charges){const c=target(h);if(!alive(c)||!rocketBool(m.active,c))continue;const legacy=exact(c,classes[BATTLE_TYPES[9308]]),cm=legacy?m.legacyCharged:p.rocket.vnext.methods.charged;

    if(!rocketBool(cm,c)||(!legacy&&!rocketBool(p.rocket.vnext.methods.visible,c)))continue;const b=readPtr(c,legacy?t.fields.legacyButton:p.rocket.vnext.fields.button);

    if(b.isNull()||!alive(b)||!rocketBool(m.active,b)||!rocketBool(p.rocket.methods.interactable,b))continue;r.next=now+600;invoke((legacy?m.legacyCharge:p.rocket.vnext.methods.charge).method,c);event(s,'battle-action',{mode:r.mode,action:'charged'});return;

   }}

   if(!(mask&1)||!r.gesture)return;const g=target(r.gesture);if(!alive(g)||!rocketBool(m.active,g))return;

   if(!r.legacy&&!present(g,p.rocket.vnext.fields.enabled,1))return;

   const tap=readPtr(g,r.legacy?t.fields.legacyTap:p.rocket.vnext.fields.tap);if(tap.isNull())return;const args=Memory.alloc(16);args.writePointer(tap);args.add(8).writePointer(ptr(0));

   const method=r.legacy?m.legacyFast:r.mode===2?m.maxFast:m.raidFastAction;r.next=now+150;invoke(method.method,g,r.mode===0?undefined:args);if(now-r.lastLog>5000){r.lastLog=now;event(s,'battle-action',{mode:r.mode,action:'quick'});}

  }catch(e){r.failed=true;event(s,'battle-error',{mode:r.mode,reason:String(e)});}

 }

 if(p.battles){const t=p.battles,m=t.methods;

  function watch(method,callback){s.listeners.push(Interceptor.attach(method.address,{onEnter(a){if(!unity(this.threadId)||s.stopping)return;try{callback(a);}catch(e){battleState.failed=true;event(s,'battle-error',{reason:String(e)});}}}));}

  for(const q of t.swaps){
   watch(q.open,a=>{const r=battleState;if(!r.scope||r.mode!==q.mode||!exact(a[0],q.klass))return;if(r.swap)freeHandle(r.swap.handle);r.swap={handle:hold(a[0]),show:q.show};r.swapUntil=s.now()+600;r.dodgeUntil=0;event(s,'battle-manual-switch',{mode:r.mode,active:true});});
   for(const close of q.close)watch(close,a=>{const r=battleState;if(!r.swap||!target(r.swap.handle).equals(a[0]))return;freeHandle(r.swap.handle);r.swap=null;r.swapUntil=s.now()+600;r.next=Math.max(r.next,r.swapUntil);r.dodgeUntil=0;event(s,'battle-manual-switch',{mode:r.mode,active:false});});
  }

  for(const action of [m.legacyFast,m.legacyCharge])watch(action,a=>{if(battleState.scope&&battleState.mode===1)event(s,'cooldown-action',{action:'Gym battle'});});
  watch(m.raidWarning,a=>{if(exact(a[0],classes[BATTLE_TYPES[31623]]))battleDodgeCue(0);});

  watch(m.maxWarning,a=>{if(exact(a[0],classes[BATTLE_TYPES[31263]]))battleDodgeCue(2);});

  s.listeners.push(Interceptor.attach(m.gymWarning.address,{onEnter(a){this.warning=false;if(unity(this.threadId)&&!s.stopping&&battleState.mode===1&&exact(a[0],t.gymIterator)){const state=readS32(a[0],t.gymWarningState);this.warning=state===0||state===1;this.scope=battleState.scope;}},onLeave(ret){if(this.warning&&this.scope===battleState.scope&&ret.toInt32()===0)battleDodgeCue(1);}}));

  for(const scope of t.scopes){watch(scope.enter,a=>{battleClear();if(exact(a[0],scope.klass)){battleState.scope=hold(a[0]);battleState.mode=scope.mode;event(s,'battle-scope',{mode:scope.mode,active:true});}});watch(scope.exit,a=>{if(battleState.scope&&target(battleState.scope).equals(a[0])){event(s,'battle-scope',{mode:battleState.mode,active:false});battleClear();}});}

  function captureGesture(a,legacy){if(!battleState.scope)return;const mode=battleState.mode,k=legacy?BATTLE_TYPES[9182]:mode===2?BATTLE_TYPES[31285]:BATTLE_TYPES[31499];if((legacy&&mode!==1)||!exact(a[0],classes[k]))return;battleDropGesture();battleState.gesture=hold(a[0]);battleState.legacy=legacy;event(s,'battle-input',{mode,legacy});}

  for(const method of [m.enable,m.buttons])watch(method,a=>captureGesture(a,false));for(const method of [m.legacyEnable,m.legacyButtons])watch(method,a=>captureGesture(a,true));

  for(const method of [m.disable,m.legacyDisable,m.destroy])watch(method,a=>{if(battleState.gesture&&target(battleState.gesture).equals(a[0]))battleDropGesture();});

  watch(p.rocket.vnext.methods.observe,a=>{if(battleState.scope&&exact(a[0],classes[RVCHARGE]))battleCapture(battleState.charges,a[0]);});

  watch(m.legacyInit,a=>{if(battleState.scope&&battleState.mode===1&&exact(a[0],classes[BATTLE_TYPES[9308]]))battleCapture(battleState.charges,a[0]);});

  watch(m.maxRefresh,a=>{if(battleState.scope&&battleState.mode===2&&exact(a[0],classes[BATTLE_TYPES[31280]]))battleCapture(battleState.maxMoves,a[0]);});

  watch(m.maxCleanup,a=>{const list=battleState.maxMoves;for(let i=list.length-1;i>=0;i--)if(target(list[i]).equals(a[0])){freeHandle(list[i]);list.splice(i,1);}});

 }



 return {state:battleState,tick:battleTick};
 };
})(globalThis);
