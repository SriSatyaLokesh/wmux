# Spec 01 — Terminal bell: local feedback on-screen, a notification only off-screen

- **Issue**: SriSatyaLokesh/wmux#1
- **Area**: terminal bell (`BEL`, `\x07`), notification chokepoint, Settings → Terminal / Notifications
- **Status**: ready for implementation
- **Related upstream**: amirlehmam/wmux#53 (introduced the bell → notification fallback), #32 / #39 (notification sound)

---

## 1. Problem

`useTerminal.ts` treats every `terminal.onBell()` as a full notification:

```ts
// src/renderer/hooks/useTerminal.ts — the bell fallback added in #53
let lastBellAt = 0;
terminal.onBell(() => {
  const now = Date.now();
  if (now - lastBellAt < 3000) return;          // 3 s per-terminal throttle
  lastBellAt = now;
  window.wmux.notification.fire({ surfaceId: ptyIdRef.current || '', text: t('terminal.bell', 'Terminal bell') });
});
```

`notification.fire` lands on the `NOTIFICATION_FIRE` handler in `src/main/ipc-handlers.ts`, which **unconditionally**:

1. shows an OS toast (`notificationManager.showToast`),
2. flashes the taskbar — only when the window is *not* focused (`NotificationManager.flashTaskbar` checks `isFocused()`),
3. sends `notification:play-sound` back to the renderer, which plays `notificationPrefs.sound` (`notification-sound.ts`).

Shells ring the bell as ordinary typing feedback: Backspace on an empty line, Left arrow at column 0, Tab with no completion, Esc in vi mode. So in the pane the user is typing in, a slip of the finger produces an OS toast plus the notification chime (at most once per 3 s). Users then set the sound to *None*, and that also silences the alerts wmux exists to deliver: a background agent waiting for input, or a long command that finished in another workspace.

### What the original draft got wrong (corrected here)

| Draft claim | Actual behaviour |
|---|---|
| The bell adds an entry to the titlebar notification drawer | It does not. Only `fireNotification` in `App.tsx` calls `addNotification`; the bell handler calls `notification.fire` directly. |
| The taskbar flashes on every bell | `flashTaskbar` already does nothing while the window is focused. |
| "OS toast (if `notificationPrefs.toast` is enabled)" | **`toast` and `taskbarFlash` are never read by main.** They are persisted to settings.json and shown in Settings → Notifications, but `NOTIFICATION_FIRE` ignores both. (`taskbarFlash` is honoured only by `useBlockedAlert` in `App.tsx`.) This is a bug in its own right and is in scope (Part B). |

## 2. Reproduction

1. Run wmux with default settings and open a PowerShell or bash pane.
2. With the cursor on an empty prompt, press Backspace.
3. **Actual**: a Windows toast reading "Terminal bell" appears and the notification chime plays.
4. **Expected**: no toast and no chime. At most a subtle local cue in the pane.

## 3. Design

### 3.1 The rule

A bell is **on-screen** when the user can see the pane it rang in:

```
onScreen = visible && document.hasFocus()
```

- `visible` is already passed to `useTerminal` by `PaneWrapper`: it is `isActiveTab && isWorkspaceActive`, so it is false for a background tab and for any pane in an inactive workspace. No store walk and no new split-tree helper is needed. Mirror it into a ref, as the hook does for its other props, so the long-lived `onBell` closure reads the current value.
- `document.hasFocus()` is false when wmux is minimised or another app is in front.

| | On-screen | Off-screen |
|---|---|---|
| Behaviour | `terminalPrefs.bellStyle`: `visual` (flash the pane), `audible` (soft local beep), or `none` | Today's full notification (toast, chime, taskbar flash when unfocused), gated by `notificationPrefs.bellNotify` |
| OS toast | never | if `notificationPrefs.toast` (Part B) |
| Notification chime | never | `notificationPrefs.sound` |

A visible pane that does **not** have keyboard focus (the other half of a split) counts as on-screen. The user can see it, and with the default `visual` style the flash on that pane is the cue. This keeps an agent ringing in the neighbouring split from being missed, without a toast.

### 3.2 Pure decision + thin driver (repo convention)

Put the decision in a pure module so it is unit-testable without xterm or a DOM, the same shape as `wheel-forward.ts`, `touch-pan.ts` and `close-guard.ts`:

```ts
// src/renderer/utils/terminal-bell.ts
export type BellStyle = 'visual' | 'audible' | 'none';
export type BellAction = 'flash' | 'beep' | 'notify' | 'ignore';

export function bellAction(input: {
  visible: boolean;          // useTerminal's `visible` prop
  windowFocused: boolean;    // document.hasFocus()
  bellStyle: BellStyle;      // terminalPrefs.bellStyle
  bellNotify: boolean;       // notificationPrefs.bellNotify
}): BellAction {
  if (input.visible && input.windowFocused) {
    return input.bellStyle === 'visual' ? 'flash' : input.bellStyle === 'audible' ? 'beep' : 'ignore';
  }
  return input.bellNotify ? 'notify' : 'ignore';
}
```

The driver in `useTerminal.ts` replaces the body of `terminal.onBell`:

- `flash`: add a `terminal-pane--bell` class to `terminalRef.current` and remove it on `animationend`, so a second bell restarts the animation.
- `beep`: play the bundled `pop.wav` at a low volume (about 0.15). Add a small exported `playBellSound()` to `notification-sound.ts` that reuses `getAudio()`. Do not add a Web Audio synthesiser or a new asset.
- `notify`: the existing `notification.fire` call, unchanged.
- Keep the 3 s throttle, but **only on `notify`**. A local flash or beep should answer every keypress, the way a real terminal's does.

