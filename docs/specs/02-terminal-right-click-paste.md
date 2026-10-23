# Spec 02 — Right-click to copy / paste in terminal panes

- **Issue**: SriSatyaLokesh/wmux#2
- **Area**: terminal mouse input, clipboard, Settings → Terminal
- **Status**: ready for implementation
- **Good first issue**: yes. One pure function, one listener, one setting, all reusing the existing paste pipeline.

---

## 1. Problem

Right-clicking inside a terminal pane does nothing. No `contextmenu` handler exists in `useTerminal.ts` or `TerminalPane.tsx`, and Electron shows no default menu. On Windows, which is wmux's only platform, right-click is the standard clipboard gesture: conhost (QuickEdit), Windows Terminal, PuTTY and mintty all use it. Users coming from those tools right-click and get nothing, so every paste goes through Ctrl+V or Ctrl+Shift+V.

## 2. Reproduction

1. Copy some text in any app.
2. Right-click inside a wmux terminal pane.
3. **Actual**: nothing happens.
4. **Expected**: the clipboard is pasted at the prompt. If text is selected in the pane, the selection is copied instead (Windows Terminal's default).

## 3. Design

### 3.1 Behaviour

The new pref is `terminalPrefs.rightClick: 'copyPaste' | 'paste' | 'off'`, defaulting to `'copyPaste'`.

| Situation | `copyPaste` (default) | `paste` | `off` |
|---|---|---|---|
| Selection present | copy selection, clear it | paste | nothing |
| No selection | paste | paste | nothing |
| App has mouse tracking on (vim `mouse=a`, tmux, htop, opencode…), no Shift | **pass through to the app** | pass through | pass through |
| App has mouse tracking on, **Shift** held | as the rows above | as the rows above | nothing |

Why copy-on-selection is the default rather than the draft's "always paste": it is what Windows Terminal and conhost do, and it matches wmux's own Ctrl+C, which copies when there is a selection. `'paste'` remains for users coming from GNOME Terminal or PuTTY habits.

**Mouse tracking.** When an app has enabled mouse tracking, xterm already turns the right-button `mousedown` into a mouse report to the PTY. Our handler must then do nothing, so the app gets the click and the user's clipboard is not pasted on top. **Shift** is the universal bypass. On Windows, xterm's `SelectionService.shouldForceSelection` returns true for `shiftKey` and suppresses the mouse report, so Shift+right-click reaches our handler cleanly and pastes. Do not add a second bypass mechanism. The existing signal is `isMouseTracking(surfaceMouseModes.get(surfaceId))`, the same check `useTerminal.ts` already uses for wheel forwarding.

### 3.2 Pure decision + thin driver (repo convention)

```ts
// src/renderer/utils/terminal-right-click.ts
export type RightClickMode = 'copyPaste' | 'paste' | 'off';
export type RightClickAction = 'copy' | 'paste' | 'passthrough';

export function rightClickAction(input: {
  mode: RightClickMode;
  hasSelection: boolean;
  mouseTracking: boolean;   // isMouseTracking(surfaceMouseModes.get(surfaceId))
  shiftKey: boolean;
}): RightClickAction {
  if (input.mode === 'off') return 'passthrough';
  if (input.mouseTracking && !input.shiftKey) return 'passthrough';
  if (input.mode === 'copyPaste' && input.hasSelection) return 'copy';
  return 'paste';
}
```

The driver goes in the same effect that registers the drag-and-drop listeners in `useTerminal.ts`, and is cleaned up through `cleanupFnsRef` like they are:

```ts
const onContextMenu = (ev: MouseEvent) => {
  const action = rightClickAction({
    mode: useStore.getState().terminalPrefs.rightClick,
    hasSelection: terminal.hasSelection(),
    mouseTracking: !!surfaceId && isMouseTracking(surfaceMouseModes.get(surfaceId)),
    shiftKey: ev.shiftKey,
  });
  if (action === 'passthrough') return;
  ev.preventDefault();
  ev.stopPropagation();
  if (action === 'copy') {
    // Same trimming as the Ctrl+C path (ConPTY pads lines with spaces, #102).
    const selection = trimTrailingWhitespace(terminal.getSelection());
    if (selection) navigator.clipboard.writeText(selection).catch(() => {});
    terminal.clearSelection();
    return;
  }
  finishInsertion(window.wmux.remote.resolvePaste(surfaceId ?? ''));
};
```

- **Reuse `finishInsertion` → `applyInsertion`. Never write to the PTY directly.** That pipeline is where bracketed paste (`terminal.paste`), image and file paste, ssh/scp upload for remote panes (#195), broadcast-input, the late-result-after-remount guard and the upload-failure notice all live. A right-click must mean exactly what Ctrl+V means.
- **Listen on the xterm container** (`terminalRef.current`), not the whole pane. The overlays (`PinnedPrompt`, `PromptOutline`, `NewOutputPill`, `FindBar`) and the tab bar keep their own right-click behaviour. Tab context menus already exist (#103).
- **Focus**: `applyInsertion` already calls `term.focus()`. For `copy`, call `terminal.focus()` too, so right-clicking a non-focused split makes it the active pane, consistent with a left click.
- **`contextmenu`, not `mousedown`/`auxclick`.** It fires once per gesture after the button sequence, and Chromium never turns it into a native paste, so there is no double insert. That is the trap the Ctrl+V handler's `preventDefault` guards against.

### 3.3 Settings

`src/renderer/store/settings-slice.ts` → `TerminalPrefs`:

```ts
/** Right-click in a terminal: copy the selection or paste (Windows Terminal), always paste, or nothing. */
rightClick: 'copyPaste' | 'paste' | 'off';   // default 'copyPaste'
```

This is a new field, so no migration is needed.

- `TerminalSettings.tsx`: a "Right-click" select with the hint *"In mouse-aware apps (vim, tmux), hold Shift to use the clipboard."*
- Optional: `~/.wmux/config.toml` `[terminal] right-click = "paste"`, parsed in `src/main/user-config.ts` (see `touch-pan-gain`) and applied in `applyUserConfigTerminal`.
- i18n: add the keys to `src/renderer/i18n/locales/en.ts`. Other locales fall back to English.

## 4. Edge cases

| Case | Handling |
|---|---|
| Empty clipboard | `resolvePaste` returns no text; `applyInsertion` returns early. |
| Multi-line paste in a shell with bracketed paste | `terminal.paste()` wraps it in `ESC[200~ … ESC[201~`, so nothing auto-executes. |
| Image / Explorer-copied file on the clipboard | Same as Ctrl+V: the path is typed, after an scp upload when the pane is remote. |
| Pane remounts while an scp upload runs | Already handled by `finishInsertion` using the live `xtermRef`. |
| Right-click on the scrollbar | Lands inside the container. Acceptable, and matches Windows Terminal. |
| Broadcast-input mode (#64) | Paste goes through `terminal.paste` → `onData`, so it fans out like a typed paste. |

## 5. Out of scope

- A custom terminal context menu (Copy / Paste / Select all / Find…). That would be a separate feature; `'off'` keeps the gesture free for it.
- Middle-click paste of the selection (X11 primary).
- Copy-on-select.

## 6. Acceptance criteria

- [ ] **AC-1** With no selection, right-click in a pwsh / bash / cmd pane pastes the clipboard and focuses that pane.
- [ ] **AC-2** With a selection and the default mode, right-click copies it (trailing spaces trimmed) and clears it, without pasting.
- [ ] **AC-3** Multi-line clipboard text pasted into pwsh 7 or bash with bracketed paste does not execute line by line.
- [ ] **AC-4** In `vim` with `:set mouse=a` (or tmux with `mouse on`), a bare right-click is delivered to the app and nothing is pasted.
- [ ] **AC-5** In the same app, Shift+right-click pastes the host clipboard.
- [ ] **AC-6** Mode `off` makes right-click inert. Mode `paste` pastes even with a selection. Changes apply without restart.
- [ ] **AC-7** A screenshot on the clipboard behaves exactly as Ctrl+V does, in a local pane and in an ssh pane.
- [ ] **AC-8** `npm test` and `npm run lint` pass.

## 7. Test plan

**Unit**: `tests/unit/terminal-right-click.test.ts` covers the full `rightClickAction` truth table (mode × selection × mouse tracking × Shift).

**Manual** (Windows, `npm run dev`): AC-1 to AC-7. For AC-4/5, `wsl vim` or Git Bash `vim` with `:set mouse=a`. In vim, `:echo getmousepos()` after a right-click shows the app received it.

## 8. Files touched

| File | Change |
|---|---|
| `src/renderer/utils/terminal-right-click.ts` | **new**: pure `rightClickAction` |
| `src/renderer/hooks/useTerminal.ts` | `contextmenu` listener on the xterm container |
| `src/renderer/store/settings-slice.ts` | `rightClick` + default |
| `src/renderer/components/Settings/TerminalSettings.tsx` | select + hint |
| `src/renderer/i18n/locales/en.ts` | new strings |
| `tests/unit/terminal-right-click.test.ts` | **new** |
| `src/main/user-config.ts`, `src/renderer/App.tsx` | *optional* `[terminal] right-click` |
