'use strict';
// Mock-based tests: the agent is evaluated in a vm with a fake Frida runtime.
// They prove the logic and the fail-closed behaviour, NOT that the game accepts it --
// that needs a device (see README).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'throw-catch-agent.js'), 'utf8');
const BASE = 0x10000000n, SIZE = 0x20000000n;
const hexBytes = h => Buffer.from(h, 'hex');
const f32bits = f => { const b = Buffer.alloc(4); b.writeFloatBE(f); return BigInt(b.readUInt32BE()); };
const bitsF32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(Number(n)); return b.readFloatBE(); };

function fixture(params = {}, opts = {}) {
  let now = 1000, nextTimer = 1, nextObj = 0x30000000n, nextHandle = 0x50000n;
  const mem = new Map(), timers = new Map(), immediates = [], logs = [], androidLog = [];
  const attached = new Map(), handles = new Map(), freed = [], speedWrites = [];
  const animators = new Map();
  const world = { loaded: false, domain: false, failSet: false, failHandleNew: false };

  class P {
    constructor(v) { this.v = BigInt.asUintN(64, BigInt(v)); }
    isNull() { return this.v === 0n; }
    equals(o) { return !!o && this.v === o.v; }
    add(n) { return new P(this.v + BigInt(n)); }
    and(n) { return new P(this.v & BigInt(n)); }
    compare(o) { return this.v < o.v ? -1 : this.v > o.v ? 1 : 0; }
    toString() { return '0x' + this.v.toString(16); }
    toInt32() { return Number(BigInt.asIntN(32, this.v)); }
    readU8() { return mem.get(this.v) ?? 0; }
    readS32() { let x = 0n; for (let i = 0n; i < 4n; i++) x |= BigInt(mem.get(this.v + i) ?? 0) << (8n * i); return Number(BigInt.asIntN(32, x)); }
    readPointer() { let x = 0n; for (let i = 0n; i < 8n; i++) x |= BigInt(mem.get(this.v + i) ?? 0) << (8n * i); return new P(x); }
    readByteArray(n) { const out = new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = mem.get(this.v + BigInt(i)) ?? 0; return out.buffer; }
  }
  const ptr = v => new P(typeof v === 'string' ? BigInt(v) : v);
  const writeU32 = (a, n) => { for (let i = 0n; i < 4n; i++) mem.set(a + i, Number((BigInt(n) >> (8n * i)) & 255n)); };
  const writeU64 = (a, n) => { for (let i = 0n; i < 8n; i++) mem.set(a + i, Number((BigInt(n) >> (8n * i)) & 255n)); };

  // Lay the real instruction signatures into fake libil2cpp memory.
  const probe = {};
  vm.runInNewContext(SOURCE, { __TEST__: true, rpc: {}, Process: {}, console: { log() {} }, setTimeout() {}, clearTimeout() {}, setImmediate() {}, globalThis: probe, ptr: () => {}, Memory: {}, NativeFunction: function () {}, Interceptor: {} }, { filename: 'probe' });
  const BUILD = probe.__throwCatchTest.BUILD;
  const signatures = Object.fromEntries(Object.entries(BUILD.code));
  for (const [name, [rva, hex]] of Object.entries(signatures)) {
    if (opts.corrupt === name) { const b = hexBytes(hex); b[0] ^= 1; b.forEach((x, i) => mem.set(BASE + BigInt(rva) + BigInt(i), x)); }
    else hexBytes(hex).forEach((x, i) => mem.set(BASE + BigInt(rva) + BigInt(i), x));
  }
  hexBytes(BUILD.caller.checkHex).forEach((x, i) => mem.set(BASE + BigInt(BUILD.caller.checkRva) + BigInt(i), x));

  const exportsTable = { il2cpp_domain_get: 0x1000n, il2cpp_gchandle_new: 0x1100n, il2cpp_gchandle_get_target: 0x1200n, il2cpp_gchandle_free: 0x1300n };
  const il2cpp = { base: new P(BASE), size: Number(SIZE), findExportByName: n => (exportsTable[n] !== undefined && !opts.missingExport?.includes(n) ? new P(BASE + exportsTable[n]) : null) };
  const liblog = { findExportByName: n => (n === '__android_log_write' ? new P(0x2000n) : null) };

  const natives = new Map();
  const at = rva => new P(BASE + BigInt(rva)).toString();
  natives.set(new P(BASE + 0x1000n).toString(), () => (world.domain ? new P(1) : new P(0)));
  natives.set(new P(BASE + 0x1100n).toString(), obj => { if (world.failHandleNew) return new P(0); const h = new P(nextHandle++); handles.set(h.v, obj); return h; });
  natives.set(new P(BASE + 0x1200n).toString(), h => handles.get(h.v) ?? new P(0));
  natives.set(new P(BASE + 0x1300n).toString(), h => { freed.push(h.v); handles.delete(h.v); });
  natives.set('0x2000', (prio, tag, msg) => androidLog.push(msg.s));
  natives.set(at(BUILD.code.getSpeed[0]), a => { const an = animators.get(a.v); if (!an) throw new Error('get_speed on unknown animator'); return an.speed; });
  natives.set(at(BUILD.code.setSpeed[0]), (a, value) => { if (world.failSet) throw new Error('boom'); const an = animators.get(a.v); if (!an || !an.alive) throw new Error('set_speed on dead animator'); an.speed = Math.fround(value); speedWrites.push(an.speed); });
  natives.set(at(BUILD.code.alive[0]), o => !!animators.get(o.v)?.alive);

  class FakeDate extends Date { static now() { return now; } }
  const ctx = {
    __TEST__: true, rpc: {}, ptr, Date: FakeDate, JSON, Math, Number, DataView, ArrayBuffer, Uint8Array,
    console: { log: s => logs.push(s) },
    Process: {
      arch: 'arm64', pointerSize: 8,
      findModuleByName: n => (n === 'libil2cpp.so' ? (world.loaded ? il2cpp : null) : n === 'liblog.so' ? liblog : null),
      findRangeByAddress: a => (a.v >= BASE && a.v < BASE + SIZE ? { base: new P(BASE), size: Number(SIZE), protection: 'r-x' } : null),
    },
    Memory: { allocUtf8String: s => ({ s }) },
    NativeFunction: function (address, ret, args) { const f = natives.get(address.toString()); if (!f) throw new Error('no native at ' + address); return f; },
    Interceptor: { attach(address, cb) { const rec = { cb, detached: false }; attached.set(address.toString(), rec); return { detach() { rec.detached = true; } }; } },
    setImmediate: fn => immediates.push(fn),
    setTimeout: (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, due: now + ms }); return id; },
    clearTimeout: id => timers.delete(id),
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx, { filename: 'throw-catch-agent.js' });
  const api = ctx.__throwCatchTest;

  const run = () => { while (immediates.length) immediates.shift()(); };
  const advance = ms => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
      if (!due) break;
      timers.delete(due[0]); now = Math.max(now, due[1].due); due[1].fn();
    }
    now = end;
  };
  const boot = () => {
    ctx.rpc.exports.init('early', params); run();
    world.loaded = true; world.domain = true;
    advance(0); advance(3000);
  };
  const hook = rva => attached.get(at(rva));
  const fire = (rva, args, { returnAddress = new P(0), retval } = {}) => {
    const rec = hook(rva); assert.ok(rec, 'no hook at ' + rva.toString(16)); assert.equal(rec.detached, false);
    const c = { returnAddress };
    if (rec.cb.onEnter) rec.cb.onEnter.call(c, args);
    if (rec.cb.onLeave) rec.cb.onLeave.call(c, retval ?? new P(0));
    return c;
  };
  const makeAnimator = (speed = 1, alive = true) => { const a = nextObj; nextObj += 0x1000n; animators.set(a, { speed, alive }); return new P(a); };
  const makeBall = ({ bread = 0, animator = makeAnimator() } = {}) => { const a = nextObj; nextObj += 0x1000n; writeU64(a + 0xb0n, animator.v); mem.set(a + 0x240n, bread); return { ball: new P(a), animator }; };
  const makeResponse = status => { const a = nextObj; nextObj += 0x1000n; writeU32(a + 0x10n, status); return new P(a); };
  const makeThrow = ({ item = 1, reticle = 0.95, hit = 0, spin = 0, missed = 0, garbage = 0n } = {}) => ({
    x1: new P((f32bits(reticle) << 32n) | BigInt(item)),
    x2: new P((garbage << 32n) | BigInt(hit | (spin << 8) | (missed << 16))),
  });
  const decode = args => ({ item: Number(args[1].v & 0xffffffffn), reticle: bitsF32(args[1].v >> 32n), flags: Number(args[2].v & 0xffffffffn) });
  const ballCaller = new P(BASE + BigInt(BUILD.caller.returnRva));
  return { run, api, ctx, world, logs, androidLog, animators, freed, speedWrites, boot, advance, fire, hook, makeAnimator, makeBall, makeResponse, makeThrow, decode, ballCaller, BUILD, P, handles, attached, setNow: v => { now = v; }, getNow: () => now };
}

