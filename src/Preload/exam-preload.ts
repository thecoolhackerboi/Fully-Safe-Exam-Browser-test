import { contextBridge, webFrame } from 'electron';

// Expose SafeExamBrowser object expected by assessment platforms (CodeChef, Moodle, etc.)
try {
  contextBridge.exposeInMainWorld('SafeExamBrowser', {
    version: 'SEB_Windows_3.10.2',
    platform: 'Windows',
  });
} catch (err) {
  try {
    (window as unknown as { SafeExamBrowser: unknown }).SafeExamBrowser = {
      version: 'SEB_Windows_3.10.2',
      platform: 'Windows',
    };
  } catch {
    // Ignored
  }
}

// ─── DOM-level clipboard & text selection liberation ───────────────────────────
// Many exam platforms (CodeChef, HackerRank, Moodle) block copy/paste/cut/selection
// by attaching event listeners that call event.preventDefault() and event.stopPropagation().
// We wrap addEventListener BEFORE page scripts run to neutralise preventDefault
// for anti-cheat blockers, while preserving editor-internal handlers to prevent double pasting.
function isEditorElement(target: EventTarget | null, currentTarget: EventTarget | null): boolean {
  const el = (currentTarget || target) as (HTMLElement | null);
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'textarea' || tag === 'input') return true;
  if (el.isContentEditable) return true;
  if (typeof el.closest === 'function') {
    if (el.closest('.monaco-editor, .ace_editor, .CodeMirror, [contenteditable="true"], textarea, input')) {
      return true;
    }
  }
  return false;
}

try {
  const _addEL = EventTarget.prototype.addEventListener;
  const CLIPBOARD_EVENTS = new Set(['copy', 'cut', 'paste', 'contextmenu', 'selectstart', 'mousedown', 'mouseup']);
  const CLIPBOARD_KEYS = new Set(['c', 'v', 'x', 'a', 'z', 'y', 'insert']);

  EventTarget.prototype.addEventListener = function (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ) {
    const isClipboardEvent = CLIPBOARD_EVENTS.has(type);
    const isKeyEvent = type === 'keydown' || type === 'keyup';

    if (isClipboardEvent || isKeyEvent) {
      const wrappedListener = function (this: EventTarget, evt: Event) {
        const isEditor = isEditorElement(evt ? evt.target : null, this);
        let shouldNeutralize = isClipboardEvent;

        // Inside a code editor or text input, do NOT neutralize preventDefault on paste/copy
        // because the editor (Monaco/Ace) calls preventDefault() so the browser doesn't double-paste!
        if (isClipboardEvent && isEditor && (type === 'paste' || type === 'copy' || type === 'cut')) {
          shouldNeutralize = false;
        }

        if (isKeyEvent && evt instanceof KeyboardEvent) {
          const keyLower = (evt.key || '').toLowerCase();
          const hasModifier = evt.ctrlKey || evt.metaKey || evt.altKey;
          if (hasModifier && (CLIPBOARD_KEYS.has(keyLower) || keyLower === 'alt')) {
            shouldNeutralize = !isEditor;
          }
        }

        if (shouldNeutralize) {
          const origPreventDefault = evt.preventDefault.bind(evt);
          const origStopPropagation = evt.stopPropagation.bind(evt);
          const origStopImmediate = evt.stopImmediatePropagation.bind(evt);

          evt.preventDefault = () => { /* neutralised by FSEB clipboard policy */ };
          evt.stopPropagation = () => { /* neutralised by FSEB clipboard policy */ };
          evt.stopImmediatePropagation = () => { /* neutralised by FSEB clipboard policy */ };

          try {
            if (typeof listener === 'function') {
              listener.call(this, evt);
            } else if (listener && typeof (listener as EventListenerObject).handleEvent === 'function') {
              (listener as EventListenerObject).handleEvent(evt);
            }
          } catch {
            // Ignore listener errors
          }

          evt.preventDefault = origPreventDefault;
          evt.stopPropagation = origStopPropagation;
          evt.stopImmediatePropagation = origStopImmediate;
          return;
        }

        if (typeof listener === 'function') {
          return listener.call(this, evt);
        } else if (listener && typeof (listener as EventListenerObject).handleEvent === 'function') {
          return (listener as EventListenerObject).handleEvent(evt);
        }
      };

      return _addEL.call(this, type, wrappedListener as EventListener, options);
    }

    return _addEL.call(this, type, listener, options);
  };
} catch {
  // Ignored
}

