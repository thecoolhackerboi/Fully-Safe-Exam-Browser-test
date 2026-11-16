import { KeyboardPolicy } from '../src/Security/KeyboardPolicy';
import { ClipboardPolicy } from '../src/Security/ClipboardPolicy';
import { DownloadPolicy } from '../src/Security/DownloadPolicy';
import { DeveloperToolsPolicy } from '../src/Security/DeveloperToolsPolicy';
import { DEFAULT_EXAM_CONFIGURATION } from '../src/Configuration/ExamConfiguration';

export function runPoliciesTests() {
  console.log('\n--- Running Security & Policies Tests ---');

  const config = { ...DEFAULT_EXAM_CONFIGURATION };
  const keyboardPolicy = new KeyboardPolicy(config);
  const clipboardPolicy = new ClipboardPolicy(config);
  const downloadPolicy = new DownloadPolicy(config);
  const devToolsPolicy = new DeveloperToolsPolicy(config);

  // 1. Keyboard tests: Student allowed operations
  const copyEvent = { type: 'keyDown', key: 'c', control: true };
  const copyDecision = keyboardPolicy.evaluateKeyEvent(copyEvent);
  console.assert(copyDecision.allowed === true, 'Test 1.1 Failed: Ctrl+C must be allowed');

  const pasteEvent = { type: 'keyDown', key: 'v', control: true };
  const pasteDecision = keyboardPolicy.evaluateKeyEvent(pasteEvent);
  console.assert(pasteDecision.allowed === true, 'Test 1.2 Failed: Ctrl+V must be allowed');

  const selectAllEvent = { type: 'keyDown', key: 'a', control: true };
  const selectAllDecision = keyboardPolicy.evaluateKeyEvent(selectAllEvent);
  console.assert(selectAllDecision.allowed === true, 'Test 1.3 Failed: Ctrl+A must be allowed');

  const typingEvent = { type: 'keyDown', key: 'm' };
  const typingDecision = keyboardPolicy.evaluateKeyEvent(typingEvent);
  console.assert(typingDecision.allowed === true, 'Test 1.4 Failed: Regular typing must be allowed');

  const altTabEvent = { type: 'keyDown', key: 'tab', alt: true };
  const altTabDecision = keyboardPolicy.evaluateKeyEvent(altTabEvent);
  console.assert(altTabDecision.allowed === true, 'Test 1.5 Failed: Alt+Tab window switching must be allowed');

  const winTabEvent = { type: 'keyDown', key: 'tab', meta: true };
  const winTabDecision = keyboardPolicy.evaluateKeyEvent(winTabEvent);
  console.assert(winTabDecision.allowed === true, 'Test 1.6 Failed: Win+Tab task view must be allowed');

  const virtualDesktopLeftEvent = { type: 'keyDown', key: 'arrowleft', control: true, meta: true };
  const virtualDesktopLeftDecision = keyboardPolicy.evaluateKeyEvent(virtualDesktopLeftEvent);
  console.assert(virtualDesktopLeftDecision.allowed === true, 'Test 1.7 Failed: Ctrl+Win+ArrowLeft virtual desktop switch must be allowed');

  const virtualDesktopRightEvent = { type: 'keyDown', key: 'arrowright', control: true, meta: true };
  const virtualDesktopRightDecision = keyboardPolicy.evaluateKeyEvent(virtualDesktopRightEvent);
  console.assert(virtualDesktopRightDecision.allowed === true, 'Test 1.8 Failed: Ctrl+Win+ArrowRight virtual desktop switch must be allowed');
  console.log('✔ Test 1: Permitted student editing, window-switching, and virtual desktop shortcuts work');

  // 2. Keyboard tests: Blocked escape shortcuts
  const f12Event = { type: 'keyDown', key: 'f12' };
  const f12Decision = keyboardPolicy.evaluateKeyEvent(f12Event);
  console.assert(f12Decision.allowed === false, 'Test 2.1 Failed: F12 must be blocked');
  console.assert(f12Decision.reason?.includes('Developer tools'), 'Test 2.1b Failed: Reason must be given');

  const devToolsInspectEvent = { type: 'keyDown', key: 'i', control: true, shift: true };
  const devToolsDecision = keyboardPolicy.evaluateKeyEvent(devToolsInspectEvent);
  console.assert(devToolsDecision.allowed === false, 'Test 2.2 Failed: Ctrl+Shift+I must be blocked');

  const viewSourceEvent = { type: 'keyDown', key: 'u', control: true };
  const viewSourceDecision = keyboardPolicy.evaluateKeyEvent(viewSourceEvent);
  console.assert(viewSourceDecision.allowed === false, 'Test 2.3 Failed: Ctrl+U must be blocked');

  const printEvent = { type: 'keyDown', key: 'p', control: true };
  const printDecision = keyboardPolicy.evaluateKeyEvent(printEvent);
  console.assert(printDecision.allowed === false, 'Test 2.4 Failed: Ctrl+P must be blocked');

  const saveEvent = { type: 'keyDown', key: 's', control: true };
  const saveDecision = keyboardPolicy.evaluateKeyEvent(saveEvent);
  console.assert(saveDecision.allowed === false, 'Test 2.5 Failed: Ctrl+S must be blocked');

  const newTabEvent = { type: 'keyDown', key: 't', control: true };
  const newTabDecision = keyboardPolicy.evaluateKeyEvent(newTabEvent);
  console.assert(newTabDecision.allowed === false, 'Test 2.6 Failed: Ctrl+T must be blocked');

  const addressBarEvent = { type: 'keyDown', key: 'l', control: true };
  const addressBarDecision = keyboardPolicy.evaluateKeyEvent(addressBarEvent);
  console.assert(addressBarDecision.allowed === false, 'Test 2.7 Failed: Ctrl+L must be blocked');
  console.log('✔ Test 2: Prohibited browser escape shortcuts and DevTools keys blocked with reason');

  // 3. Clipboard Policy checks
  console.assert(clipboardPolicy.canCopy() === true, 'Test 3.1 Failed: Clipboard canCopy must be true');
  console.assert(clipboardPolicy.canPaste() === true, 'Test 3.2 Failed: Clipboard canPaste must be true');
  console.assert(clipboardPolicy.canSelectAll() === true, 'Test 3.3 Failed: Clipboard canSelectAll must be true');
  console.log('✔ Test 3: Central ClipboardPolicy allows authorized operations');

  // 4. Download Policy checks
  const downloadBlocked = downloadPolicy.evaluateDownload('https://example.edu/file.pdf', 'file.pdf');
  console.assert(downloadBlocked.allowed === false, 'Test 4.1 Failed: Downloads blocked by default');

  downloadPolicy.updateConfiguration({ ...config, downloads: true });
  const downloadAllowed = downloadPolicy.evaluateDownload('https://example.edu/file.pdf', 'file.pdf');
  console.assert(downloadAllowed.allowed === true, 'Test 4.2 Failed: Downloads allowed when configured');
  console.log('✔ Test 4: DownloadPolicy correctly blocks or allows downloads based on configuration');

  // 5. DeveloperTools Policy check
  console.assert(devToolsPolicy.canOpenDevTools() === false, 'Test 5.1 Failed: DevTools disabled by default');
  console.log('✔ Test 5: DeveloperToolsPolicy disables DevTools by default');

  // 6. Stale State (Strict Lockdown) checks
  keyboardPolicy.setStaleState(true);
  console.assert(keyboardPolicy.isStaleState() === true, 'Test 6.1 Failed: staleState must be true');

  const staleAltTab = keyboardPolicy.evaluateKeyEvent({ type: 'keyDown', key: 'tab', alt: true });
  console.assert(staleAltTab.allowed === false, 'Test 6.2 Failed: Alt+Tab must be blocked in Stale State');

  const staleWinTab = keyboardPolicy.evaluateKeyEvent({ type: 'keyDown', key: 'tab', meta: true });
  console.assert(staleWinTab.allowed === false, 'Test 6.3 Failed: Win+Tab must be blocked in Stale State');

  const staleVirtualDesktop = keyboardPolicy.evaluateKeyEvent({ type: 'keyDown', key: 'arrowleft', control: true, meta: true });
  console.assert(staleVirtualDesktop.allowed === false, 'Test 6.4 Failed: Virtual desktop must be blocked in Stale State');

  const staleAltEsc = keyboardPolicy.evaluateKeyEvent({ type: 'keyDown', key: 'escape', alt: true });
  console.assert(staleAltEsc.allowed === false, 'Test 6.5 Failed: Alt+Esc must be blocked in Stale State');

  const staleF11 = keyboardPolicy.evaluateKeyEvent({ type: 'keyDown', key: 'f11' });
  console.assert(staleF11.allowed === false, 'Test 6.6 Failed: F11 must be blocked in Stale State');

  // Student clipboard operations must be blocked in Stale State
  const staleCopy = keyboardPolicy.evaluateKeyEvent({ type: 'keyDown', key: 'c', control: true });
  console.assert(staleCopy.allowed === false, 'Test 6.7 Failed: Ctrl+C must be blocked in Stale State');
  const stalePaste = keyboardPolicy.evaluateKeyEvent({ type: 'keyDown', key: 'v', control: true });
  console.assert(stalePaste.allowed === false, 'Test 6.8 Failed: Ctrl+V must be blocked in Stale State');

  // Reverting Stale State to false
  keyboardPolicy.setStaleState(false);
  console.assert(keyboardPolicy.isStaleState() === false, 'Test 6.9 Failed: staleState must be false');
  const restoredAltTab = keyboardPolicy.evaluateKeyEvent({ type: 'keyDown', key: 'tab', alt: true });
  console.assert(restoredAltTab.allowed === true, 'Test 6.10 Failed: Alt+Tab must be allowed when Stale State is off');
  const restoredCopy = keyboardPolicy.evaluateKeyEvent({ type: 'keyDown', key: 'c', control: true });
  console.assert(restoredCopy.allowed === true, 'Test 6.11 Failed: Ctrl+C must be re-enabled when Stale State is off');
  const restoredPaste = keyboardPolicy.evaluateKeyEvent({ type: 'keyDown', key: 'v', control: true });
  console.assert(restoredPaste.allowed === true, 'Test 6.12 Failed: Ctrl+V must be re-enabled when Stale State is off');
  console.log('✔ Test 6: Stale State toggles strict lockdown (Alt+Tab, Win+Tab, virtual desktops) and restores cleanly');
}