### 3.3 Part B — honour `toast` / `taskbarFlash` in main

In the `NOTIFICATION_FIRE` handler in `ipc-handlers.ts`, read `loadSettings()['wmux-notification-prefs']` at fire time. This is the established pattern for `confirmAppClose`, `gpuWatchdog` and `sessionSnapshotMinutes`: the renderer's `persist()` writes settings.json synchronously, so no new IPC is needed. Skip `showToast` when `toast === false` and `flashTaskbar` when `taskbarFlash === false`. A missing key means an install that predates the feature and gets today's behaviour (both on). Keep the decision pure and tested (for example `notificationEffects(prefs) → { toast, flash }`).

This also applies to OSC 9 / 99 / 777, `wmux notify` and agent-hook notifications. That is the intended effect: it makes the existing toggles do what their labels say.

### 3.4 Settings

`src/renderer/store/settings-slice.ts`:

```ts
// TerminalPrefs
/** What a bell in a pane you can see does. Off-screen bells follow notificationPrefs.bellNotify. */
bellStyle: 'visual' | 'audible' | 'none';     // default 'visual'

// NotificationPrefs
/** A bell in a background tab / inactive workspace / unfocused window raises a notification (#53 behaviour). */
bellNotify: boolean;                          // default true
```

Both are new fields, so `{ ...DEFAULTS, ...stored }` fills them in for existing installs and no migration is needed.

- `TerminalSettings.tsx`: a "Terminal bell" select (Visual flash / Soft beep / Silent).
- `NotificationSettings.tsx`, "AI agents" section: a "Notify on terminal bell in background panes" toggle, next to `agentInputNotify` / `agentStopNotify`.
- Optional: `~/.wmux/config.toml` `[terminal] bell-style = "visual"`, parsed in `src/main/user-config.ts` (see `touch-pan-gain`) and applied in `applyUserConfigTerminal` in `App.tsx`.
- i18n: add the new keys to `src/renderer/i18n/locales/en.ts`. Other locales fall back to English. Translations are welcome but not required.

### 3.5 CSS

`src/renderer/styles/terminal.css`: a short (about 150 ms) `terminal-pane--bell` keyframe that tints the container's inset outline or background. It must not move layout: no border width, padding or flow sibling. A flow sibling resizes the box without firing the ResizeObserver, the #82 trap described in CLAUDE.md. Respect `prefers-reduced-motion` with a static tint and no animation.

## 4. Out of scope

- A separate "on-screen sound" for agent notifications (`onScreenSound` in the draft). Agent notifications already go through hooks and their own prefs. Splitting their sound is a separate proposal.
- Changing what OSC 9 / 99 / 777 or agent hooks do when on-screen.
- Per-workspace or per-pane bell settings.

## 5. Acceptance criteria

- [ ] **AC-1** In a focused, visible pane, Backspace on an empty prompt (pwsh, bash, cmd) shows no OS toast and plays no notification chime.
- [ ] **AC-2** With `bellStyle = visual` (the default), that bell flashes the pane without shifting layout. With `audible` it plays the soft beep. With `none` nothing happens.
- [ ] **AC-3** A bell in a background tab, in an inactive workspace, or while wmux is unfocused still raises the notification (toast, chime, taskbar flash when unfocused), exactly as today.
- [ ] **AC-4** With `bellNotify = false`, off-screen bells raise nothing. Agent hooks and OSC notifications are unaffected.
- [ ] **AC-5** Setting `notificationPrefs.sound = none` does not change on-screen bell feedback, and `bellStyle = none` does not silence off-screen alerts.
- [ ] **AC-6** (Part B) Turning off *Show toast notifications* stops every wmux toast. Turning off *Taskbar flash* stops the flash on `NOTIFICATION_FIRE`.
- [ ] **AC-7** `npm test` and `npm run lint` pass.

## 6. Test plan

**Unit** (Vitest, `tests/unit/`):

- `terminal-bell.test.ts`: the full `bellAction` truth table (visible × windowFocused × bellStyle × bellNotify).
- `notification-effects.test.ts`: the main-side pref gate, including missing or corrupt keys falling back to "on".

**Manual** (Windows, `npm run dev`):

1. Backspace on an empty prompt in pwsh, bash and cmd, under each `bellStyle`.
2. `Start-Sleep 5; [char]7` (or `sleep 5; printf '\a'`) in a pane, then switch workspace, switch tab, or alt-tab away before it fires. The notification should appear.
3. Toggle *Show toast notifications* off and run `wmux notify hi`. No toast should appear.

## 7. Files touched

| File | Change |
|---|---|
| `src/renderer/utils/terminal-bell.ts` | **new**: pure `bellAction` |
| `src/renderer/hooks/useTerminal.ts` | `visible` ref, new `onBell` driver |
| `src/renderer/notification-sound.ts` | `playBellSound()` |
| `src/renderer/store/settings-slice.ts` | `bellStyle`, `bellNotify` + defaults |
| `src/renderer/components/Settings/TerminalSettings.tsx` | bell style select |
| `src/renderer/components/Settings/NotificationSettings.tsx` | background-bell toggle |
| `src/renderer/styles/terminal.css` | `terminal-pane--bell` animation |
| `src/main/ipc-handlers.ts` (+ small pure helper) | honour `toast` / `taskbarFlash` |
| `src/renderer/i18n/locales/en.ts` | new strings |
| `tests/unit/terminal-bell.test.ts`, `tests/unit/notification-effects.test.ts` | **new** |
