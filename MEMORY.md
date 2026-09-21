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

## 2026-09-21 18:36:42

## Proto Studio v1.1.0 — images the agent can see (API shapes VERIFIED, not guessed)

**Vision input — the app-facing shape is `images: [base64]` ON THE MESSAGE, NOT OpenAI content parts:**
```js
chat.runTurn({ messages: [{ role:'user', content:'…', images: ['<base64, NO data-URL prefix>'] }] })
```
`ChatTurn` (src/lib/ollama.ts) is `{ role, content: string, images?: string[] /* base64, no prefix */ }`. Verified live: a canvas-drawn red circle sent this way came back as "I see a single solid circle centered…" (`sawImage: true`) on `deepseek-v4.1-flash:cloud`.
🔴 **DO NOT** send `content: [{type:'text'…},{type:'image_url',image_url:{url:'data:…'}}]`. It fails with a MISLEADING error — "The endpoint returned a web page (HTTP 400), not an API response. Check the Base URL in Settings → API Keys…" (raised in `src-tauri/src/custom_chat.rs`). That reads like a misconfigured endpoint, but the text control turn on the same model succeeded — it is a **schema rejection**, not config. Cost me a wrong diagnosis until the source was read.
**Vision gating:** models report `vision` in `listModels()[].capabilities`; the host strips images for models without it (silently). 5 of 9 models here have vision; the default `deepseek-v4.1-flash:cloud` does.

**Dropped files:** `window.chatoss.files.onDrop(cb)` → `cb(DroppedFile[])`, where
`DroppedFile = { name, type, size, text(): Promise<string>, arrayBuffer(): Promise<ArrayBuffer> }` — content arrives via the async readers (no path, no data URL). Requires `"fileDrop"` in capabilities: the host only wires drops when `manifest.capabilities.includes('fileDrop')` (AppRuntimeView `hasFileDrop`) and renders its own `.app-drop-overlay` OVER the iframe, so in-frame DOM drag events usually never fire — **the `onDrop` subscription is the real path**; an in-frame handler is only a fallback. Paste (Cmd+V) needs no capability and works through `clipboardData.items`.

**scopedData is safe for big values:** a `scoped_data` value (or message payload / attachment data URL) over `BLOB_THRESHOLD_BYTES` (256KB) is content-addressed into `blobs/<sha256>` by the host and resolved transparently on read (src-tauri/src/db.rs). So base64 image data URLs can live in app state; still downscale (long edge 1400px → JPEG q0.86, mirroring the host's own `images.ts fileToAttachment()` "downscale→JPEG").

**🔧 Reusable forensic technique — probe reports via Drive:** when a probe needs to return a LOT of text (API registries, JSON) or must survive the preview's early snapshot, have the app write it with `drive.writeFile('_probe/<name>.json', text)` and read it from disk:
```bash
cat ~/Library/Application\ Support/com.chatoss.desktop/drive/<appid>/_probe/<name>.json
```
Far better than the `document.title` trick (no size limit, no second boot needed, no truncation).

**Where to find canonical shapes fast (the real boundary):** the ChatOSS source is at `~/Documents/chat-oss-projects/chat-oss`. Read it instead of guessing: `src/lib/appBridge.ts` (bridge contracts + `DroppedFile`), `src/lib/ollama.ts` (`ChatTurn`, `ToolCall`), `src/lib/chatApi.ts` (`RunTurnOptions`/`RunTurnResult`), `src/components/AppRuntimeView.tsx` (drop wiring), `src/lib/images.ts` (attachment pipeline). `platform.apis()` (inside the app) gives live method signatures. Grep with `--exclude-dir=target --exclude-dir=node_modules` and BOUND the output — a bare recursive grep over `src-tauri/target` (Rust build artifacts, hundreds of MB) TIMES OUT the shell wrapper.

## 2026-09-21 18:40:24

## Store listing state (Proto Studio) — DO NOT resubmit unless the user asks

- **The app itself is fully shipped and live-installable:** repo `pagecow/proto-studio` (public, `main`, commit `41e5f98` + docs commit), latest release **v1.1.0** with `app-v1.1.0.aip` / `.zip` (24,149 bytes each, draft=false prerelease=false). The Store hosts no files, so anyone installing from the listing already gets 1.1.0 **with image drop/paste**.
- **The Store *listing* description update is NOT live for other users.** The first resubmit (description now mentioning image input) ran the review and **APPROVED**, and was saved on this device — but the shared Store was unreachable at that moment, so it did not sync. Per the tool: it appears for other users "once they reconnect and publish it again". A retry was attempted and the user **cancelled the confirmation card** — so it is deliberately unsubmitted. 🔴 Do not call `publish_to_store` again for this app unless the user explicitly asks.
- If the user later asks to retry: `publish_to_store({ name:'Proto Studio', category:'Design', repoUrl:'https://github.com/pagecow/proto-studio', description: <the version that mentions dropping/pasting reference images> })`.
- Note the review runs (and is charged) per submission; the user is aware and chose to hold off.
