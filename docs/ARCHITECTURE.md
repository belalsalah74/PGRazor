# Architecture

PGRazor has three layers:

1. Java controls (`src/dev/pgrazor`) own settings, the menu, overlays, lifecycle, location state, and notifications.
2. `embedded-agent.js` owns startup, feature coordination, and shutdown. `runtime/location.js` owns the game-facing GPS adapter; both use the pinned Frida Java bridge.
3. `diagnostics/*.js` validate IL2CPP metadata before enabling version-specific behavior. Unity-thread work and short foreground/map leases gate gameplay operations.

`nonroot.py` injects the controls and runtime into a user-supplied original game package. `release_apk.py` assembles the supported ARM64 package set into a single signed APK. Game files are inputs, not repository source. Device monitoring and historical investigations are maintained outside the repository.

## Compatibility boundaries

- Preserve internal Java package names, serialized property names, signing identity, and asset paths unless implementing an explicit migration.
- Native fields, methods, byte signatures, and enums are version-specific. Missing contracts disable features rather than authorizing unknown writes.
- Preserve the 1,500 ms native startup grace and runtime exception propagation behavior. Earlier native failures require further device investigation; neither policy is proof of universal crash safety.
- Auto-transfer uses the exact caught ID and existing inventory entry. Unknown classification, favorites, eggs, and protected categories are kept. Size protection uses `PokemonCharacterSize(IGameMasterData)` and validated `Xxs`/`Xxl` enum constants.
- VGP issues one request at a time under foreground/backend leases, including while other game screens are open. It excludes the active manual encounter. It does not forge catch/spin responses. Unknown outcomes pause work instead of blindly retrying.
- Item cleanup uses configured inventory caps and pauses failed item requests. VGP waits for cleanup before selecting another target, with a bounded wait.
- UI markers are normalized projections of the active world target, not game-owned render objects. Camera/layout differences need device checks.

## Local data

Game inputs, generated APKs, credentials, device logs, coordinates, handoffs, and private investigation material must stay ignored or outside the checkout. Logs can contain personal location/account information; sanitize excerpts before sharing issues.

## Source map

Paths below are relative to `pgrazor/`.

| Area | Entry points and responsibility |
| --- | --- |
| Settings and feature policy | `src/dev/pgrazor/Control.java`: persisted state, readiness gates, public static bridge API |
| Settings persistence | `SettingsWriter.java`: ordered, coalesced snapshot writes and explicit flush/failure reporting |
| Accounts | `AccountProfileStore.java`: atomic identity index and storage namespaces; `AccountProfiles.java`: identity verification and switching; `AccountsDialog.java`: chooser; `AccountRestartActivity.java`: private process restart; `AccountSessionTransaction.java`: auth snapshot and replay journal; `AccountSessionVault.java`: Android Keystore vault; `runtime/features/accounts.js`: validated game identity/flush bridge |
| Runtime policy and outcomes | `VgpController.java`, `CatchOutcomeController.java`: VGP guards/markers/notifications and queued catch toasts |
| Menu and overlays | `Pad.java`: attachment, lifecycle, launcher, joystick and overlays; `SettingsPanel.java`: named settings section builders/binders and dialogs; `SettingsUi.java`: shared palette/styling |
| Map UI and movement | `WorldMapDialog.java`, `MapProjection.java`, `AutoWalkPlanner.java`, `MotionEngine.java`: viewport, gestures, selection, routes and movement |
| Map tiles and nearby points | `MapTileSource.java`, `MapTileCache.java`, `MapPoiLayer.java`: bounded tile fetching/cache, POI drawing, hit testing and details |
| Live feed | `LiveFeedClient.java`, `LiveFeedData.java`, `LiveFeedFilters.java`, `LiveFeedDialog.java`: service, data, filtering, UI |
| Bootstrap | `BootstrapProvider.java`, `embedded-agent.js`: asset extraction, bridge startup, feature scheduling and revocation |
| GPS | `runtime/location.js`: permission gates, location delivery, retained manager and hook cleanup |
| Native contracts and coordination | `diagnostics/quick-close.js`, `quick-ball.js`, `quick-summary.js`: metadata validation, catch/spin coordination, animation and presentation |
| Native feature state | `runtime/features/`: berries, buddy, gifts, incubation, items, battles, Rocket/minigame, spawn and VGP factories |
| Packaging | `build.py`, `nonroot.py`, `script_bundle.py`, `release_apk.py`: controls, injection, script composition, signed APK |

