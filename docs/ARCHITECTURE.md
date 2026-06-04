# Architecture

## Goal

This project is a Node.js 22 + TypeScript strict foundation for a WhatsApp legal-intake bot using OpenWA as the transport layer.

## Layers

- `src/transport/openwa`: OpenWA-specific adapters, listener wiring, and dispatcher boundaries.
- `src/ingress`: conversion from raw transport payloads into canonical contracts.
- `src/routing`: routing decisions based on canonical envelopes.
- `src/runtime/*`: isolated runtime decision logic for client, lawyer, and shared concerns.
- `src/output`: output plan construction before transport dispatch.
- `src/persistence`: storage interfaces only in this phase.
- `src/security`: sanitization and boundary helpers.
- `src/logging`: logger abstraction.
- `src/app`: application orchestration and bootstrap wiring.

## OpenWA Smoke Transport

- `src/app/openwaSmoke.ts` is the executable smoke entrypoint that validates runtime env, starts the OpenWA client, installs signal handlers, and wires transport dependencies.
- Retry the smoke startup with `npm run smoke:openwa` so the documented command stays aligned with the repo script.
- `src/transport/openwa/client.ts` owns OpenWA bootstrap, runtime session path setup, and raw OpenWA message adaptation.
- `OPENWA_BROWSER_EXECUTABLE_PATH` is an optional smoke-only env override that maps to the OpenWA launch `executablePath` and also enables `useChrome: true` when Windows needs to use a system Chrome binary.
- `src/transport/openwa/listener.ts` only logs receipt, maps raw transport data into the existing pipeline input, runs the pipeline, and hands the resulting `OutputPlan` to the dispatcher.
- `src/transport/openwa/dispatcher.ts` only sends supported text actions and ignores unsupported actions without introducing domain behavior.

## Windows Smoke Troubleshooting

- Use Node 22 LTS before retrying the smoke startup. The repo `engines` policy is `>=22 <23`.
- If `wmic` is missing on Windows 11, install the WMIC optional feature as Administrator with `DISM /Online /Add-Capability /CapabilityName:WMIC~~~~`, then verify with `wmic os get caption`.
- When a Windows machine already has Chrome installed, set `OPENWA_BROWSER_EXECUTABLE_PATH` to the local Chrome executable such as `C:\Program Files\Google\Chrome\Application\chrome.exe` before running `npm run smoke:openwa`.
- When `OPENWA_BROWSER_EXECUTABLE_PATH` is set, the smoke startup passes `executablePath`, `useChrome: true`, `headless: false`, `qrTimeout`, and `authTimeout` into the OpenWA create config. Leaving the executable path unset preserves the existing Puppeteer cache fallback behavior.
- If a smoke run launches Chrome but later times out during OpenWA initialization, delete `openwa-session/_IGNORE_<sessionId>` before retrying so the next smoke boot starts from a clean ignored transport session state. In PowerShell, run `Remove-Item -Recurse -Force .\openwa-session\_IGNORE_<sessionId>`.
- Keep the Chrome window visible during smoke runs and classify what you see before retrying again:
  - QR: the WhatsApp QR code is visible. Scan it from the phone, wait for chats to load, and keep the window open.
  - Blank: the window stays white or never reaches WhatsApp Web. Close Chrome, delete `openwa-session/_IGNORE_<sessionId>`, and retry.
  - Error: Chrome shows a crash page, profile warning, or other browser error. Close Chrome, verify `OPENWA_BROWSER_EXECUTABLE_PATH`, then retry.
  - Loaded: WhatsApp Web finishes loading but OpenWA still times out. Delete `openwa-session/_IGNORE_<sessionId>`, retry once, and capture the startup logs for the next investigation.

## Current Constraints

- No real intake flow yet.
- No attachments or PDFs.
- No LLM integration.
- No external SaaS integration.
- SQLite remains interface-only.
