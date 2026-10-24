// Shipped ARM64 build only. Loading defines an API and performs no native work.
// Each successful yield is validated before its presentation wait is shortened.
// setAllowed(true) grants only a 2500ms lease; there is no persistent enable bit.
(function(root) {
    'use strict';
    const LIMITS=Object.freeze({leaseMs:2500,pollMs:250,retries:20,assemblies:256,nested:64,
        nameBytes:256,queue:128,maxDuration:30,hitsPerSecond:1000});
    const CAPTURE='Niantic.Holoholo.Encounter.EncounterCaptureState';
    const RESPONSE='Holoholo.Rpc.CatchPokemonOutProto';
    const WAIT='Niantic.Zeppelin.Scheduler.Wait';
    const ENUM=RESPONSE+'.Types.Status';
    const DEBUG=[0x90051008,0xf9474508,0xb4000148,0x90051009,0xf9474929,0xb40000e9,
        0xf940040a,0xeb0a011f,0x2a1f03e8,0x54000128,0xeb0a013f,0x540000e3,
        0xb40000a1,0xf9400408,0xb900083f,0xf900083f,0xf9000028,0x52800028,
        0x2a0803e0,0xd65f03c0];
    const HEAD='ffc302d1e82300fdfd7b05a9fc6f06a9fa6707a9f85f08a9f65709a9f44f0aa9';
    const YIELD='a9c244b9e80313aa081000bd008d01f86901003409fd4cd3088152d3ca1f02f04a013f912b008052480d088b6021c99a08194191018113911d5b6596e800805279000014';
    const SPEC={domain_get:['pointer',[]],domain_get_assemblies:['pointer',['pointer','pointer']],
        assembly_get_image:['pointer',['pointer']],class_from_name:['pointer',['pointer','pointer','pointer']],
        class_get_type:['pointer',['pointer']],class_get_name:['pointer',['pointer']],
        class_get_nested_types:['pointer',['pointer','pointer']],class_get_declaring_type:['pointer',['pointer']],
        class_get_field_from_name:['pointer',['pointer','pointer']],field_get_type:['pointer',['pointer']],
        field_get_flags:['int',['pointer']],field_get_parent:['pointer',['pointer']],field_get_offset:['size_t',['pointer']],
        class_get_method_from_name:['pointer',['pointer','pointer','int']],method_get_class:['pointer',['pointer']],
        method_get_flags:['uint32',['pointer','pointer']],method_get_param_count:['uint32',['pointer']],
        method_get_return_type:['pointer',['pointer']],method_is_generic:['bool',['pointer']],method_is_inflated:['bool',['pointer']],
        class_from_type:['pointer',['pointer']],class_is_enum:['bool',['pointer']],class_enum_basetype:['pointer',['pointer']],
        class_value_size:['int',['pointer','pointer']],field_static_get_value:['void',['pointer','pointer']],
        type_get_name:['pointer',['pointer']],free:['void',['pointer']],thread_current:['pointer',[]],
        thread_attach:['pointer',['pointer']],thread_detach:['void',['pointer']],
        object_get_class:['pointer',['pointer']],field_get_value:['void',['pointer','pointer','pointer']],
        field_set_value:['void',['pointer','pointer','pointer']]};
    let running=null;
    function text(p) {
        if(p.isNull())throw Error('null-name');
        let n=0;while(n<LIMITS.nameBytes && p.add(n).readU8())n++;
        if(n===LIMITS.nameBytes)throw Error('name-limit');
        return n?p.readUtf8String(n):'';
    }
    function bind(module) {
        const api={};
        for(const [key,[result,args]] of Object.entries(SPEC)) {
            const address=module.findExportByName('il2cpp_'+key);
            if(!address || address.isNull())throw Error('missing-export:'+key);
            api[key]=new NativeFunction(address,result,args,{scheduling:'exclusive'});
        }
        return api;
    }
    function typeName(api,type) {
        const value=api.type_get_name(type);
        if(value.isNull())throw Error('null-type-name');
        try{return text(value);}finally{api.free(value);}
    }
    function clock() {
        const libc=Process.findModuleByName('libc.so');
        const address=libc&&libc.findExportByName('clock_gettime');
        if(!address || address.isNull())throw Error('missing-monotonic-clock');
        const call=new NativeFunction(address,'int',['int','pointer'],{scheduling:'exclusive'});
        const out=Memory.alloc(16);let previous=-1;
        return ()=>{
            if(call(7,out)!==0)throw Error('monotonic-clock-failed');
            const sec=out.readS64().toNumber(),ns=out.add(8).readS64().toNumber(),now=sec*1000+ns/1e6;
            if(!Number.isSafeInteger(sec)||sec<0||ns<0||ns>=1e9||!Number.isFinite(now)||now<previous)throw Error('invalid-monotonic-clock');
            previous=now;return now;
        };
    }
    function checkBytes(address,hex) {
        const bytes=new Uint8Array(address.readByteArray(hex.length/2));
        if(bytes.length!==hex.length/2)throw Error('short-instruction-read');
        for(let i=0;i<bytes.length;i++)if(bytes[i]!==parseInt(hex.slice(i*2,i*2+2),16))throw Error('unsupported-instructions');
    }
    function executable(module,address,size) {
        if(address.isNull()||!address.and(3).isNull()||address.compare(module.base)<0||address.add(size).compare(module.base.add(module.size))>0)throw Error('invalid-code-range');
        const range=Process.findRangeByAddress(address);
        if(!range||range.protection.indexOf('r')<0||!(range.protection.includes('x')||(typeof PGRazorGuestCode==='function'&&PGRazorGuestCode(module,address,size,range)))||address.add(size).compare(range.base.add(range.size))>0)throw Error('code-not-rx');
    }
    function prepare(module,api,domain) {
        let owned=null;
        try {
            if(api.thread_current().isNull()) {owned=api.thread_attach(domain);if(owned.isNull())throw Error('thread-attach-failed');}
            const count=Memory.alloc(8);count.writeU64(0);
            const assemblies=api.domain_get_assemblies(domain,count),total=count.readU64();
            if(total.compare(0)===0)return null;
            if(total.compare(LIMITS.assemblies)>0||assemblies.isNull())throw Error('assembly-limit');
            const classes=new Map(),wanted=[CAPTURE,RESPONSE,WAIT];
            const inputs=wanted.map(full=>{const dot=full.lastIndexOf('.');return [full,Memory.allocUtf8String(full.slice(0,dot)),Memory.allocUtf8String(full.slice(dot+1))];});
            for(let i=0;i<total.toNumber();i++) {
                const image=api.assembly_get_image(assemblies.add(i*8).readPointer());
                if(image.isNull())continue;
                for(const [full,ns,name] of inputs) {
                    const found=api.class_from_name(image,ns,name);if(found.isNull())continue;
                    if(typeName(api,api.class_get_type(found))!==full)throw Error('class-name-mismatch');
                    if(classes.has(full)&&!classes.get(full).equals(found))throw Error('duplicate-class');
                    classes.set(full,found);
                }
            }
            if(classes.size!==3)return null;
            const capture=classes.get(CAPTURE),response=classes.get(RESPONSE),wait=classes.get(WAIT);
            const iterator=Memory.alloc(8);iterator.writePointer(ptr(0));let coroutine=null,ended=false;
            for(let i=0;i<LIMITS.nested;i++) {
                const k=api.class_get_nested_types(capture,iterator);if(k.isNull()){ended=true;break;}
                if(text(api.class_get_name(k))!=='ebk')continue;
                if(coroutine||!api.class_get_declaring_type(k).equals(capture))throw Error('nested-owner-mismatch');
                coroutine=k;
            }
            if(!ended||!coroutine)throw Error('missing-or-unbounded-coroutine');
            const fieldMetadata=[];
            function field(owner,name,expected,offset) {
                const f=api.class_get_field_from_name(owner,Memory.allocUtf8String(name));
                const details={field:name,expectedType:expected,expectedOffset:offset,
                    actualType:null,actualOffset:null,actualFlags:null,ownerMatches:false};
                if(!f.isNull()) {
                    details.ownerMatches=api.field_get_parent(f).equals(owner);
                    details.actualFlags=api.field_get_flags(f);
                    details.actualType=typeName(api,api.field_get_type(f));
                    details.actualOffset=Number(api.field_get_offset(f).toString());
                }
                // Status is read through field_get_value, never a raw offset.
                // Its owner/type/enum ABI are authoritative. Exact layout guards
                // remain required for every coroutine and Wait field.
                const offsetValid=Number.isSafeInteger(details.actualOffset)&&details.actualOffset>=16&&
                    details.actualOffset<=4096&&(offset===null||details.actualOffset===offset);
                if(f.isNull()||!details.ownerMatches||details.actualFlags&0x50||details.actualType!==expected||!offsetValid) {
                    const error=Error('field-mismatch:'+name);error.details=details;throw error;
                }
                fieldMetadata.push(details);
                return f;
            }
            const fields={state:field(coroutine,'drny','System.Int32',0x10),current:field(coroutine,'drnz','Niantic.Zeppelin.Scheduler.ISchedule',0x18),
                owner:field(coroutine,'<>4__this',CAPTURE,0x20),response:field(coroutine,'captureResults',RESPONSE,0x28),
                branch:field(coroutine,'drog','System.Boolean',0x60),duration:field(wait,'<SleepFor>k__BackingField','System.Single',0x10),
                status:field(response,'Status',ENUM,null)};
            const enumClass=api.class_from_type(api.field_get_type(fields.status)),align=Memory.alloc(4);
            if(enumClass.isNull()||!api.class_is_enum(enumClass)||typeName(api,api.class_enum_basetype(enumClass))!=='System.Int32'||
                api.class_value_size(enumClass,align)!==4||align.readU32()!==4)throw Error('enum-abi-mismatch');
            const success=api.class_get_field_from_name(enumClass,Memory.allocUtf8String('CatchSuccess'));
            if(success.isNull()||!api.field_get_parent(success).equals(enumClass)||(api.field_get_flags(success)&0x8050)!==0x8050||
                typeName(api,api.field_get_type(success))!==ENUM)throw Error('success-literal-mismatch');
            const value=Memory.alloc(4);api.field_static_get_value(success,value);const successValue=value.readS32();
            const debugAddress=module.findExportByName('il2cpp_debug_get_method_info');
            if(!debugAddress)throw Error('missing-debug-export');executable(module,debugAddress,80);
            for(let i=0;i<DEBUG.length;i++)if(debugAddress.add(i*4).readU32()!==DEBUG[i])throw Error('debug-abi-mismatch');
            const debug=new NativeFunction(debugAddress,'bool',['pointer','pointer'],{scheduling:'exclusive'});
            function method(owner,name,ret,rva,bytes) {
                const m=api.class_get_method_from_name(owner,Memory.allocUtf8String(name),0),flags=Memory.alloc(4);
                if(m.isNull()||!api.method_get_class(m).equals(owner)||api.method_get_flags(m,flags)&16||api.method_get_param_count(m)!==0||
                    api.method_is_generic(m)||api.method_is_inflated(m)||typeName(api,api.method_get_return_type(m))!==ret)throw Error('method-mismatch:'+name);
                const out=Memory.alloc(24);out.writeByteArray(new Uint8Array(24));
                if(!debug(m,out))throw Error('method-address-unavailable');const address=out.readPointer();
                if(!address.equals(module.base.add(rva)))throw Error('unsupported-method-rva:'+name);
                executable(module,address,bytes.length/2);checkBytes(address,bytes);return address;
            }
            const address=method(coroutine,'MoveNext','System.Boolean',0xacf24fc,HEAD);
            executable(module,address,0x29e4);checkBytes(module.base.add(0xacf4c84),YIELD);
            checkBytes(module.base.add(0xacf4ea8),'681200b920008052');
            // ActiveCoroutine.Step reads the yielded duration after MoveNext,
            // then computes/stores WakeTime. No constructor-time deadline.
            executable(module,module.base.add(0xe1181b4),16);
            checkBytes(module.base.add(0xe1181b4),'00013fd60029201e68424139603200bd');
            method(wait,'get_SleepFor','System.Single',0xe120fec,'001040bdc0035fd6');
            method(wait,'.ctor','System.Void',0xe120fd8,'c0035fd6');
            method(wait,'Clear','System.Void',0xe1210a0,'1f1000b9c0035fd6');
            return {api,fields,fieldMetadata,capture,response,wait,coroutine,address,successValue};
        }finally{if(owned!==null&&!owned.isNull())api.thread_detach(owned);}
    }
    function emit(state,event) {
        try{console.log('[pgrazor-quick-summary] '+JSON.stringify(event));}catch(_){}
        if(typeof state.onEvent==='function')try{state.onEvent(event);}catch(_){}
    }
    function enqueue(state,event) {
        if(state.queue.length>=LIMITS.queue)throw Error('event-queue-limit');
        state.queue.push(event);
    }
    function fail(state,error) {state.reason=String(error).slice(0,180);state.allowedUntil=0;}
    function observe(state,p) {
        const {api,fields}=p,ptrOut=Memory.alloc(8),intOut=Memory.alloc(4),floatOut=Memory.alloc(4),boolOut=Memory.alloc(1);
        function exact(object,klass) {return !object.isNull()&&api.object_get_class(object).equals(klass);}
        function pointer(object,field) {ptrOut.writePointer(ptr(0));api.field_get_value(object,field,ptrOut);return ptrOut.readPointer();}
        function integer(object,field) {intOut.writeS32(0);api.field_get_value(object,field,intOut);return intOut.readS32();}
        function duration(object) {floatOut.writeFloat(0);api.field_get_value(object,fields.duration,floatOut);return floatOut.readFloat();}
        let depth=0,windowStart=state.now(),hits=0,thread=null;
        state.listener=Interceptor.attach(p.address,{
            onEnter(args) {
                this.quickReceiver=null;
                if(!state.active||state.reason||depth)return;
                try {
                    const now=state.now();if(now-windowStart>=1000){windowStart=now;hits=0;}
                    if(++hits>LIMITS.hitsPerSecond)throw Error('callback-rate-limit');
                    if(api.thread_current().isNull())throw Error('callback-thread-unattached');
                    const tid=Process.getCurrentThreadId();
                    if(thread!==null&&thread!==tid)throw Error('callback-thread-changed');thread=tid;
                    if(!exact(args[0],p.coroutine))throw Error('coroutine-object-mismatch');
                    this.quickReceiver=args[0];this.quickTid=tid;depth++;
                }catch(e){fail(state,e);}
            },
            onLeave(retval) {
                const receiver=this.quickReceiver;this.quickReceiver=null;
                if(!receiver)return;depth--;
                if(!state.active||state.reason)return;
                try {
                    if(retval.toInt32()!==1||integer(receiver,fields.state)!==7)return;
                    if(!exact(receiver,p.coroutine))throw Error('coroutine-object-changed');
                    const owner=pointer(receiver,fields.owner),response=pointer(receiver,fields.response),wait=pointer(receiver,fields.current);
                    if(!exact(owner,p.capture)||!exact(response,p.response)||!exact(wait,p.wait))throw Error('yield-object-mismatch');
                    const resultStatus=integer(response,fields.status);if(resultStatus!==p.successValue)return;
                    const original=duration(wait);if(!Number.isFinite(original)||original<0||original>LIMITS.maxDuration)throw Error('invalid-wait-duration');
                    api.field_get_value(receiver,fields.branch,boolOut);const branch=boolOut.readU8();if(branch>1)throw Error('invalid-branch');
                    const now=state.now(),receipt={tid:this.quickTid,state:7,resultStatus,originalSeconds:original,branch:branch===1,boottimeMs:now};
                    // Reserve every event before any mutation, including the write receipt.
                    if(state.queue.length+2>LIMITS.queue)throw Error('event-queue-limit');
                    enqueue(state,Object.assign({kind:'wait-observed'},receipt));
                    if(now>=state.allowedUntil||original<=0.1)return;
                    // Revalidate immediately before the sole scalar write. No game methods.
                    if(!pointer(receiver,fields.current).equals(wait)||duration(wait)!==original)throw Error('yield-changed-before-write');
                    floatOut.writeFloat(0.1);api.field_set_value(wait,fields.duration,floatOut);
                    const actual=duration(wait);if(Math.abs(actual-0.1)>1e-6)throw Error('duration-write-verification-failed');
                    enqueue(state,Object.assign({kind:'wait-shortened',newSeconds:actual},receipt));
                }catch(e){fail(state,e);}
            }
        });
    }
    function start(options) {
        if(!options||options.enabled!==true)return Promise.resolve({status:'disabled'});
        if(running)return Promise.resolve({status:'already-running'});
        return new Promise(resolve=>{
            const state={active:true,onEvent:options.onEvent,queue:[],reason:null,ready:false,allowedUntil:0,
                timer:null,listener:null,now:null,attempts:0,finish:null};running=state;
            state.finish=result=>{
                if(!state.active)return;state.active=false;state.allowedUntil=0;
                if(state.timer!==null)clearTimeout(state.timer);
                if(state.listener)try{state.listener.detach();}catch(_){}
                running=null;setTimeout(()=>{for(const row of state.queue.splice(0))emit(state,row);emit(state,Object.assign({kind:'finished'},result));resolve(result);},0);
            };
            function poll() {
                if(!state.active)return;state.timer=null;
                try {state.now();for(const row of state.queue.splice(0)){if(!state.active)return;emit(state,row);}}
                catch(e){fail(state,e);}
                if(!state.active)return;
                if(state.reason){state.finish({status:'unavailable',reason:state.reason});return;}
                state.timer=setTimeout(poll,LIMITS.pollMs);
            }
            function attempt() {
                if(!state.active)return;state.timer=null;state.attempts++;
                try {
                    if(Process.arch!=='arm64'||Process.pointerSize!==8){state.finish({status:'skipped',reason:'native-arm64-required'});return;}
                    const module=Process.findModuleByName('libil2cpp.so');let prepared=null;
                    if(module) {
                        const elf=new Uint8Array(module.base.readByteArray(20));
                        if(elf[0]!==127||elf[1]!==69||elf[2]!==76||elf[3]!==70||elf[4]!==2||elf[5]!==1||elf[18]!==183||elf[19]!==0)throw Error('unsupported-library-architecture');
                        if(!state.now)state.now=clock();
                        const api=bind(module),domain=api.domain_get();
                        if(!domain.isNull())prepared=prepare(module,api,domain);
                    }
                    if(!prepared) {
                        if(state.attempts>=LIMITS.retries)state.finish({status:'unavailable',reason:'metadata-not-ready'});
                        else state.timer=setTimeout(attempt,1000);return;
                    }
                    observe(state,prepared);
                    state.ready=true;
                    enqueue(state,{kind:'metadata-ready',allowed:false,leaseMs:LIMITS.leaseMs,
                        target:CAPTURE+'.ebk.MoveNext',state:7,successValue:prepared.successValue,fields:prepared.fieldMetadata});
                    state.timer=setTimeout(poll,0);
                }catch(e){state.finish({status:'unavailable',reason:String(e).slice(0,180),details:e.details||null});}
            }
            state.timer=setTimeout(attempt,0);
        });
    }
    function setAllowed(value) {
        const state=running;if(!state||!state.active)return false;
        state.allowedUntil=0;
        if(value!==true||!state.ready||state.reason||!state.now)return false;
        try{state.allowedUntil=state.now()+LIMITS.leaseMs;return true;}
        catch(e){fail(state,e);return false;}
    }
    function stop() {if(!running)return Promise.resolve({status:'idle'});running.finish({status:'cancelled'});return Promise.resolve({status:'cancelled'});}
    root.PGRazorQuickSummary=Object.freeze({start,setAllowed,stop,limits:LIMITS});
})(globalThis);
globalThis.PGRazorQuickSummary;