const rvaOf = (f, n) => f.BUILD.code[n][0];
const text = f => f.logs.join('\n');

test('throwWords sets grade reticle, bullseye and curve flags', () => {
  const { throwWords } = fixture().api;
  for (const [grade, radius] of [[1, 0.9], [2, 0.5], [3, 0.1]]) {
    const out = throwWords('0x' + ((f32bits(0.99) << 32n) | 1n).toString(16), 0, grade, true);
    assert.equal(Math.fround(radius), bitsF32(BigInt('0x' + out.first.slice(2, 10))));
    assert.equal(out.first.slice(10), '00000001');
    assert.equal(out.second, 0x101);
  }
  const curveOnly = throwWords('0x' + ((f32bits(0.77) << 32n) | 2n).toString(16), 0, 0, true);
  assert.equal(bitsF32(BigInt('0x' + curveOnly.first.slice(2, 10))), Math.fround(0.77));
  assert.equal(curveOnly.second, 0x100);
});

test('throwWords refuses anything that does not look like a real, non-missed throw', () => {
  const { throwWords } = fixture().api;
  const x = (item, radius) => '0x' + ((f32bits(radius) << 32n) | BigInt(item)).toString(16);
  assert.equal(throwWords(x(9, 0.5), 0, 3, true), null);       // unknown ball
  assert.equal(throwWords(x(1, 2.5), 0, 3, true), null);       // radius out of range
  assert.equal(throwWords(x(1, 0.5), 0x10000, 3, true), null); // Missed flag set
  assert.equal(throwWords(x(1, 0.5), 2, 3, true), null);       // bool byte not 0/1
  assert.equal(throwWords('zz', 0, 3, true), null);
});