`diagnostics/` contains production native features as well as probes. The directory name does not mean those files are disposable.

Account namespaces are captured once at process startup. The first profile uses existing files in place; later profiles use `pgrazor-accounts-v1/profiles/<UUID>` and suffixed SharedPreferences. Location, cooldown, settings, saved places, overlay positions, map/feed preferences and GPX routes are scoped. LivePokeMap's encrypted service login stays global. Only a SHA-256 of the game's own PlayerService identity binds a profile; the display label can contain the trainer name. No game passwords or provider tokens are copied into the profile store.

Switching pauses automation and movement, flushes outgoing writes, records a pending target, then calls the game's logout wrapper. A successful logout Future plus disconnected state, or confirmed cleared live provider and cached login selection after the wrapper returns, permits target selection. An unexported activity in `:pgrazor_restart` verifies and terminates the outgoing main process before reopening the launcher. This prevents stale callbacks from writing into another account's namespace. The incoming process supplies its staged stationary location for login; gameplay automation stays gated until PlayerService identity matches. A mismatched login selects the actual identity's profile and restarts again. Interrupted requests are cancelled at startup; failed persistence keeps automation paused and preserves existing files. Account index mutations after startup run on a serial executor. Device tests must verify login and switching in both directions, not just identity readiness.

## Script modules and lifecycle

`runtime/bundles.json` declares ordered sources for packaged script assets. `script_bundle.py` joins their bytes with statement separators at build time. Asset names remain unchanged; there is no runtime module loader or additional startup I/O. The agent receipt hashes the complete packaged bundle. Tests use the same manifest through `test/script-bundle.cjs`.

Feature source files register factories without accessing the game. The validated `quick-close` installation calls each factory with explicit metadata, shared native helpers, and the session state. Each factory owns its feature state and exposes tick/coordination methods. Hooks still join the session's listener list; GC handles still use the shared ownership registry. The existing verified Unity-thread tick order and stop/drain protocol remain centralized. Lazy inventory access avoids capturing state before its original initialization point.

`runtime/features/itemValues.js` owns shared argument/boxed-value helpers; `nativePromise.js` owns promise inspection. `runtime/berry-policy.js` separates preference parsing from native hooks. Direct feature fixtures load factories from the same manifest instead of extracting comment-delimited regions. Build reports include `script_bundles` with the composed-byte hash and each contributing source hash.

The location module's `create({Java, control, isDisposed, bootLog})` is inert. Bootstrap calls `installPermissions()` early inside `Java.perform`, then `installDelivery()` on the Android main thread. Moving game location class initialization to the Gadget thread previously stalled startup. Delivery hooks private JNI lifecycle dispatchers, not virtual `onStart`/`onStop` or `notifyLocationUpdate`, which previously crashed on ART. `stop()` releases the retained manager, removes callbacks, and restores owned hooks. Permission gates affect only game-facing queries; actual Android grants stay unchanged.

Keep `Control` public static methods stable when extracting implementation classes: they are the bridge API used by the agent. Persisted keys, settings/state paths, signing identity, and runtime asset paths also require deliberate migrations.

## In-game Routes

`GameRoutesController` owns discovery selection, bounded runs and movement ownership. `GameRoutesDialog` is the quick-menu entry. This is separate from GPX and Pokestop Autowalk: each native Route has its own start, progress and reward lifecycle. A movement endpoint alone does not count as completion.

`runtime/features/routes.js` owns validated service capture, rooted Route definitions and one-shot native commands. `quick-close.js` supplies the verified Unity-thread tick and shared cleanup. Commands remain in the Java mailbox until acknowledged; revocation cancels pending native commands without replay. The translated bridge carries the same contract on MuMu. Unknown/stale state, game pauses, backgrounding and manual movement stop automation. Reward completion is latched from the matching native server-response callback and paired with the completion command sequence, because the game clears its current Route before periodic polling can observe the reward flag. Only the reward and rating screens opened by that automation are dismissed; no rating is submitted.

