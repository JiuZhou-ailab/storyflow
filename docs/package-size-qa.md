# Desktop package size acceptance

Implements [Spec #44](https://github.com/JiuZhou-ailab/storyflow/issues/44). This runbook
owns reproducible verification and evidence; the issue owns scope and acceptance.

## Build and inspect

Use the existing native runtime-staged build entrypoint, without upload flags:

```sh
CRAFT_SKIP_INSTALL=1 bun run scripts/build.ts --platform=darwin --arch=arm64
bun run electron:package:verify -- --platform=darwin --arch=arm64 --measure-only
```

Use `darwin/x64` on an Intel runner and `win32/x64` on Windows. The inspector expects
both final DMG and ZIP on macOS, or the final NSIS EXE on Windows, plus the corresponding
unpacked application. `--release-dir` can select another build output directory.
Do not compare builds with different source, dependencies, architecture, signing or
public build settings. Keep the baseline output before the next build cleans `release/`.

The inspector checks nonempty runtime assets, Bun/Pi multiplicity, product language
mapping, forbidden files and target-specific binaries. It mounts DMGs read-only,
extracts ZIP/NSIS payloads into temporary directories, and compares every file's bytes, macOS executable bits
and symlink target against the validated app. Temporary mounts/directories are removed.
A malformed, empty, missing or different archive fails even in measurement mode.

`package-report-<platform>-<arch>.json` records component and logical file bytes (without
following framework symlinks twice), final download bytes, SHA-256 hashes, source/lock
identity, toolchain, signature observation and budget status. Measurement mode explicitly
reports `not-evaluated`; it never means a release gate passed. Final signing/notarization
and update-manifest validation remain in the existing release workflow.

## Budgets and release gate

After functional acceptance, enter reviewed **integer byte limits** in
`scripts/build/package-size-budgets.json` for the application and every final format.
Use measured accepted output plus an explicitly justified margin. Never derive or enlarge
limits automatically from the candidate. `null` means **unapproved**, not unlimited or zero;
release verification fails until all limits for its target are approved.

```sh
bun run electron:package:verify -- --platform=darwin --arch=arm64
```

Native release jobs run this check before uploading binaries and retain the JSON report.
A changed Electron/toolchain or added capability needs a reviewed budget adjustment.
UDBZ affects the DMG; ZIP must be measured separately. PDF and minification gains overlap.

## Functional QA

1. Run `bun run typecheck:all`, focused build tests and
   `bun test ./scripts/build/attachment-package.isolated.ts`, then `bun run test`.
   The attachment test uses the production bundled storage entrypoint and authored real
   PDFs (single page, multipage, Chinese, corrupt), preserving original bytes and hashes.
   Run `bun run test:doc-tools` for existing PDF/Office/script capability smoke.
2. Run the packaged core E2E with an isolated fixture and loopback model:
   `CRAFT_E2E_ELECTRON_BIN="<Storyflow executable>" bun run e2e:core`.
   On macOS, launch the harness by absolute Bun path with `PATH=/usr/bin:/bin:/usr/sbin:/sbin`
   to exclude system-installed Bun/Node from child discovery. Do not run against user data.
3. Verify native Extension install/load/reload, Skill discovery, Project and Free Conversation
   runtime readiness, document tools, highlighter/theme/Mermaid rendering and all product
   languages. Use a local trusted fixture and local protocol tests for messaging; no real
   contacts or paid providers. Test Windows with a space-containing install path.
4. Use the existing signed macOS install/upgrade procedure and Windows startup/upgrade
   script. Verify restart, signatures, notarization, update hashes/manifests and previous
   release upgrade. Restore only test installations; do not overwrite a user's app/profile.
5. Record each platform's evidence and gaps below. A source test or successful archive
   extraction does not satisfy an unavailable native installation test.

## Evidence from this implementation

2026-09-21, source base `bfa0fd260c0c0cf27b4430651cab2664f515db88`, same
working-tree product changes preserved in both builds. Native Apple Silicon builds,
Electron 39.2.7, app-builder-lib 26.4.0, build Bun 1.4.2, bundled Bun 1.3.9 and uv 0.10.6.
Both applications and DMGs were Developer ID signed and notarized; these are complete
build outputs, not trimmed copies of an installed application.

| ARM64 artifact | Baseline bytes | Optimized bytes | Reduction |
| --- | ---: | ---: | ---: |
| Application | 521207535 | 453032446 | 13.08% |
| DMG | 200518406 | 168561896 | 15.94% |
| ZIP | 191267232 | 175599959 | 8.19% |

Main bundle: 40,416,362 → 19,663,434 bytes; WhatsApp: 6,065,704 → 3,791,200;
bootstrap preload: 834,809 → 597,185.
Main includes overlapping minification/PDF gains. Locale and icon removal account for
most other expanded savings; UDBZ affects only the DMG. Do not add the standalone
unminified PDF estimate to this combined total.

ARM64 budgets are accepted measured bytes plus 3%, rounded up to the next MiB:
application 445 MiB, DMG 166 MiB, ZIP 173 MiB. They are static reviewed ceilings, not
values recomputed by the gate. Intel and Windows remain `null` and block their release
jobs pending native complete builds, measurements and functional acceptance.

Verified on the ARM64 candidate:

- DMG verification/read-only mount and ZIP extraction; every application file hash and
  symlink target matches the unpacked application. Developer ID, Gatekeeper and staples
  were validated on both the application and DMG. Runtime content and locales passed.
- Packaged core E2E passed with `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, using an isolated
  profile and local model stub: Project edit, Skill import, version restore and restart.
- The packaged Pi executable passed both compiled-subagent cases with an empty PATH,
  a real native Extension, conflicting tool names and local model responses. The public
  prompt path reloads the session resources before tool use. Set `CRAFT_E2E_PI_SERVER_BIN`
  when rerunning the existing compiled-subagent suite against a package.
- All 19 existing document-tool smoke tests passed. A separate packaged uv/DOCX/MarkItDown
  smoke recovered English and Chinese text with system Bun/Node absent from PATH.
- Production attachment-bundle PDF tests passed, including corrupt-input fallback and
  byte/hash preservation. Repository `typecheck:all` passed. Full tests: 5,932 pass, 0 fail, 11 skip. Additional standalone script
  typechecking found only four pre-existing `shell: true` errors in build/common.ts.

Still required before Spec #44 is fully accepted:

- Native Intel/Windows before-and-after artifacts, byte budgets and installer/upgrade
  acceptance (AC-1/2/3/6 on those platforms). This machine does not supply those runners.
- Clean native install/previous-version upgrade acceptance, all-language UI checks,
  platform icon appearance and complete offline highlighter/theme/Mermaid QA.
- Native package-manager Extension installation and repeated UI reload acceptance,
  particularly Windows space-containing paths. The packaged loader smoke alone does
  not prove the installation flow.

The package inspector and CI wiring are complete, but these gaps keep the overall spec
open. Do not publish an unmeasured target or replace its null budgets with guessed values.

Optimized DMG SHA-256: `8c07f26b6c21d02b3b624bbeeac3004845c8ec2e42affc60367d27e829d00b7a`.

Optimized ZIP SHA-256: `da39760e05b739127fb33756737e12d555a688382c5e915b009a5fd8bf6ea1cb`.

## Standards review

No hard standards violations. The review's executable-bit observation was addressed:
macOS archive comparison includes execute bits, with a red/green permission-only ZIP
regression. Read-only DMG permission differences outside execute bits are ignored.

## Spec review

The missing-document-assets finding was addressed in the shared asset contract: all
8 existing document tools require their Python script and both native launchers. Removal
of a DOCX script or PPTX launcher now fails. Real ARM64 artifacts passed the expanded
contract. The native platform/manual acceptance gaps above remain open.