test('parseConfig validates and clamps', () => {
  const { parseConfig } = fixture().api;
  const d = parseConfig(null);
  assert.deepEqual([d.enhancedThrow, d.throwGrade, d.throwCurve, d.quickCatch, d.quickCatchSpeed], [true, 3, true, true, 20]);
  const c = parseConfig({ throwGrade: 9, quickCatchSpeed: 500, throwCurve: 'yes', logTag: 'bad tag!', startupGraceMs: -1 });
  assert.deepEqual([c.throwGrade, c.quickCatchSpeed, c.throwCurve, c.logTag, c.startupGraceMs], [3, 20, true, 'ThrowCatch', 1500]);
  assert.equal(parseConfig({ quickCatchSpeed: 0 }).quickCatchSpeed, 1);
});

test('nothing is hooked until libil2cpp and the il2cpp domain exist, then after the grace period', () => {
  const f = fixture();
  f.ctx.rpc.exports.init('early', {}); f.run(); f.advance(0); f.advance(5000);
  assert.equal(f.attached.size, 0);
  f.world.loaded = true; f.advance(3000);
  assert.equal(f.attached.size, 0, 'domain not ready yet');
  f.world.domain = true; f.advance(1000);
  assert.equal(f.attached.size, 0, 'grace not elapsed');
  f.advance(2000);
  assert.equal(f.attached.size, 5); // submit, hit, btxu, caught, escaped
  assert.match(text(f), /ready/);
  assert.ok(f.androidLog.some(l => l.includes('ready')), 'logs reach logcat');
});

test('enhanced throw rewrites both throw entry points', () => {
  const f = fixture(); f.boot();
  for (const route of ['submit', 'hit']) {
    const { ball } = f.makeBall();
    const t = f.makeThrow({ item: 2, reticle: 0.93, garbage: 0xdeadbeefn });
    const args = [route === 'submit' ? ball : f.makeBall().ball, t.x1, t.x2];
    f.fire(rvaOf(f, route), args);
    const d = f.decode(args);
    assert.equal(d.item, 2);
    assert.equal(d.reticle, Math.fround(0.1));
    assert.equal(d.flags & 0xffffff, 0x101);
  }
  assert.equal(f.api.counters.throwApplied, 2);
});

test('enhanced throw leaves bread balls, misses and unknown balls untouched', () => {
  const f = fixture(); f.boot();
  const untouched = (route, { ball, t }) => {
    const args = [ball, t.x1, t.x2], before = [args[1].v, args[2].v];
    f.fire(rvaOf(f, route), args);
    assert.deepEqual([args[1].v, args[2].v], before);
  };
  untouched('submit', { ball: f.makeBall({ bread: 1 }).ball, t: f.makeThrow() });
  untouched('submit', { ball: f.makeBall().ball, t: f.makeThrow({ missed: 1 }) });
  untouched('hit', { ball: f.makeBall().ball, t: f.makeThrow({ item: 9 }) });
  assert.equal(f.api.counters.throwApplied, 0);
  assert.equal(f.api.flags.throwFault, false);
});

