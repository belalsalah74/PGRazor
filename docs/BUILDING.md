# Building PGRazor

Local builds read the Settings header version from `pgrazor/VERSION`. Release builds override it with `PGRAZOR_VERSION` from the workflow release tag. This is the PGRazor version, independent of the base game version.

## Requirements

The APK packaging toolchain currently supports Windows. Install Python 3.12+, Node.js 22+, JDK 17+, and the Android SDK. The Python build tools use the standard library.

Default SDK packages are `platforms;android-36.1` and `build-tools;36.1.0`. CI uses API 36 / Build Tools 36.0.0. Override them when needed:

```powershell
$env:ANDROID_HOME = 'C:\Android\Sdk'
$env:PGRAZOR_ANDROID_PLATFORM = 'android-36'
$env:PGRAZOR_BUILD_TOOLS = '36.0.0'
python -B tools/check.py
```

## Local playable build

Supply your own unmodified, Niantic-signed ARM64 game APK/APKM. The supported input is PokÃ©mon GO 0.433.1, version code 2026101502. The release workflow additionally pins its SHA-256:

```text
aabe3f866bb20b008d10646d35615fe8845ad0164ddc5ac7984e1a5565836e53
```

Keep the original under the ignored `pgrazor/input/` directory. From the repository root:

```powershell
python -B pgrazor/nonroot.py --apk pgrazor/input/game.apkm --download-runtime --camera-steering --interaction-probe --quick-ball --quick-close
python -B pgrazor/release_apk.py --run pgrazor/build/nonroot/RUN-ID --output pgrazor/build/release
```

Use the run directory printed by the first command. The second command merges the library-only ARM64 configuration split, removes split-install requirements, labels the installed application PokÃ©mon GO (the in-game menu remains PGRazor), aligns and signs **PGRazor.apk**, and writes checksums. It rejects resource/code splits rather than silently dropping them. No command installs anything on a phone.

To build a scanner candidate, replace `--quick-ball` with `--shiny-scanner`. For a scanner-only package, omit `--quick-close`, `--camera-steering`, and `--interaction-probe` too. This exposes a separate Shiny Scanner setting and overlay while leaving Quick Ball gameplay controls disabled. The scanner still uses the shared native diagnostics host for Unity-thread metadata and lifecycle management; the `--shiny-scanner` option does not enable catching or throw automation.

Single-APK packaging is new and still needs a disconnected-phone install/launch check. Existing split builds remain available in the run directory as a rollback option. Preserve a tested installation until the new candidate has been checked.

## Runtime selection on phones and MuMu

The default game build bundles ARM64 and x86-64 hook runtimes in the same APK and selects one from the native process architecture at startup. The game libraries remain ARM64. MuMu translates those libraries while its Android Java process runs as x86-64.

On an ARM64 phone, the existing runtime handles both Android controls and game hooks. On MuMu, the x86-64 runtime handles Android location/permission hooks and loads a second ARM64 runtime through the app class loader for Unity hooks. They exchange settings and events through a private per-process mailbox. Stale snapshots revoke feature leases; nothing requires a root daemon or an external controller.

Translated executable code is checked against the ARM ELF executable segments and the existing instruction fingerprints. Two empty gift-open callbacks use completed GUI-state observation because MuMu cannot place an interceptor on their single return instruction. The same APK has passed native-feature startup checks on a Pixel phone and MuMu with location permission denied. Preliminary gameplay testing passed on both; broader MuMu regression testing remains limited.

`--runtime-abi arm64-v8a` or `--runtime-abi x86_64` can produce a restricted diagnostic build, but normal builds and the release workflow use automatic runtime selection. The release build information records the bundled hook runtime architectures separately from the game's ARM64 architecture.

## Signing

Local development creates an ignored `build/pgrazor-development.jks` key with alias `pgrazor`. This key uses a development password; configure a dedicated strong-password keystore for releases. Pre-release builds do not migrate previous pre-release settings or identifiers.