Route tracking also queries Unity's OS location-service availability. While a fresh synthetic-location lease is active, only this nested Route tracking query recognizes the synthetic provider. Android grants are unchanged; network, breadcrumb freshness and path checks remain active. The native icall is resolved by its exact name and validated against `libunity.so`; managed wrapper instruction bytes must not be used to validate that separate native function.

## Java ownership

`VgpController` owns runtime guard/status/marker state and notification dispatch. `Control` retains the public bridge methods and persisted preferences. Cooldown reads occur before the VGP lock; persistence and event logging occur after it. `CatchOutcomeController` owns toast tokens under its lock and toast instances on the main thread, with a second permission check before display.

Settings setters capture a snapshot under `Control`'s state lock and submit it to `SettingsWriter`. A single drain serializes and writes snapshots off the caller thread, coalescing queued changes. The sink captures its `AtomicFile` and never takes the state lock. Export/import flush pending writes before accessing that file; a failed flush aborts a reload. Backgrounding allows a bounded one-second flush. Abrupt process death can still lose an unflushed latest change; ordinary toggle writes no longer block the UI on disk I/O.

`SettingsPanel` owns settings widgets, named section construction/refresh methods, theme/inset handling, and item-dialog polling. A small host interface delegates overlay and navigation actions back to `Pad`. `Pad` owns attachment, the joystick, launcher and gameplay overlays, and closes the settings owner on detach. `SettingsUi` keeps the shared palette and styling in one place.

The map view owns projection, gestures, routes and selection. `MapTileSource` owns the bounded worker, viewport generation, retries and UI delivery; `MapTileCache` owns memory/disk bounds and tile validation. `MapPoiLayer` receives projection and snapshot interfaces and owns markers, hit testing and detail-dialog refresh. Closing the map closes both sources and suppresses stale callbacks. Tile cache code has no `Control` dependency.

## Verification map

`python -B tools/check.py` is the device-free gate used by CI.

| Tests | Runner |
| --- | --- |
| Motion, routes, ABI, projection, location state, camera steering/heading | `build.py --test-only` |
| Control policy, catch outcomes, settings export/import/reload, cooldown | `test/test_control_java.py` |
| Ordered settings writer, coalescing and failure recovery | `test/test_settings_writer_java.py` |
| Feed parsing/filtering and settings backup rules | `test/test_live_feed_java.py` |
| GPX parsing, validation, round-trips and saved route storage | `test/test_gpx_java.py` |
| Manifest, packaging, release assembly, private input, script bundles | Remaining `test/test_*.py` files |
| Runtime behavior and bridge fixtures | Every `test/*-test.cjs` file |
| Android compilation and saved-place validation | Full `build.py` (also run by CI) |

Python and Node tests are discovered by naming convention, not an allowlist. Test helpers use other names. The gate syntax-checks individual runtime sources and composed bundles. Native offsets, Android rendering, actual game lifecycle and server behavior still require focused device verification.

See [MAINTAINABILITY.md](MAINTAINABILITY.md) for the review findings and staged work.

The signed-out Accounts recovery action deletes only the pinned LoginState DOB and cached age-result PlayerPrefs keys, saves them through Unity, and cold-restarts. It neither supplies a date nor forces an age-check result. The normal game DOB prompt must evaluate the user's input. Metadata evidence is local; native tests assert unrelated preferences survive.

Remembered account sessions are captured only after the old Unity process stops. The helper preserves the three encrypted Niantic credential files and the cached provider choice, then restores the destination session before launching Unity. Normal logout is not used for switching because it revokes the refresh token. The encrypted journal makes interrupted swaps replayable at bootstrap before any game preference cache starts. Session blobs live in no-backup storage, bind their account ID through authenticated encryption, and are excluded from settings export. Unknown accounts start signed out; account identity must match before automation resumes. Focused session transaction tests cover roundtrips, credential rotation, new-account isolation and interrupted completion.
