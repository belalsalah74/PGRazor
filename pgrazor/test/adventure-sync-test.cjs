const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const classes={},events=[];let enabled=true,disposed=false;
for(const name of ['InitialDialog','ManualPermissionDialog','FinalDialog']) {
 const create={call:self=>self.created=true};
 const close={call:self=>{assert.ok(self.created);self.result=name==='FinalDialog'?'acknowledged':'cancelled';}};
 classes['com.nianticlabs.background.configuration.'+name]={onCreate:{overload:()=>create},
  [name==='FinalDialog'?'onClickClose':'onClickCancel']:{overload:()=>close},create};
}
const context={};vm.runInNewContext(fs.readFileSync('pgrazor/runtime/location.js','utf8'),context);
const api=context.PGRazorLocation.create({Java:{use:n=>{if(!classes[n])throw Error('Unavailable');return classes[n];}},
 control:{desiredEnabled:()=>enabled,event:(...e)=>events.push(e)},isDisposed:()=>disposed,bootLog:()=>{}});
api.installPermissions();
for(const [name,klass] of Object.entries(classes)) {
 function show(fine,coarse,finishing=false) {
  const activity={isFinishing:()=>finishing,checkSelfPermission:p=>p.endsWith('FINE_LOCATION')?fine:coarse};
  klass.create.implementation.call(activity,null);return activity;
 }
 assert.equal(show(-1,-1).result,name.endsWith('FinalDialog')?'acknowledged':'cancelled');
 assert.equal(show(0,-1).result,undefined);assert.equal(show(-1,0).result,undefined);
 assert.equal(show(-1,-1,true).result,undefined);
 enabled=false;assert.equal(show(-1,-1).result,undefined);enabled=true;
 disposed=true;assert.equal(show(-1,-1).result,undefined);disposed=false;
}
api.stop();for(const klass of Object.values(classes))assert.equal(klass.create.implementation,null);
console.log('PASS: Legacy Android Adventure Sync dialogs use Cancel/Close only with denied OS location grants; respects disabled/disposed lifecycle and removes hooks');
