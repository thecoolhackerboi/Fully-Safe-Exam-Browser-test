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
git clone https://github.com/GARVITAMITBHUTANI/Fully-Safe-Exam-Browser.git
cd FSEB
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

## 6. Test Website (CodeChef integration)

FSEB currently supports `.seb` configurations used by platforms like CodeChef. Because protocol handlers (`seb://`) are registered (via the `npm run register-seb` script or automatically on package installation), you can simulate launching an exam directly from an assessment website. 
Loading a CodeChef `.seb` file will successfully trigger the exam session, decompress the file, and launch the configured URL.

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