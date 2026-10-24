'use strict';
/*
 * Enhanced Throw + Quick Catch -- Frida Gadget script (native only).
 *
 * Target: Pokemon GO 0.433.1 (2026101502), arm64-v8a. Every RVA below is pinned to
 * that exact libil2cpp.so and verified against its instruction bytes before any hook
 * is installed; on any mismatch the affected feature stays off (fail closed).
 * Offsets and signatures come from the PGRazor 0.433.1 baseline.
 *
 * Needs no Java bridge and no il2cpp metadata walking: pure Interceptor hooks and a
 * few direct calls into game code, all on the thread the game itself used.
 *
 * Gadget config (libfrida-gadget.config.so) example:
 *   { "interaction": { "type": "script", "path": "libthrowcatch.js.so",
 *       "parameters": { "throwGrade": 3, "throwCurve": true, "quickCatch": true },
 *       "on_change": "ignore" }, "runtime": "qjs" }
 */

const BUILD = Object.freeze({
  game: 'com.nianticlabs.pokemongo 0.433.1 (2026101502) arm64-v8a',
  // Pokeball.btxu must only be treated as "ordinary ball response" when called from here.
  caller: Object.freeze({ checkRva: 0xad691c8, checkHex: 'e00314aae9bbff97c82c02b0f60313aa', returnRva: 0xad691d0 }),
  code: Object.freeze({
    submit:   [0xad5fbdc, 'fe5fbda9f65701a9f44f02a9961b0290f50302aaf40301aac8026539f30300aa'], // Pokeball.btyl(PokeballThrow)
    hit:      [0xad93280, '080441f9c80000b4002140f9031540f9427c4092040d40f980001fd6c0035fd6'], // EncounterState.NotifyPokeballHit(PokeballThrow)
    btxu:     [0xad58170, 'fe0f1df8f65701a9f44f02a9b41b02f0f30300aa8886623928040037e0ef01d0'], // Pokeball.btxu() -> CatchPokemonOutProto
    caught:   [0xacf0a8c, 'fd7bbaa9fc6f01a9fa6702a9f85f03a9f65704a9f44f05a9f51e02f0f40301aa'], // EncounterCaptureState.btdd(response)
    escaped:  [0xacf104c, 'fd7bbaa9fc6f01a9fa6702a9f85f03a9f65704a9f44f05a9f51e02d0f40301aa'], // EncounterCaptureState.btdf(response)
    getSpeed: [0xd954a40, 'fe57bea9f44f01a974bc00d0f30300aa8866793908010037809700d000800c91'], // Animator.get_speed
    setSpeed: [0xd954b48, 'e80f1dfcfe5701a9f44f02a90840201e74bc00d0f30300aa886a793908010037'], // Animator.set_speed
    alive:    [0xda6bba0, 'fe0f1df8f65701a9f44f02a9f4b30090f30300aa882e673988020036f48800d0'], // UnityEngine.Object.op_Implicit(Object)
  }),
  field: Object.freeze({ animator: 0xb0, bread: 0x240, status: 0x10 }),
  // Holoholo.Rpc.CatchPokemonOutProto.Types.Status
  status: Object.freeze({ success: 1, escape: 2 }),
});

const DEFAULTS = Object.freeze({
  enhancedThrow: true,
  throwGrade: 3,          // 0 = keep the real reticle, 1 = Nice, 2 = Great, 3 = Excellent
  throwCurve: true,       // force the curveball flag
  quickCatch: true,
  quickCatchSpeed: 20,    // Animator speed during the catch / break-free animation
  statusSuccess: BUILD.status.success,
  statusEscape: BUILD.status.escape,
  startupGraceMs: 1500,
  pollMs: 1000,
  restoreTimeoutMs: 8000,
  logTag: 'ThrowCatch',
  logPath: null,
});

