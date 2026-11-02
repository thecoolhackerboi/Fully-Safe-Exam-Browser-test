# FSEB — Fully Safe Exam Browser

FSEB is a custom/educational exam-browser implementation built to provide a controlled environment for web-based assessments. It acts as a desktop application designed to lock down a browser environment during examinations.

**Disclaimer:** FSEB is an independent educational development project. It is **not** an official Safe Exam Browser (SEB) product and is **not affiliated** with Safe Exam Browser, ETH Zürich, or CodeChef.

---

## Features

**Implemented**
- Embedded Chromium browser via Electron
- Exam URL loading and normalization
- Controlled navigation and strict navigation policies
- Clipboard operation lockdown (prevention of copy/paste)
- Fullscreen kiosk enforcement and window handling
- Loading and parsing `.seb` configuration files (including compressed/GZIP CodeChef configs and JSON configs)
- Exam session management
- Keyboard policy (interception of specified key combinations)
- Authentic SEB-style Windows UI (taskbar, quit modal)
- Windows registry protocol handlers (`seb://`, `sebs://`)

**Planned / Not Implemented**
- Advanced VM detection
- Virtual desktop prevention/locking
- Comprehensive background application monitoring
- macOS / Linux native integrations

---

## Requirements

To clone, build, and run FSEB, you need the following prerequisites installed on your system:

- **Operating System:** Windows (Primary target for protocol handlers and UI integration)
- **Git:** For cloning the repository
- **Node.js:** v24 (or later LTS)
- **Package Manager:** npm (comes with Node.js)
- **TypeScript:** Provided via npm dependencies

---

## 1. Clone the repository

```bash
git clone https://github.com/thecoolhackerboi/Fully-Safe-Exam-Browser-test.git
cd Fully-Safe-Exam-Browser-test
```

---

## 2. Verify the project

Ensure you have the required runtimes and tools installed correctly:

```bash
git status
node --version
npm --version
```

---

## 3. Install dependencies

Install all required Electron and TypeScript packages:

```bash
npm install
```

---

## 4. Build the project

Compile the TypeScript source code and prepare the assets:

```bash
npm run build
```
This command runs `tsc` (TypeScript compiler) and copies necessary HTML/CSS UI assets to the `dist` directory.

To generate the authentic `FSEB.exe` executable on Windows:
```bash
npm run pack
```
This packages the standalone `FSEB.exe` into `release/win-unpacked/` so that Windows, Chrome, Edge, and the Taskbar recognize the application as **FSEB** instead of the generic development Electron runtime.

---

## 5. Run the project

To launch FSEB in development mode:

```bash
npm start
```
This will build the project and launch the application. If you have an exam configuration file (e.g., `exam.seb`), you can test the protocol integration or load it via the UI if supported.

---

## 6. How CodeChef & SEB-Protected Exams Run Seamlessly on FSEB (The Underlying Architecture)

When assessment platforms such as **CodeChef**, **Moodle**, or **HackerRank** require an exam to be opened inside **Safe Exam Browser (SEB)**, they employ a multi-layered verification strategy spanning the operating system, HTTP networking, DOM runtime, and security headers. 

FSEB intercepts and satisfies each verification layer seamlessly without requiring the proprietary SEB binary. Here is the hardcore technical breakdown of how this is achieved:

### 1. OS-Level Protocol & File Association Hijacking (Windows Registry Interception)
* **The Mechanism:** When a user clicks *"Start Exam in Safe Exam Browser"* on CodeChef, the browser does not launch an application directly; rather, it invokes a registered OS URI scheme (`seb://`, `sebs://`, or `seb-config://`) or downloads an XML `.seb` file.
* **FSEB Implementation:** In `src/Platform/WindowsIntegration.ts`, FSEB registers itself in the Windows User Registry (`HKCU\Software\Classes\seb`, `sebs`, `seb-config`, and `.seb`) as the primary system handler. Windows uses its Shell API (`ShellExecuteExW`) to look up the executable associated with the protocol. FSEB binds these registry keys to point directly to `FSEB.exe` (or the local development runtime), instructing Windows to forward the launch parameters (`"%1"`) into FSEB's process arguments.
* **Single Instance IPC Routing:** If FSEB is already open, `app.requestSingleInstanceLock()` catches the launch attempt and forwards the new URL/file target across the Electron IPC channel (`second-instance` event) to the running window without spawning duplicate, conflicting windows.