test('grade can be Nice/Great and curve can be turned off', () => {
  const f = fixture({ throwGrade: 2, throwCurve: false }); f.boot();
  const t = f.makeThrow(); const args = [f.makeBall().ball, t.x1, t.x2];
  f.fire(rvaOf(f, 'submit'), args);
  const d = f.decode(args);
  assert.equal(d.reticle, Math.fround(0.5));
  assert.equal(d.flags & 0xffffff, 0x001);
});

test('disabling both throw effects installs no throw hooks', () => {
  const f = fixture({ throwGrade: 0, throwCurve: false }); f.boot();
  assert.equal(f.hook(rvaOf(f, 'submit')), undefined);
  assert.match(text(f), /throw-idle/);
});

test('quick catch speeds the animator on a confirmed catch and restores it on completion', () => {
  const f = fixture(); f.boot();
  const { ball, animator } = f.makeBall(); const response = f.makeResponse(1);
  f.fire(rvaOf(f, 'btxu'), [ball], { returnAddress: f.ballCaller, retval: response });
  assert.equal(f.animators.get(animator.v).speed, 20);
  assert.ok(f.api.pending.attempt);
  f.fire(rvaOf(f, 'caught'), [f.makeBall().ball, response]);
  assert.equal(f.animators.get(animator.v).speed, 1);
  assert.equal(f.api.pending.attempt, null);
  assert.equal(f.freed.length, 1);
  assert.equal(f.api.counters.catchRestored, 1);
});

test('quick catch also covers break-free and honours a custom speed', () => {
  const f = fixture({ quickCatchSpeed: 8 }); f.boot();
  const { ball, animator } = f.makeBall(); const response = f.makeResponse(2);
  f.fire(rvaOf(f, 'btxu'), [ball], { returnAddress: f.ballCaller, retval: response });
  assert.equal(f.animators.get(animator.v).speed, 8);
  f.fire(rvaOf(f, 'escaped'), [f.makeBall().ball, response]);
  assert.equal(f.animators.get(animator.v).speed, 1);
});

test('quick catch ignores other callers, pending (null) responses, other statuses and other responses', () => {
  const f = fixture(); f.boot();
  const a = f.makeBall();
  f.fire(rvaOf(f, 'btxu'), [a.ball], { returnAddress: new f.P(0x1234), retval: f.makeResponse(1) });
  assert.equal(f.animators.get(a.animator.v).speed, 1, 'wrong caller');
  f.fire(rvaOf(f, 'btxu'), [a.ball], { returnAddress: f.ballCaller, retval: new f.P(0) });
  assert.equal(f.animators.get(a.animator.v).speed, 1, 'pending response');
  f.fire(rvaOf(f, 'btxu'), [a.ball], { returnAddress: f.ballCaller, retval: f.makeResponse(4) });
  assert.equal(f.animators.get(a.animator.v).speed, 1, 'CatchMissed');
  f.fire(rvaOf(f, 'btxu'), [a.ball], { returnAddress: f.ballCaller, retval: f.makeResponse(1) });
  assert.equal(f.animators.get(a.animator.v).speed, 20);
  f.fire(rvaOf(f, 'caught'), [f.makeBall().ball, f.makeResponse(1)]); // a different response
  assert.equal(f.animators.get(a.animator.v).speed, 20, 'unrelated completion must not restore');
});

test('quick catch skips bread balls, dead animators and non-standard speeds', () => {
  const f = fixture(); f.boot();
  const bread = f.makeBall({ bread: 1 }), dead = f.makeBall({ animator: f.makeAnimator(1, false) }), odd = f.makeBall({ animator: f.makeAnimator(2) });
  for (const b of [bread, dead, odd]) f.fire(rvaOf(f, 'btxu'), [b.ball], { returnAddress: f.ballCaller, retval: f.makeResponse(1) });
  assert.equal(f.animators.get(bread.animator.v).speed, 1);
  assert.equal(f.animators.get(odd.animator.v).speed, 2);
  assert.equal(f.speedWrites.length, 0);
  assert.equal(f.api.pending.attempt, null);
});

