# Enhanced Throw + Quick Catch (Pokémon GO 0.433.1, arm64)

`throw-catch-agent.js` is a native-only Frida Gadget script. It reimplements two PGRazor features
without PGRazor's Java UI, Java bridge or metadata walking:

- **Enhanced Throw** – rewrites the `PokeballThrow` argument of `Pokeball.btyl` and
  `EncounterState.NotifyPokeballHit` (reticle size → Nice/Great/Excellent band, bullseye flag,
  curveball flag). Missed throws, bread balls and anything that doesn't parse are left alone.
- **Quick Catch** – after an ordinary ball's catch response (`Pokeball.btxu`, success or break-free),
  sets the ball Animator speed to 20x and restores it when `EncounterCaptureState.btdd/btdf` fires
  (or on the next throw / after 8 s).

Every RVA is pinned to 0.433.1 and checked byte-for-byte before hooking; a mismatch disables only the
feature that needs it and logs `signature-failed`.

## Parameters (gadget config `interaction.parameters`, all optional)

| name | default | meaning |
| --- | --- | --- |
| `enhancedThrow` | true | master switch |
| `throwGrade` | 3 | 0 keep reticle, 1 Nice, 2 Great, 3 Excellent |
| `throwCurve` | true | force curveball |
| `quickCatch` | true | master switch |
| `quickCatchSpeed` | 20 | 1–20 |
| `logPath` | none | optional file the log is also appended to |
| `statusSuccess` / `statusEscape` | 1 / 2 | `CatchPokemonOutProto.Status` values, only if they ever change |

## Packaging

Needs `libfrida-gadget.so` (17.x, arm64) loaded early, plus a config naming this script:

```json
{ "interaction": { "type": "script", "path": "/abs/path/throw-catch-agent.js",
    "parameters": { "throwGrade": 3, "throwCurve": true, "quickCatch": true },
    "on_change": "ignore" }, "runtime": "qjs" }
```

PGRazor copies the gadget, config and script into the app's code cache at startup and calls
`System.load` on the gadget (see its `BootstrapProvider.java`). In a Morphe patch the same can be done
by shipping them in `lib/arm64-v8a/` (as `libfrida-gadget.so`, `libfrida-gadget.config.so`,
`libthrowcatch.js.so`, relative `path` in the config) plus a small smali/extension call to
`System.loadLibrary("frida-gadget")` as early as possible.

## Checking it on a device

```sh
logcat -s ThrowCatch          # or: logcat | grep ThrowCatch
```

Expected sequence after launching the game: `boot` → `il2cpp-ready` → `ready {throwHooks:["submit","hit"], quickCatch:true}`.
Then per throw: `throw-applied`; per catch: `catch-response {status:1}` → `speed-applied` → `speed-restored`.

- No `boot` line: the gadget/script isn't loading (packaging problem, not hooks).
- `ready` but `signature-failed`: the installed game isn't the exact 0.433.1 build.
- `throw-skipped` with raw `x1`/`w2` values: the struct layout assumption failed; send me those lines.
- `catch-response` with a status other than 1/2 on a real catch: set `statusSuccess`/`statusEscape`.

## Tests

`node --test test/throw-catch-agent.test.cjs` – 19 tests against a fake Frida runtime. They cover the
logic and fail-closed paths only; nothing here has been run against the real game.