function parseConfig(parameters) {
  const p = parameters && typeof parameters === 'object' ? parameters : {};
  const bool = (v, d) => (typeof v === 'boolean' ? v : d);
  const int = (v, d, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);
  const num = (v, d, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return {
    enhancedThrow: bool(p.enhancedThrow, DEFAULTS.enhancedThrow),
    throwGrade: int(p.throwGrade, DEFAULTS.throwGrade, 0, 3),
    throwCurve: bool(p.throwCurve, DEFAULTS.throwCurve),
    quickCatch: bool(p.quickCatch, DEFAULTS.quickCatch),
    quickCatchSpeed: num(p.quickCatchSpeed, DEFAULTS.quickCatchSpeed, 1, 20),
    statusSuccess: int(p.statusSuccess, DEFAULTS.statusSuccess, 0, 64),
    statusEscape: int(p.statusEscape, DEFAULTS.statusEscape, 0, 64),
    startupGraceMs: int(p.startupGraceMs, DEFAULTS.startupGraceMs, 0, 60000),
    pollMs: int(p.pollMs, DEFAULTS.pollMs, 100, 60000),
    restoreTimeoutMs: int(p.restoreTimeoutMs, DEFAULTS.restoreTimeoutMs, 1000, 120000),
    logTag: typeof p.logTag === 'string' && /^[A-Za-z0-9_.-]{1,23}$/.test(p.logTag) ? p.logTag : DEFAULTS.logTag,
    logPath: typeof p.logPath === 'string' && p.logPath.length > 0 ? p.logPath : null,
  };
}

/*
 * PokeballThrow is a 12-byte value type {int BallType; float ReticleSize; bool HitBullseye;
 * bool Spinning; bool Missed}. Under AAPCS64 it arrives in x1 (BallType | ReticleSize << 32)
 * and the low bytes of x2 (HitBullseye | Spinning << 8 | Missed << 16).
 * Returns the rewritten register words, or null when the arguments do not look like a real,
 * non-missed throw (then the call is left completely untouched).
 */
function throwWords(first, second, grade, curve) {
  const hex = String(first).replace(/^0x/, '').padStart(16, '0');
  if (!/^[0-9a-f]{16}$/i.test(hex)) return null;
  const item = parseInt(hex.slice(8), 16);
  const flags = second >>> 0;
  if (![1, 2, 3, 5].includes(item) || (flags & 255) > 1 || ((flags >>> 8) & 255) > 1 || ((flags >>> 16) & 255) !== 0) return null;
  const bits = parseInt(hex.slice(0, 8), 16);
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, bits);
  const radius = view.getFloat32(0);
  if (!Number.isFinite(radius) || radius < 0 || radius > 1) return null;
  // Midpoints of the Nice / Great / Excellent ring bands, away from the boundaries.
  const radii = [null, 0.9, 0.5, 0.1];
  if (grade) view.setFloat32(0, radii[grade]);
  const outBits = grade ? view.getUint32(0) : bits;
  return {
    first: '0x' + outBits.toString(16).padStart(8, '0') + hex.slice(8),
    second: (flags | (grade ? 1 : 0) | (curve ? 256 : 0)) >>> 0,
    reticle: grade ? radii[grade] : radius,
  };
}

function makeLogger(cfg) {
  let androidWrite = null, tag = null;
  try {
    const liblog = Process.findModuleByName('liblog.so');
    const address = liblog && liblog.findExportByName('__android_log_write');
    if (address && !address.isNull()) {
      androidWrite = new NativeFunction(address, 'int', ['int', 'pointer', 'pointer'], { scheduling: 'exclusive' });
      tag = Memory.allocUtf8String(cfg.logTag);
    }
  } catch (_) { androidWrite = null; }
  return function log(kind, fields) {
    let line;
    try { line = '[' + cfg.logTag + '] ' + kind + (fields === undefined ? '' : ' ' + JSON.stringify(fields)); }
    catch (_) { line = '[' + cfg.logTag + '] ' + kind; }
    try { console.log(line); } catch (_) {}
    try { if (androidWrite) androidWrite(4, tag, Memory.allocUtf8String(line)); } catch (_) {}
    if (cfg.logPath) {
      try {
        const file = new File(cfg.logPath, 'a');
        try { file.write(new Date().toISOString() + ' ' + line + '\n'); file.flush(); } finally { file.close(); }
      } catch (_) {}
    }
  };
}

function codeMatches(address, hex) {
  const length = hex.length / 2;
  const bytes = new Uint8Array(address.readByteArray(length));
  if (bytes.length !== length) return false;
  for (let i = 0; i < length; i++) if (bytes[i] !== parseInt(hex.substr(i * 2, 2), 16)) return false;
  return true;
}

function verifyCode(module, rva, hex) {
  const size = hex.length / 2;
  if (rva % 4 !== 0 || rva + size > module.size) throw new Error('out-of-module');
  const address = module.base.add(rva);
  const range = Process.findRangeByAddress(address);
  if (!range || range.protection.indexOf('r') < 0 || range.protection.indexOf('x') < 0 ||
      address.add(size).compare(range.base.add(range.size)) > 0) throw new Error('not-executable');
  if (!codeMatches(address, hex)) throw new Error('bytes-differ');
  return address;
}

function domainReady(module) {
  const address = module.findExportByName('il2cpp_domain_get');
  if (!address || address.isNull()) return false;
  const domainGet = new NativeFunction(address, 'pointer', [], { scheduling: 'exclusive' });
  return !domainGet().isNull();
}

let cfg = parseConfig(null);
let log = () => {};
let timer = null, disposed = false, readySince = 0;
const listeners = [];
const pending = { attempt: null };
const flags = { throwFault: false, catchFault: false };
const counters = { throwApplied: 0, throwSkipped: 0, catchApplied: 0, catchRestored: 0, responses: 0 };