// ─── Neutralise inline property setters (e.g. document.oncopy = ...) ──────────
try {
  const INLINE_HANDLERS = ['oncopy', 'oncut', 'onpaste', 'oncontextmenu', 'onselectstart'] as const;
  for (const prop of INLINE_HANDLERS) {
    const descriptor = {
      get() { return null; },
      set(_v: unknown) { /* blocked by FSEB clipboard policy */ },
      configurable: true,
    };
    Object.defineProperty(HTMLElement.prototype, prop, descriptor);
    Object.defineProperty(Document.prototype, prop, descriptor);
  }
} catch {
  // Ignored
}

// Ensure copying selected text outside of code editors always succeeds in isolated world
try {
  window.addEventListener(
    'copy',
    (e: ClipboardEvent) => {
      if (isEditorElement(e.target, null)) {
        return;
      }
      const sel = window.getSelection ? window.getSelection()?.toString() : '';
      if (sel && e.clipboardData) {
        try {
          e.clipboardData.setData('text/plain', sel);
          e.preventDefault();
        } catch {}
      }
    },
    true
  );
} catch {
  // Ignored
}

// ─── Inject main-world clipboard and text editor liberation ───────────────────
// Injects into the main world so Monaco Editor, textareas, problem descriptions,
// and custom exam elements allow selection, copy, cut, and paste freely.
try {
  const scriptContent = `
(function() {
  'use strict';

  // 1. Force text selectable everywhere (in editor, problem description, tasks, etc.)
  // and hide any "Ask AI" / "Chef AI" buttons on exam platforms without mutating React DOM trees
  var style = document.createElement('style');
  style.id = 'fseb-clipboard-styles';
  style.textContent = [
    '*, *::before, *::after { -webkit-user-select: text !important; user-select: text !important; -moz-user-select: text !important; -ms-user-select: text !important; }',
    'button[id*="ask-ai" i], button[class*="ask-ai" i],',
    'button[id*="chef-ai" i], button[class*="chef-ai" i],',
    'button[id*="askAi" i], button[class*="askAi" i],',
    'button[data-testid*="ask-ai" i], button[data-testid*="chef-ai" i],',
    '[aria-label*="Ask AI" i], [aria-label*="Chef AI" i],',
    '[title*="Ask AI" i], [title*="Chef AI" i],',
    '[id*="ask-ai" i], [id*="chef-ai" i], [class*="ask-ai" i], [class*="chef-ai" i],',
    '[id*="askAi" i], [class*="askAi" i], [id*="chefAi" i], [class*="chefAi" i],',
    '.ask-ai, .chef-ai, #dock-btn-ai, .seb-taskbar-ai-btn, #seb-ai-drawer, .seb-ai-drawer {',
    '  display: none !important;',
    '  visibility: hidden !important;',
    '  pointer-events: none !important;',
    '  opacity: 0 !important;',
    '  width: 0 !important;',
    '  height: 0 !important;',
    '  margin: 0 !important;',
    '  padding: 0 !important;',
    '  border: 0 !important;',
    '  overflow: hidden !important;',
    '}'
  ].join('\n');

  function hideElementSafely(el) {
    if (!el || !el.style) return;
    el.style.setProperty('display', 'none', 'important');
    el.style.setProperty('visibility', 'hidden', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
    el.style.setProperty('opacity', '0', 'important');
    el.style.setProperty('width', '0', 'important');
    el.style.setProperty('height', '0', 'important');
    el.style.setProperty('margin', '0', 'important');
    el.style.setProperty('padding', '0', 'important');
    el.style.setProperty('border', '0', 'important');
    el.style.setProperty('overflow', 'hidden', 'important');
  }

  function isAskAiLabel(text) {
    if (!text) return false;
    var normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized || normalized.length > 28) return false;
    var stripped = normalized.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '').trim();
    return /^(ask\s*ai|chef\s*ai|ask\s*chef\s*ai|ai\s*assistant)$/i.test(stripped);
  }

  function removeAskAiElements() {
    try {
      var candidates = document.querySelectorAll(
        'button, a, [role="button"], [class*="btn" i], [class*="button" i], footer button, footer a, footer div, [class*="footer" i] button, [class*="footer" i] div'
      );
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        if (el.children && el.children.length > 4) continue;
        var txt = (el.innerText || el.textContent || '').trim();
        if (isAskAiLabel(txt)) {
          hideElementSafely(el);
          var parentBtn = el.closest && el.closest('button, a, [role="button"]');
          if (parentBtn && isAskAiLabel(parentBtn.innerText || parentBtn.textContent || '')) {
            hideElementSafely(parentBtn);
          }
        }
      }
    } catch (e) {}
  }

  // Hook into Monaco Editor to fix cascading indentation & gaps on paste
  function configureMonacoEditor(ed) {
    if (!ed || typeof ed.updateOptions !== 'function') return;
    try {
      ed.updateOptions({
        autoIndent: 'keep',      // Keeps original code indentation without compounding
        formatOnPaste: false,    // Disables conflicting auto-formatting on paste
        trimAutoWhitespace: true,
      });
    } catch (e) {}
  }

  function scanAndPatchMonaco() {
    try {
      if (window.monaco && window.monaco.editor) {
        if (typeof window.monaco.editor.onDidCreateEditor === 'function' && !window.monaco.__fsebHooked) {
          window.monaco.__fsebHooked = true;
          window.monaco.editor.onDidCreateEditor(function(editor) {
            configureMonacoEditor(editor);
          });
        }
        if (typeof window.monaco.editor.getEditors === 'function') {
          window.monaco.editor.getEditors().forEach(configureMonacoEditor);
        }
      }
    } catch (e) {}
  }

  function injectStyle() {
    if (document.head && !document.getElementById('fseb-clipboard-styles')) {
      document.head.appendChild(style);
    } else if (document.documentElement && !document.getElementById('fseb-clipboard-styles')) {
      document.documentElement.appendChild(style);
    }
    removeAskAiElements();
    scanAndPatchMonaco();
  }

  injectStyle();
  document.addEventListener('DOMContentLoaded', function() {
    injectStyle();
    removeAskAiElements();
    scanAndPatchMonaco();
  });

  var obs = new MutationObserver(function() {
    if (!document.getElementById('fseb-clipboard-styles')) {
      injectStyle();
    }
    removeAskAiElements();
    scanAndPatchMonaco();
  });
  if (document.documentElement) {
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  // Periodic check for async loaded Monaco Editor instances (AMD/Webpack loaded)
  var monacoPollCount = 0;
  var monacoPollInterval = setInterval(function() {
    scanAndPatchMonaco();
    removeAskAiElements();
    monacoPollCount++;
    if (monacoPollCount > 60) clearInterval(monacoPollInterval);
  }, 1000);

  // 2. Ensure document.execCommand always succeeds for clipboard operations
  var origExecCommand = document.execCommand.bind(document);
  document.execCommand = function(cmd) {
    var lowerCmd = (cmd || '').toLowerCase();
    if (['copy', 'cut', 'paste', 'selectall', 'inserttext', 'delete', 'undo', 'redo'].indexOf(lowerCmd) !== -1) {
      try {
        return origExecCommand.apply(document, arguments);
      } catch (e) {
        return true;
      }
    }
    return origExecCommand.apply(document, arguments);
  };

  // 3. Ensure navigator.clipboard methods and DataTransfer.getData normalize newlines
  // This eliminates the empty line gaps and broken cascading indentation when pasting
  function normalizeNewlines(text) {
    if (typeof text !== 'string') return text;
    return text.replace(/\r\r\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  if (typeof DataTransfer !== 'undefined' && DataTransfer.prototype && DataTransfer.prototype.getData) {
    try {
      var origGetData = DataTransfer.prototype.getData;
      DataTransfer.prototype.getData = function(format) {
        var data = origGetData.apply(this, arguments);
        if (typeof data === 'string' && (format === 'text/plain' || format === 'text' || !format)) {
          return normalizeNewlines(data);
        }
        return data;
      };
    } catch (e) {}
  }

  if (navigator.clipboard) {
    var origReadText = navigator.clipboard.readText ? navigator.clipboard.readText.bind(navigator.clipboard) : null;
    var origWriteText = navigator.clipboard.writeText ? navigator.clipboard.writeText.bind(navigator.clipboard) : null;

    if (origReadText) {
      try {
        var normalizedReadText = function() {
          return origReadText().then(function(text) {
            return normalizeNewlines(text);
          });
        };
        Object.defineProperty(navigator.clipboard, 'readText', {
          value: normalizedReadText,
          writable: false,
          configurable: true,
        });
      } catch (e) {}
    }

    if (origWriteText) {
      try {
        Object.defineProperty(navigator.clipboard, 'writeText', {
          value: origWriteText,
          writable: false,
          configurable: true,
        });
      } catch (e) {}
    }
  }

  function isEditorTarget(target, currentTarget) {
    var el = currentTarget || target;
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input') return true;
    if (el.isContentEditable) return true;
    if (typeof el.closest === 'function') {
      if (el.closest('.monaco-editor, .ace_editor, .CodeMirror, [contenteditable="true"], textarea, input')) {
        return true;
      }
    }
    return false;
  }

  // 4. Intercept addEventListener in the main page world
  var _mainAddEL = EventTarget.prototype.addEventListener;
  var BLOCKED_TYPES = { copy: 1, cut: 1, paste: 1, contextmenu: 1, selectstart: 1 };
  var CLIP_KEYS = { c: 1, v: 1, x: 1, a: 1, z: 1, y: 1, insert: 1, alt: 1 };

  EventTarget.prototype.addEventListener = function(type, listener, opts) {
    var isClip = BLOCKED_TYPES[type];
    var isKey = (type === 'keydown' || type === 'keyup');

    if (isClip || isKey) {
      var wrapped = function(evt) {
        var isEditor = isEditorTarget(evt ? evt.target : null, this);
        var neutralize = isClip;

        // Inside a code editor or text input, the editor's own paste handler
        // calls preventDefault() so Chromium does not perform a duplicate paste!
        // We must preserve preventDefault inside editors to prevent double-pasting.
        if (isClip && isEditor && (type === 'paste' || type === 'copy' || type === 'cut')) {
          neutralize = false;
        }

        if (isKey && evt) {
          var k = (evt.key || '').toLowerCase();
          var mod = evt.ctrlKey || evt.metaKey || evt.altKey;
          if (mod && CLIP_KEYS[k]) {
            neutralize = !isEditor;
          }
        }

        if (neutralize) {
          var origPD = evt.preventDefault;
          var origSP = evt.stopPropagation;
          var origSIP = evt.stopImmediatePropagation;
          evt.preventDefault = function() {};
          evt.stopPropagation = function() {};
          evt.stopImmediatePropagation = function() {};

          try {
            if (typeof listener === 'function') {
              listener.call(this, evt);
            } else if (listener && listener.handleEvent) {
              listener.handleEvent(evt);
            }
          } catch (e) {}

          evt.preventDefault = origPD;
          evt.stopPropagation = origSP;
          evt.stopImmediatePropagation = origSIP;
          return;
        }

        if (typeof listener === 'function') {
          return listener.call(this, evt);
        } else if (listener && listener.handleEvent) {
          return listener.handleEvent(evt);
        }
      };

      return _mainAddEL.call(this, type, wrapped, opts);
    }

    return _mainAddEL.call(this, type, listener, opts);
  };

  // 5. Neutralise inline handlers in the main world
  ['oncopy', 'oncut', 'onpaste', 'oncontextmenu', 'onselectstart'].forEach(function(prop) {
    try {
      Object.defineProperty(HTMLElement.prototype, prop, {
        get: function() { return null; },
        set: function() {},
        configurable: true,
      });
      Object.defineProperty(Document.prototype, prop, {
        get: function() { return null; },
        set: function() {},
        configurable: true,
      });
    } catch (e) {}
  });

  // 6. Ensure getSelection always returns a valid selection object
  var _origGetSelection = window.getSelection;
  window.getSelection = function() {
    var sel = _origGetSelection.call(window);
    return sel || { toString: function() { return ''; }, rangeCount: 0 };
  };

  // 7. Ensure copying selected text outside of code editors (e.g. problem statement on left side) always succeeds
  window.addEventListener('copy', function(e) {
    if (isEditorTarget(e.target, null)) {
      return; // Monaco Editor and text inputs handle their own copy
    }
    var sel = '';
    try {
      if (window.getSelection) {
        sel = window.getSelection().toString();
      }
    } catch (err) {}
    if (sel && e.clipboardData) {
      try {
        e.clipboardData.setData('text/plain', sel);
        e.preventDefault(); // Commits the selected text directly to the system clipboard
      } catch (err) {}
    }
  }, true); // Capture phase captures selection before any anti-cheat script

  // Ensure text selection on problem description is not blocked by anti-cheat scripts
  window.addEventListener('selectstart', function(e) {
    if (!isEditorTarget(e.target, null)) {
      // Allow default text selection
    }
  }, true);

})();
`;

  try {
    void webFrame.executeJavaScript(scriptContent);
  } catch {
    // Fallback to DOM script injection below
  }

  const scriptEl = document.createElement('script');
  scriptEl.textContent = scriptContent;

  if (document.documentElement) {
    document.documentElement.prepend(scriptEl);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.prepend(scriptEl);
    });
  }
} catch {
  // Ignored
}
