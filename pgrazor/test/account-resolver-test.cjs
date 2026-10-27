// Run the production account resolver against scenes at each startup stage.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../diagnostics/quick-close.js'),'utf8');
const start=source.indexOf('   resolve:k=>{',source.indexOf('s.accounts=PGRazorAccounts.create('));
const end=source.indexOf('\n   }});',start);
assert.ok(start>=0&&end>start,'account resolver must be located');
const resolver=source.slice(start+'   resolve:'.length,end)+'}';
function fixture(stage,fail=false){
 const zero={isNull:()=>true},object=name=>({name,isNull:()=>false});
 const map=object('map'),container=object('container'),service=object('service'),roots=new Set(),calls=[];
 const lookup={map:'map-class',find:{method:'find'},container:{method:'container'},resolve:{method:'resolve'},typeObject:k=>k};
 const context={p:{items:{lookup}},ptr:()=>zero,api:{class_get_type:k=>k},itemArgs:a=>a,
  hold:o=>{roots.add(o);return o;},freeHandle:o=>roots.delete(o),
  invoke:(method,receiver)=>{calls.push(method);
   if(method==='find')return stage==='missing-map'?zero:map;
   if(method==='container'){assert.equal(receiver,map);return stage==='missing-container'?zero:container;}
   assert.equal(method,'resolve');assert.equal(receiver,container,'Resolve must never receive null');
   if(fail)throw Error('binding-not-ready');return service;
  }};
 const resolve=vm.runInNewContext('('+resolver+')',context);
 return {resolve,zero,service,roots,calls};
}
for(const stage of ['missing-map','missing-container','ready']){
 const f=fixture(stage);assert.equal(f.resolve('contract'),stage==='ready'?f.service:f.zero);
 assert.equal(f.roots.size,0,'temporary GC roots released');
 assert.equal(f.calls.includes('resolve'),stage==='ready');
}
{
 const f=fixture('ready',true);assert.throws(()=>f.resolve('contract'),/binding-not-ready/);assert.equal(f.roots.size,0);
}
console.log('Account resolver startup lifecycle passed');
