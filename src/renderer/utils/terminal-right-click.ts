/**
 * What a right-click inside a terminal does (#2).
 *
 * It used to do nothing: no `contextmenu` handler existed and Electron shows
 * no default menu. On Windows it is THE terminal clipboard gesture — conhost
 * QuickEdit, Windows Terminal, PuTTY and mintty all use it — so the default
 * mirrors Windows Terminal: copy the selection if there is one, else paste.
 * That is also what wmux's own Ctrl+C already does with a selection.
 *
 * An app that turned on mouse tracking (vim `mouse=a`, tmux, htop, opencode)
 * owns the click: xterm has already sent it the right-button report on
 * mousedown, and pasting on top of that would type the clipboard into an app
 * that just acted on the click. Shift is the bypass every terminal uses, and
 * on Windows it costs nothing here: xterm's `shouldForceSelection` is
 * `shiftKey`, so with Shift held no report is sent and the gesture is ours.
 *
 * Pure, because the decision is the part worth pinning and the driver lives in
 * a hook that needs a real xterm to reach.
 */

export type RightClickMode = 'copyPaste' | 'paste' | 'off';
export type RightClickAction = 'copy' | 'paste' | 'passthrough';

export const RIGHT_CLICK_MODES: readonly RightClickMode[] = ['copyPaste', 'paste', 'off'];

export function rightClickAction(input: {
  mode: RightClickMode;
  hasSelection: boolean;
  /** isMouseTracking(surfaceMouseModes.get(surfaceId)) */
  mouseTracking: boolean;
  shiftKey: boolean;
}): RightClickAction {
  if (input.mode === 'off') return 'passthrough';
  if (input.mouseTracking && !input.shiftKey) return 'passthrough';
  if (input.mode === 'copyPaste' && input.hasSelection) return 'copy';
  return 'paste';
}

/** A persisted or config-file value that is not a known mode reads as the default. */
export function normalizeRightClickMode(value: unknown): RightClickMode {
  return (RIGHT_CLICK_MODES as readonly unknown[]).includes(value) ? (value as RightClickMode) : 'copyPaste';
}