function installEnhancedThrow(addresses) {
  const routes = [['submit', addresses.submit], ['hit', addresses.hit]].filter(r => r[1]);
  if (!routes.length) { log('throw-unavailable', { reason: 'no-verified-hook' }); return []; }
  if (!cfg.throwGrade && !cfg.throwCurve) { log('throw-idle', { reason: 'grade 0 and curve off' }); return []; }
  const installed = [];
  for (const [route, address] of routes) {
    listeners.push(Interceptor.attach(address, {
      onEnter(args) {
        if (disposed || flags.throwFault || !cfg.enhancedThrow) return;
        try {
          if (route === 'submit') restoreIfStale('next-throw');
          if (args[0].isNull()) return;
          if (route === 'submit' && args[0].add(BUILD.field.bread).readU8() !== 0) return; // bread ball: leave alone
          const changed = throwWords(args[1].toString(), args[2].toInt32(), cfg.throwGrade, cfg.throwCurve);
          if (!changed) {
            if (++counters.throwSkipped <= 10) log('throw-skipped', { route, reason: 'unrecognised-arguments', x1: args[1].toString(), w2: args[2].toInt32() >>> 0 });
            return;
          }
          args[1] = ptr(changed.first);
          args[2] = ptr(changed.second);
          counters.throwApplied++;
          if (counters.throwApplied <= 50) log('throw-applied', { route, grade: ['off', 'nice', 'great', 'excellent'][cfg.throwGrade], curve: cfg.throwCurve, reticle: changed.reticle });
        } catch (e) {
          flags.throwFault = true;
          log('throw-fault', { route, reason: String(e && e.message || e) });
        }
      },
    }));
    installed.push(route);
  }
  return installed;
}

function installQuickCatch(module, addresses) {
  const need = ['btxu', 'caught', 'escaped', 'getSpeed', 'setSpeed', 'alive'];
  const missing = need.filter(n => !addresses[n]);
  if (missing.length) { log('catch-unavailable', { reason: 'unverified:' + missing.join(',') }); return false; }
  const callerCheck = verifyCode(module, BUILD.caller.checkRva, BUILD.caller.checkHex);
  const callerReturn = module.base.add(BUILD.caller.returnRva);
  if (!callerCheck) return false;
  const exports = {};
  for (const [key, ret, args] of [['gchandle_new', 'pointer', ['pointer', 'bool']], ['gchandle_get_target', 'pointer', ['pointer']], ['gchandle_free', 'void', ['pointer']]]) {
    const address = module.findExportByName('il2cpp_' + key);
    if (!address || address.isNull()) { log('catch-unavailable', { reason: 'missing-export:' + key }); return false; }
    exports[key] = new NativeFunction(address, ret, args, { scheduling: 'exclusive' });
  }
  const exclusive = { scheduling: 'exclusive' };
  const getSpeed = new NativeFunction(addresses.getSpeed, 'float', ['pointer', 'pointer'], exclusive);
  const setSpeed = new NativeFunction(addresses.setSpeed, 'void', ['pointer', 'float', 'pointer'], exclusive);
  const alive = new NativeFunction(addresses.alive, 'bool', ['pointer', 'pointer'], exclusive);
  const NULL = ptr(0);

  function release(attempt) {
    pending.attempt = null;
    try { exports.gchandle_free(attempt.handle); } catch (e) { log('catch-fault', { reason: 'handle-free:' + String(e && e.message || e) }); }
  }
  function restore(reason) {
    const attempt = pending.attempt;
    if (!attempt) return;
    try {
      const animator = exports.gchandle_get_target(attempt.handle);
      if (animator.isNull() || !alive(animator, NULL)) { release(attempt); log('speed-target-gone', { reason }); return; }
      const current = getSpeed(animator, NULL);
      if (!Number.isFinite(current) || Math.abs(current - cfg.quickCatchSpeed) > 1e-5) {
        release(attempt); log('speed-external-change', { reason, current }); return;
      }
      setSpeed(animator, attempt.original, NULL);
      const readback = getSpeed(animator, NULL);
      release(attempt);
      counters.catchRestored++;
      log('speed-restored', { reason, readback });
    } catch (e) {
      flags.catchFault = true;
      log('catch-fault', { reason: 'restore:' + String(e && e.message || e) });
      release(attempt);
    }
  }
  restoreIfStale = function (reason) {
    const attempt = pending.attempt;
    if (attempt && (Date.now() - attempt.t0 >= cfg.restoreTimeoutMs || reason === 'next-throw')) restore(reason);
  };

  function onResponse(ball, response) {
    const status = response.add(BUILD.field.status).readS32();
    if (++counters.responses <= 30) log('catch-response', { status });
    if (status !== cfg.statusSuccess && status !== cfg.statusEscape) return;
    if (pending.attempt) restore('superseded');
    if (pending.attempt) return;
    if (ball.add(BUILD.field.bread).readU8() !== 0) { log('catch-skip', { reason: 'special-ball' }); return; }
    const animator = ball.add(BUILD.field.animator).readPointer();
    if (animator.isNull() || !alive(animator, NULL)) { log('catch-skip', { reason: 'no-animator' }); return; }
    const original = getSpeed(animator, NULL);
    if (!Number.isFinite(original) || Math.abs(original - 1) > 1e-5) { log('catch-skip', { reason: 'nonstandard-speed', original }); return; }
    const handle = exports.gchandle_new(animator, false);
    if (handle.isNull()) { log('catch-skip', { reason: 'gc-handle' }); return; }
    pending.attempt = { handle, response, original, t0: Date.now() };
    try {
      setSpeed(animator, cfg.quickCatchSpeed, NULL);
      const readback = getSpeed(animator, NULL);
      if (!Number.isFinite(readback) || Math.abs(readback - cfg.quickCatchSpeed) > 1e-5) throw new Error('apply-readback:' + readback);
    } catch (e) {
      flags.catchFault = true;
      log('catch-fault', { reason: 'apply:' + String(e && e.message || e) });
      restore('apply-failed');
      return;
    }
    counters.catchApplied++;
    if (counters.catchApplied <= 50) log('speed-applied', { status, speed: cfg.quickCatchSpeed });
  }

  listeners.push(Interceptor.attach(addresses.btxu, {
    onEnter(args) {
      this.ball = null;
      if (disposed || flags.catchFault || !cfg.quickCatch) return;
      if (!this.returnAddress.equals(callerReturn)) return;
      this.ball = args[0];
    },
    onLeave(retval) {
      const ball = this.ball;
      this.ball = null;
      if (!ball || ball.isNull() || retval.isNull()) return; // null = response still pending
      try { restoreIfStale('timeout'); onResponse(ball, retval); }
      catch (e) { flags.catchFault = true; log('catch-fault', { reason: String(e && e.message || e) }); }
    },
  }));
  for (const [name, reason] of [['caught', 'caught'], ['escaped', 'broke-free']]) {
    listeners.push(Interceptor.attach(addresses[name], {
      onEnter(args) {
        if (disposed || !pending.attempt) return;
        try { if (args[1].equals(pending.attempt.response)) restore(reason); }
        catch (e) { flags.catchFault = true; log('catch-fault', { reason: String(e && e.message || e) }); }
      },
    }));
  }
  return true;
}
let restoreIfStale = function () {};

