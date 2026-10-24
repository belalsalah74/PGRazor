# Pogo Patches (Morphe)

Morphe patches for Pokémon GO **0.433.1** (arm64). One patch: **Enhanced throw and quick catch**.

- Bundles Frida gadget 17.24.2 (downloaded and SHA-256-verified at build time) and `agent/throw-catch-agent.js`.
- A manifest-registered `BootstrapProvider` copies them to the code cache and loads the gadget before the game starts.
- The agent hooks native IL2CPP methods at fixed 0.433.1 offsets, each checked byte-for-byte; a mismatch disables that feature.

## Setting this up from the template

1. On GitHub: **Use this template** on `MorpheApp/morphe-patches-template`, enable *Include all branches*, name it e.g. `pogo-morphe-patches`.
2. Unzip this folder's contents over the repo root, then run `bash apply.sh`. It edits the template's own `settings.gradle.kts` and `patches/build.gradle.kts` in place (project name, about block, one `apply(from = "payload.gradle.kts")` line) and never replaces them, so the template's plugin and toolchain versions stay intact. Afterwards set `about { source = ... }` to your own repo.
3. Delete the template's example patch/extension sources.
4. Make sure `extendWith("extensions/extension.mpe")` in `ThrowCatchPatch.kt` matches the extension name the template's own example patch uses.
5. Work on `dev`, build with `./gradlew buildAndroid` (needs `gpr.user`/`gpr.key`, and `xz` on PATH), apply `patches/build/libs/patches-*.mpp` with Morphe Desktop.
6. Release only through the template's `release.yml` (`feat:` / `fix:` commits).

## Verifying on device

`logcat -s ThrowCatch PogoBootstrap` — expect `gadget loaded`, then `boot`, `il2cpp-ready`, `ready`. See `agent/` for details; `node --test agent/test/throw-catch-agent.test.cjs` runs the agent tests.