### 2. SEB Protocol De-obfuscation & Plist Parsing Pipeline
* **The Mechanism:** SEB protocol links are encoded representations of standard web addresses (`sebs://` maps to `https://`, and `seb://` maps to `http://`). `.seb` configuration files are Apple XML Property Lists (Plists) or zlib-compressed/GZIP streams containing exam metadata, start URLs, and security restrictions.
* **FSEB Implementation:** In `src/Configuration/SebLoader.ts` and `src/Configuration/PlistParser.ts`, FSEB normalizes the protocol URLs and inspects configuration payloads. If a `.seb` file is compressed, it inflates the GZIP stream and parses the XML Plist schema into a strongly-typed `ExamConfiguration` object, dynamically extracting the assessment URL, session keys, and window parameters.

### 3. HTTP Network Layer Fingerprint Emulation (User-Agent Synthesis)
* **The Mechanism:** Assessment servers inspect incoming HTTP request headers to prevent students from navigating via regular Chrome, Firefox, or Safari. Specifically, backend web firewalls and exam gateways verify that the `User-Agent` header matches SEB's platform signature (e.g., `SEB/3.10.2`).
* **FSEB Implementation:** Inside `src/Browser/BrowserHost.ts`, FSEB configures the underlying Chromium `BrowserView` session to emit an authentic composite user agent:
  ```text
  Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 SEB/3.10.2
  ```
  Every HTTP GET/POST request initiated by the exam page includes this signature, passing server-side SEB validation with zero rejection.

### 4. Client-Side DOM & JavaScript Runtime Emulation (`window.SafeExamBrowser`)
* **The Mechanism:** CodeChef's client-side JavaScript performs anti-tamper telemetry by inspecting the browser's global scope before loading the problem statements and IDE. It queries `window.SafeExamBrowser` to verify browser properties like `.version` and `.platform`.
* **FSEB Implementation:** In `src/Preload/exam-preload.ts`, FSEB injects a mock SafeExamBrowser bridge before any page scripts execute:
  ```typescript
  contextBridge.exposeInMainWorld('SafeExamBrowser', {
    version: 'SEB_Windows_3.10.2',
    platform: 'Windows',
  });
  ```
  Because this is exposed in the main world via Electron's `contextBridge` / `webFrame.executeJavaScript` at `document_start`, CodeChef's client-side telemetry queries return positive status immediately.