function install(module) {
  const addresses = {};
  for (const name of Object.keys(BUILD.code)) {
    try { addresses[name] = verifyCode(module, BUILD.code[name][0], BUILD.code[name][1]); }
    catch (e) { log('signature-failed', { name, reason: String(e && e.message || e) }); }
  }
  const features = { throw: [], catch: false };
  if (cfg.enhancedThrow) {
    try { features.throw = installEnhancedThrow(addresses); } catch (e) { log('throw-install-failed', { reason: String(e && e.message || e) }); }
  }
  if (cfg.quickCatch) {
    try { features.catch = installQuickCatch(module, addresses); } catch (e) { log('catch-install-failed', { reason: String(e && e.message || e) }); }
  }
  log('ready', { game: BUILD.game, base: module.base.toString(), throwHooks: features.throw, quickCatch: features.catch, config: cfg });
}

function poll() {
  timer = null;
  if (disposed) return;
  try {
    const module = Process.findModuleByName('libil2cpp.so');
    if (module && domainReady(module)) {
      if (readySince === 0) { readySince = Date.now(); log('il2cpp-ready', { graceMs: cfg.startupGraceMs }); }
      if (Date.now() - readySince >= cfg.startupGraceMs) { install(module); return; }
    }
  } catch (e) { log('poll-error', { reason: String(e && e.message || e) }); }
  timer = setTimeout(poll, cfg.pollMs);
}

function start() {
  log = makeLogger(cfg);
  log('boot', { arch: Process.arch, pointerSize: Process.pointerSize });
  if (Process.arch !== 'arm64') { log('unsupported-architecture'); return; }
  timer = setTimeout(poll, 0);
}

function dispose() {
  disposed = true;
  if (timer !== null) { clearTimeout(timer); timer = null; }
  for (const l of listeners.splice(0)) { try { l.detach(); } catch (_) {} }
  // A pending speed change cannot be undone from this thread; the ball is destroyed with the encounter.
  pending.attempt = null;
}

rpc.exports = {
  init(stage, parameters) { cfg = parseConfig(parameters); setImmediate(start); },
  dispose,
};

if (typeof __TEST__ !== 'undefined') {
  globalThis.__throwCatchTest = { throwWords, parseConfig, BUILD, counters, flags, pending };
}
