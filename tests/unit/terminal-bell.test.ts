import { describe, it, expect } from 'vitest';
import { bellAction, normalizeBellStyle, type BellStyle } from '../../src/renderer/utils/terminal-bell';
import { DEFAULT_NOTIFICATION_PREFS, DEFAULT_TERMINAL_PREFS } from '../../src/renderer/store/settings-slice';

// Issue #1. A bell in the pane being typed in (Backspace on an empty prompt)
// popped an OS toast and played the notification chime. The split: on-screen
// bells are local feedback only, off-screen bells keep the #53 notification.

const at = (o: Partial<Parameters<typeof bellAction>[0]> = {}) => bellAction({
  visible: true,
  windowFocused: true,
  bellStyle: 'visual',
  bellNotify: true,
  ...o,
});

describe('bellAction', () => {
  describe('on-screen (visible pane, focused window) never notifies', () => {
    const cases: Array<[BellStyle, string]> = [['visual', 'flash'], ['audible', 'beep'], ['none', 'ignore']];
    for (const [bellStyle, expected] of cases) {
      it(`bellStyle ${bellStyle} → ${expected}`, () => {
        expect(at({ bellStyle })).toBe(expected);
        // bellNotify is about OFF-screen bells and must not leak in here.
        expect(at({ bellStyle, bellNotify: false })).toBe(expected);
      });
    }
  });

  describe('off-screen notifies, whatever the on-screen style', () => {
    const offScreen = [
      { name: 'background tab / inactive workspace', visible: false, windowFocused: true },
      { name: 'wmux unfocused or minimised', visible: true, windowFocused: false },
      { name: 'both', visible: false, windowFocused: false },
    ];
    for (const c of offScreen) {
      for (const bellStyle of ['visual', 'audible', 'none'] as BellStyle[]) {
        it(`${c.name}, bellStyle ${bellStyle}`, () => {
          expect(at({ ...c, bellStyle })).toBe('notify');
          expect(at({ ...c, bellStyle, bellNotify: false })).toBe('ignore');
        });
      }
    }
  });

  it('defaults: an on-screen bell flashes, an off-screen one notifies', () => {
    const defaults = {
      bellStyle: DEFAULT_TERMINAL_PREFS.bellStyle,
      bellNotify: DEFAULT_NOTIFICATION_PREFS.bellNotify,
    };
    expect(bellAction({ ...defaults, visible: true, windowFocused: true })).toBe('flash');
    expect(bellAction({ ...defaults, visible: false, windowFocused: true })).toBe('notify');
  });
});

describe('normalizeBellStyle', () => {
  it('keeps a known style', () => {
    expect(normalizeBellStyle('audible')).toBe('audible');
    expect(normalizeBellStyle('none')).toBe('none');
  });

  it('reads anything else as the default', () => {
    for (const v of [undefined, null, '', 'loud', 1, {}]) expect(normalizeBellStyle(v)).toBe('visual');
  });
});
