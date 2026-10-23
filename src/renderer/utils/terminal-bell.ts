/**
 * What a terminal bell (BEL, `\x07`) does (#1).
 *
 * Since amirlehmam/wmux#53 every bell raised a full notification — OS toast,
 * chime, taskbar flash — because in-pane agents ring it when they wait on a
 * human. But shells ring it as TYPING feedback: Backspace on an empty line,
 * Left at column 0, Tab with no completion. In the pane being typed in, that
 * made a slip of the finger pop a toast and play the chime, and the usual
 * answer was to set the sound to None, which also silenced the alerts the
 * notification exists for.
 *
 * So the bell is split by whether the user can SEE the pane: on-screen it is
 * local feedback only (the `bellStyle` pref), off-screen it is the #53
 * notification (gated by `bellNotify`). `visible` is the prop PaneWrapper
 * already computes — active tab AND active workspace — so a background tab and
 * an inactive workspace are both off-screen; `windowFocused` covers wmux being
 * minimised or behind another app. A visible pane WITHOUT keyboard focus (the
 * other half of a split) counts as on-screen on purpose: the user can see it,
 * and the default visual flash is the cue an agent ringing there needs.
 *
 * Pure, because the interesting part is the decision and the driver lives in
 * a hook that needs a real xterm to reach.
 */

export type BellStyle = 'visual' | 'audible' | 'none';
export type BellAction = 'flash' | 'beep' | 'notify' | 'ignore';

export const BELL_STYLES: readonly BellStyle[] = ['visual', 'audible', 'none'];

export function bellAction(input: {
  visible: boolean;
  windowFocused: boolean;
  bellStyle: BellStyle;
  bellNotify: boolean;
}): BellAction {
  if (input.visible && input.windowFocused) {
    if (input.bellStyle === 'visual') return 'flash';
    if (input.bellStyle === 'audible') return 'beep';
    return 'ignore';
  }
  return input.bellNotify ? 'notify' : 'ignore';
}

/** A persisted or config-file value that is not a known style reads as the default. */
export function normalizeBellStyle(value: unknown): BellStyle {
  return (BELL_STYLES as readonly unknown[]).includes(value) ? (value as BellStyle) : 'visual';
}