For explicit signing, set `PGRAZOR_KEYSTORE`, `PGRAZOR_KEY_ALIAS`, `PGRAZOR_STORE_PASSWORD`, and `PGRAZOR_KEY_PASSWORD`. Passwords are passed to Android signing tools through environment variable references, not command-line values. A missing configured key or password fails the build. Keep the same certificate across updates.

The `build.py` output named `pgrazor-preview.apk` is a controls preview, **not the game**. Do not publish it as a working PGRazor release.

## GitHub Actions: APK releases

Configure these Actions secrets:

| Secret | Value |
| --- | --- |
| `PGRAZOR_INPUT_URL` | HTTPS URL to the supported original APKM, or a GitHub release-asset API URL in this repository |
| `PGRAZOR_KEYSTORE_BASE64` | Base64-encoded release keystore |
| `PGRAZOR_KEY_ALIAS` | Signing alias, e.g. `pgrazor` for PGRazor |
| `PGRAZOR_STORE_PASSWORD` | Keystore password |
| `PGRAZOR_KEY_PASSWORD` | Private-key password |

For a private GitHub input asset, use its `https://api.github.com/repos/OWNER/REPO/releases/assets/ID` URL. The workflow supplies its scoped token; authorization is removed when GitHub redirects to the signed download host.

Run **Actions â†’ Playable APK release â†’ Run workflow**, enter a version tag such as `v0.1.0`, and leave `publish` off for a candidate. Download **PGRazor-apk** from the completed run and extract **PGRazor.apk**. Repository read access is required to download private [workflow artifacts](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts).

After device testing, run with `publish` enabled to create a full release containing the APK, checksums, and build information. An existing tag/release is not overwritten. The workflow is manually triggered, does not run on pull requests, and requires a versioned release-notes file at `docs/releases/TAG.md`. The shared `docs/releases/footer.md` is appended automatically, including the optional Ko-fi support link. No secrets or game files are uploaded by source CI.

The published release contains the installable APK, checksum, build information, and the versioned changelog. The signing key remains an Actions secret; keep it unchanged across releases.

## Discord release announcements

Create an incoming webhook in Discord channel `1562582290536726598` under **Edit Channel â†’ Integrations â†’ Webhooks**. Save its URL as the repository Actions secret **DISCORD_RELEASE_WEBHOOK**. Do not commit the URL.

The **Discord release announcement** workflow posts published releases (including labeled prereleases) with release notes, a GitHub link, an APK link when present, and the optional Ko-fi support link. It verifies the webhook's channel before sending. Drafts are not announced. The APK release workflow calls it directly because releases created with `GITHUB_TOKEN` do not trigger another release-event workflow.

To ping a release subscriber role, set the repository Actions **variable** `DISCORD_RELEASE_ROLE_ID` to its numeric role ID (Discord Developer Mode â†’ right-click the role â†’ Copy Role ID). Ensure Discord allows the webhook to mention that role. Only this role is allowed to ping; other roles, users, and everyone mentions remain disabled. Leave the variable unset to send without a ping. This also applies to prereleases and manual announcements.

Without the secret, the announcement step logs a warning and sends nothing. To announce an existing release after setup, manually run **Discord release announcement** with its tag. Manual runs and reruns can post another announcement, so check the channel before retrying. This posts a channel message; it does not crosspost to channel followers.

## Installation and updates

Install the single APK with Android's package installer, or use `adb install -r PGRazor.apk` from a computer. Never uninstall a working PGRazor build just to bypass a signing error; use a build signed with its existing key. An official-store game cannot be replaced in place by a differently signed build. Local application data may be lost if you choose to uninstall it.

The minimum SDK is Android 9 (API 28), but native gameplay hooks are supported only on the pinned ARM64 game build. No emulator, future-version, or all-device compatibility is implied.

## Retention

`cleanup.ps1` removes recognized obsolete generated APK files after packaging. It preserves diagnostic records, keys, inputs, and runtime dependencies. Copy `build-retention.example.json` to the ignored `build-retention.json` on a new checkout; packaging also initializes it if missing and pins the first completed candidate (not a tested rollback). Pin deployed builds and a tested rollback before replacing them. Never commit device-specific retention history.