### 5. HTTP Header Stripping & Frame Liberation (CORS & CSP Rewriting)
* **The Mechanism:** Assessment platforms often send restrictive HTTP response headers such as `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, and Cross-Origin Resource Policy headers (`COOP`/`COEP`) to isolate their embedded code editors, test case runners, or terminal frames.
* **FSEB Implementation:** In `BrowserHost.ts`, FSEB hooks into the Chromium networking layer via `session.webRequest.onHeadersReceived`. It sanitizes incoming response headers by stripping `frame-ancestors` directives and removing `x-frame-options`, allowing embedded Monaco code editors, compiler consoles, and iframe test environments to render without CSP violations.

### 6. Surgical Event Interception (Neutralizing Anti-Cheat without Breaking Monaco IDE)
* **The Mechanism:** Exam platforms attach aggressive DOM listeners to `copy`, `paste`, `cut`, `selectstart`, `contextmenu`, and `keydown` to block text highlighting and clipboard access. These listeners call `event.preventDefault()` and `event.stopPropagation()`.
* **FSEB Implementation:** In `src/Preload/exam-preload.ts`, FSEB wraps `EventTarget.prototype.addEventListener` before the page scripts load. 
  - **Selective Neutralization:** When an anti-cheat script calls `e.preventDefault()` on question paragraphs or problem descriptions, FSEB neutralizes the call, allowing students to select and copy problem text.
  - **IDE Preservation:** Crucially, inside code editor targets (`textarea`, `input`, `.monaco-editor`), Monaco Editor relies on its own `preventDefault()` during paste events so Chromium does not trigger a duplicate native DOM paste. FSEB detects editor targets (`isEditorTarget`) and preserves the editor's native event control, eliminating double-pasting and avoiding layout wrapping.

---

## 7. Exam Config

FSEB handles both standard and zipped (GZIP) `.seb` configuration files (often containing Plist format configurations).
- **Core Files:** Check `src/Configuration/SebLoader.ts` and `src/Configuration/PlistParser.ts`.
- The application extracts the URL, exam settings, and UI policies from the config file to instantiate the `ExamSession`.

---

## 8. Structure

```text
FSEB/
│
├── src/
│   ├── Browser/           # Browser host and navigation policies
│   ├── Configuration/     # Parsing of .seb, Plist, and Exam configs
│   ├── Core/              # Core state, sessions, and logging
│   ├── Platform/          # Windows registry and specific OS integrations
│   ├── Preload/           # Electron preload scripts for security
│   ├── Security/          # Lockdown policies (Keyboard, Window, Clipboard)
│   ├── UI/                # Main screens (Window, Loading, Error, About)
│   └── main.ts            # Entry point
│
├── tests/                 # Test suite (run with tsx)
├── scripts/               # Build and registry setup scripts
├── samples/               # Sample .seb configuration files
└── package.json           # Project metadata and dependencies
```

---

## 9. Architecture

FSEB uses **Electron (Node.js + Chromium)** for its core architecture. 
- **Main Process:** Handles security policies, window management, `.seb` file processing, and Windows OS integration (Registry).
- **Renderer Process:** Hosts the web-based examination within a strictly controlled `BrowserView` or `WebContents`.
- **Preload Scripts:** Acts as the secure bridge to inject necessary information without exposing Node.js APIs to the web content.

---

## 10. Workflow

1. User clicks on an exam link or opens a `.seb` file.
2. Windows launches FSEB (handled via `Platform/WindowsIntegration`).
3. `SebLoader` parses and de-obfuscates the configuration.
4. An `ExamSession` is instantiated.
5. The `BrowserHost` creates the secure window and enforces policies (Keyboard, Clipboard, Navigation).
6. The test URL is loaded.
7. User completes the exam and securely exits the application.

---

## 11. Tests

To run the custom TypeScript test suite:

```bash
npm test
```
This command uses `tsx` to execute the internal tests defined in the `tests/` directory (e.g., `run-all.ts`).

---

## 12. Troubleshooting

- **Protocol Handler not working:** Run `npm run register-seb` to explicitly add the `seb://` registry keys. You must run this as Administrator on Windows.
- **Build errors:** Ensure you are using a modern version of Node.js (v24) and that you have run `npm install` after pulling the latest changes.
- **Black screen on launch:** Check the console output in the terminal where you ran `npm start` to see if there are `.seb` parsing errors.

---

## 13. Security

FSEB intentionally implements restrictions:
- Standard Developer Tools are disabled.
- Downloads are blocked via `DownloadPolicy`.
- Keyboard shortcuts (e.g., Alt+Tab, Ctrl+C) are intercepted in `KeyboardPolicy`.
- *Note:* Because this is an educational project, do not deploy it for high-stakes exams without further system-level lockdown mechanisms (like kernel-level restrictions).

---

## 14. Roadmap

- [ ] Improve robust Windows OS-level kiosk mode.
- [ ] Implement macOS protocol handling (`Info.plist` modification).
- [ ] Extend unit test coverage for Plist parsing.
- [ ] Polish error screens and offline capability detection.

---

## 15. License

Licensed under the Apache-2.0 License.