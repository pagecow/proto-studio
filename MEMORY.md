# Project memory

Durable lessons recorded by coding agents working in this project. The engine reads this file at the start of every session and shows it to the next agent — append anything the next session should know.


## 2026-09-21 18:17:19

## Proto Studio (.aip app) — build notes

**What it is:** three-column prototype builder — projects | Proto Agent | device canvas (desktop/tablet/phone). Files: `app.json`, `index.html`, `style.css`, `app.js`, `icon.svg`. App id `com.protoforge.studio`, capabilities `chatApi`, `clipboardWrite`, `drive`.

**Canonical `chat.runTurn` tool schema (CONFIRMED against the live engine, not guessed):**
`{ type:'function', function:{ name, description, parameters:{ type:'object', properties, required } } }` — same shape the shipped `code` app uses in its `tools.js`. Passed directly as `tools:`; `onToolCall` receives a call whose args arrive **already parsed** (`{ name:'ping', args:{ value:42 } }` — the number stayed a number, so `JSON.parse` is a fallback only). Returning a **string** from `onToolCall` resumes the loop and the final text comes back as `res.content` (a string). Verified live: 9 models from `listModels()`, default `deepseek-v4.1-flash:cloud`.

**Probe technique worth reusing:** `preview_check` snapshots the frame *before* an async model turn can finish, so a probe that sets `document.title` at boot is never readable in the same run. Fix: have the probe `await scopedData.set('probe.result', …)` and, on the NEXT boot, read that key back before rendering — the value then shows up in the next `preview_check` title. Two runs, full end-to-end evidence, no filesystem digging.

**Verified geometry:** desktop device box = 1440×900 + 36px browser chrome = 1440×936; `fit` scale = `min((stageW-58)/w, (stageH-86)/h, 1)`; the scaler wrapper is sized to the scaled box and `.pf-device` is `position:absolute; transform-origin:top left`. The prototype's `srcdoc` frame really does load under `sandbox="allow-scripts"` (the `load` event fires) — but `contentDocument` is unreadable (opaque origin), so onload is the only cross-frame signal available.

**Gotchas hit:** the starter template's `style.css` shipped `:root` colour-token overrides and a `prefers-color-scheme` block — both forbidden; rewritten token-only. `[hidden]` does NOT beat my own component `display` rules (e.g. `.pf-device[data-target="desktop"] .pf-chrome{display:flex}` outranks `[hidden]`), so the device chrome is toggled by CSS attribute only and `.pf-shell [hidden], .overlay [hidden]{display:none!important}` is declared at the end of `style.css`.

## 2026-09-21 18:21:30

## Proto Studio — PUBLISHED (repo + Store listing)

- **Repo (public):** https://github.com/pagecow/proto-studio — branch `main`, first commit `e325265`.
- **Release:** https://github.com/pagecow/proto-studio/releases/tag/v1.0.0 — assets `app-v1.0.0.aip` and `app-v1.0.0.zip` (both 20,626 bytes, byte-identical copies). Verified via `gh api …/releases/latest`: `draft:false prerelease:false`, both assets present.
- **Store listing id:** `proto-studio` — approved and LIVE in the shared ChatOSS App Store. The Store hosts no files; installs/downloads come from the repo's latest release assets.

**Shipping an update (repeat this chain):** bump `version` in `app.json` → commit → `gh release create vX.Y.Z --target main --title "…" --notes-file tmp/release/notes.md` → rebuild the .aip with `zip -q -r tmp/release/app-vX.Y.Z.aip app.json index.html style.css app.js icon.svg` → upload the `.aip` AND a byte-identical `.zip` copy as release assets. A release with no installable asset breaks installs/updates ("This release has no .aip file to install"). Build release artifacts in `tmp/release/` (gitignored) so the app tree stays clean — the zip must stay FLAT (only the 5 runtime files; no README/AGENTS/MEMORY/tests/.git).

**Environment gotchas hit here (macOS host):**
- Host `git` is **2.23.0** — `git init -b main` is unsupported (exit 129). Use `git symbolic-ref HEAD refs/heads/main` on the fresh repo instead.
- **Heredocs (`<<'MSG'`) do not work** through this run_command shell wrapper — the whole command fails with exit 129 and no output. For multi-paragraph commit messages use repeated `-m` flags (each `-m` becomes its own paragraph; put `Built with ChatOSS.ai` last); for release notes use `--notes-file <path>` with a `write_file`-created file.
- `gh` is authed as **pagecow** (scopes include `repo`, `workflow`); git uses SSH.
