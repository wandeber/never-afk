# never-afk

`never-afk` is a lightweight menu bar utility that keeps your machine active only when it has
actually gone idle. It waits through a quiet period, confirms that no human input has happened
recently, and then sends a minimal synthetic key press.

The result is simple: fewer false wake-ups, less unnecessary input, and a predictable background
tool that can be limited to the exact days and time ranges where you want it running.

## Highlights

- Menu bar utility with a compact settings window
- Configurable quiet period and idle confirmation period
- Configurable synthetic key presets plus custom platform key codes
- Weekly schedule ranges with multiple windows per day
- Runtime status in the UI and tray
- Start at login support on supported platforms
- Local-first behavior with no telemetry, no network features, and no input logging

## How It Works

`never-afk` follows a cautious cycle before generating any synthetic input:

1. Wait for the configured `quiet period`.
2. Observe the system for the configured `idle confirmation period`.
3. Cancel the cycle immediately if human input is detected.
4. Send a minimal synthetic key press only if the machine is still idle.

When a weekly schedule is enabled, the automatic cycle only runs inside the configured schedule
ranges. Outside those ranges, the engine sleeps until the next relevant start or end boundary
instead of polling constantly.

## Main Features

### Synthetic key selection

Choose from built-in presets such as function keys and modifier keys, or provide custom platform
key codes when you need more control.

### Weekly schedule ranges

Create as many schedule ranges as you need:

- different ranges on different weekdays
- multiple active windows on the same day
- exact start and end times for each range

This is useful when you only want `never-afk` active during specific working blocks instead of the
whole day.

### Persistent tray status

The tray/menu bar reflects the current engine state and can optionally show the timestamp of the
last synthetic event.

### Privacy-first behavior

`never-afk` is intentionally small in scope:

- no telemetry
- no remote services
- no input history
- no activity logging

## Platform Notes

- macOS and Windows are the intended targets.
- Linux is not supported.
- macOS safe presets currently cover `F13` through `F20`.
- `F21` through `F24` remain available on Windows.
- macOS can still use supported custom key codes through the advanced input path.

## Development

```bash
npm install
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

Use a current stable Rust toolchain. The repository includes `rust-toolchain.toml` to make that
expectation explicit.

## Releases

GitHub Releases are published only when you push a tag in the `version-x.x.x` format.

Example:

```bash
git tag version-0.1.0
git push origin version-0.1.0
```

Before tagging a release, make sure the version matches in all three places:

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

The release workflow checks that automatically and refuses to publish if the tag version and
manifest versions do not match.

Release assets currently target:

- macOS Apple Silicon: `DMG`
- Windows x64: `EXE`

These builds are intended for personal convenience rather than full commercial distribution. macOS
builds are ad-hoc signed so the downloaded app bundle passes Apple Silicon integrity checks, but
they are not signed with a `Developer ID Application` certificate and are not notarized, so:

- macOS may require **Open Anyway** the first time the app is launched
- Windows SmartScreen may show an unsigned publisher warning

If the workflow cannot create or update a release, enable GitHub Actions workflow permissions with
repository write access for `GITHUB_TOKEN`.

## More Context

The canonical project decisions live in [docs/decisiones-never-afk.md](./docs/decisiones-never-afk.md).