test('restore never writes to a destroyed animator or one changed by someone else', () => {
  const f = fixture(); f.boot();
  let b = f.makeBall(); let r = f.makeResponse(1);
  f.fire(rvaOf(f, 'btxu'), [b.ball], { returnAddress: f.ballCaller, retval: r });
  f.animators.get(b.animator.v).alive = false;
  const writes = f.speedWrites.length;
  f.fire(rvaOf(f, 'caught'), [f.makeBall().ball, r]);
  assert.equal(f.speedWrites.length, writes);
  assert.equal(f.freed.length, 1);
  b = f.makeBall(); r = f.makeResponse(1);
  f.fire(rvaOf(f, 'btxu'), [b.ball], { returnAddress: f.ballCaller, retval: r });
  f.animators.get(b.animator.v).speed = 3;
  const writes2 = f.speedWrites.length;
  f.fire(rvaOf(f, 'escaped'), [f.makeBall().ball, r]);
  assert.equal(f.speedWrites.length, writes2);
  assert.equal(f.animators.get(b.animator.v).speed, 3);
});

test('an unfinished attempt is restored by the next throw and by the timeout', () => {
  const f = fixture(); f.boot();
  let b = f.makeBall(); let r = f.makeResponse(1);
  f.fire(rvaOf(f, 'btxu'), [b.ball], { returnAddress: f.ballCaller, retval: r });
  const t = f.makeThrow(); f.fire(rvaOf(f, 'submit'), [f.makeBall().ball, t.x1, t.x2]);
  assert.equal(f.animators.get(b.animator.v).speed, 1, 'next throw restores');
  b = f.makeBall(); r = f.makeResponse(1);
  f.fire(rvaOf(f, 'btxu'), [b.ball], { returnAddress: f.ballCaller, retval: r });
  f.advance(9000);
  const c = f.makeBall(); f.fire(rvaOf(f, 'btxu'), [c.ball], { returnAddress: f.ballCaller, retval: f.makeResponse(1) });
  assert.equal(f.animators.get(b.animator.v).speed, 1, 'timeout restores before the next attempt');
  assert.equal(f.animators.get(c.animator.v).speed, 20);
});

test('a failing speed setter switches quick catch off but throws keep working', () => {
  const f = fixture(); f.boot();
  f.world.failSet = true;
  const b = f.makeBall();
  f.fire(rvaOf(f, 'btxu'), [b.ball], { returnAddress: f.ballCaller, retval: f.makeResponse(1) });
  assert.equal(f.api.flags.catchFault, true);
  assert.equal(f.api.pending.attempt, null);
  const b2 = f.makeBall();
  f.fire(rvaOf(f, 'btxu'), [b2.ball], { returnAddress: f.ballCaller, retval: f.makeResponse(1) });
  assert.equal(f.animators.get(b2.animator.v).speed, 1);
  const t = f.makeThrow(); const args = [f.makeBall().ball, t.x1, t.x2];
  f.fire(rvaOf(f, 'submit'), args);
  assert.equal(f.decode(args).reticle, Math.fround(0.1));
});

test('no GC handle means no speed change', () => {
  const f = fixture(); f.boot(); f.world.failHandleNew = true;
  const b = f.makeBall();
  f.fire(rvaOf(f, 'btxu'), [b.ball], { returnAddress: f.ballCaller, retval: f.makeResponse(1) });
  assert.equal(f.animators.get(b.animator.v).speed, 1);
});

test('a signature mismatch disables only the features that need it', () => {
  const f = fixture({}, { corrupt: 'setSpeed' }); f.boot();
  assert.equal(f.hook(rvaOf(f, 'btxu')), undefined, 'quick catch off');
  assert.ok(f.hook(rvaOf(f, 'submit')), 'throw still on');
  assert.match(text(f), /signature-failed.*setSpeed/);
  const g = fixture({}, { corrupt: 'submit' }); g.boot();
  assert.equal(g.hook(rvaOf(g, 'submit')), undefined);
  assert.ok(g.hook(rvaOf(g, 'hit')), 'hit hook is independent');
  assert.ok(g.hook(rvaOf(g, 'btxu')));
});

test('missing gc exports disable quick catch cleanly', () => {
  const f = fixture({}, { missingExport: ['il2cpp_gchandle_new'] }); f.boot();
  assert.equal(f.hook(rvaOf(f, 'btxu')), undefined);
  assert.ok(f.hook(rvaOf(f, 'submit')));
  assert.match(text(f), /missing-export:gchandle_new/);
});

test('feature switches and dispose', () => {
  const f = fixture({ enhancedThrow: false, quickCatch: false }); f.boot();
  assert.equal(f.attached.size, 0);
  const g = fixture(); g.boot();
  g.ctx.rpc.exports.dispose();
  for (const rec of g.attached.values()) assert.equal(rec.detached, true);
  const t = g.makeThrow(); const args = [g.makeBall().ball, t.x1, t.x2], before = args[1].v;
  g.hook(rvaOf(g, 'submit')).cb.onEnter.call({}, args);
  assert.equal(args[1].v, before);
});
