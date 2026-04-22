# never-afk

Personal utility.

Source builds remain the primary path.
Optional GitHub Release binaries are provided for personal convenience only.
No support is offered.
macOS and Windows are the intended targets.
Linux is not supported.
Build from source at your own risk.

## What It Does

`never-afk` waits through a configurable quiet period, confirms that there has been no recent
human input, and only then sends a minimal synthetic keyboard event. Automatic activity can also
be limited to one or more weekly schedule ranges.

The intended behavior is:

1. Wait `quiet_period`.
2. Observe for `idle_confirmation_period`.
3. Restart the cycle if human input is detected.
4. Send the configured synthetic key press if the machine is still idle.
5. Optionally run only inside the configured weekly schedule ranges.

## Current Stack

- Tauri v2
- Rust backend
- React + TypeScript frontend

## Repository Policy

- No telemetry.
- No network features.
- No input logging.
- No activity history.
- No remote crash reporting.
- No warranty.

## Project Notes

- The canonical project decisions live in [docs/decisiones-never-afk.md](./docs/decisiones-never-afk.md).
- The current repository state already includes the resident engine, tray integration, settings UI
  and platform-specific keyboard drivers for macOS and Windows.
- macOS safe presets currently cover `F13` through `F20`. `F21` through `F24` remain available on
  Windows, and macOS can still use any supported custom key code through the advanced input path.

## Development

```bash
npm install
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

Use a current stable Rust toolchain. The repository includes `rust-toolchain.toml` to make that
expectation explicit.

## Releasing

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

The release workflow checks that automatically and refuses to publish if the
tag version and manifest versions do not match.

If the workflow cannot create or update a release, enable GitHub Actions
workflow permissions with repository write access for `GITHUB_TOKEN`.

Release assets currently target:

- macOS: `DMG` plus the `.app` bundle
- Windows: `MSI` plus the NSIS `.exe` installer

These builds are intended for personal convenience rather than full commercial
distribution. They are not signed with a `Developer ID Application` certificate
and are not notarized, so:

- macOS may require **Open Anyway** the first time the app is launched
- Windows SmartScreen may show an unsigned publisher warning
