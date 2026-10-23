import { describe, it, expect } from 'vitest';
import {
  normalizeRightClickMode,
  rightClickAction,
  type RightClickMode,
} from '../../src/renderer/utils/terminal-right-click';
import { DEFAULT_TERMINAL_PREFS } from '../../src/renderer/store/settings-slice';

// Issue #2. Right-click in a terminal did nothing. The default mirrors Windows
// Terminal; a mouse-tracking app keeps the click unless Shift is held.

const at = (o: Partial<Parameters<typeof rightClickAction>[0]> = {}) => rightClickAction({
  mode: 'copyPaste',
  hasSelection: false,
  mouseTracking: false,
  shiftKey: false,
  ...o,
});

describe('rightClickAction', () => {
  it('copyPaste: copies a selection, otherwise pastes', () => {
    expect(at({ hasSelection: true })).toBe('copy');
    expect(at({ hasSelection: false })).toBe('paste');
  });

  it('paste: pastes even over a selection', () => {
    expect(at({ mode: 'paste', hasSelection: true })).toBe('paste');
    expect(at({ mode: 'paste' })).toBe('paste');
  });

  it('off: never acts, Shift or not', () => {
    for (const hasSelection of [false, true]) {
      for (const mouseTracking of [false, true]) {
        for (const shiftKey of [false, true]) {
          expect(at({ mode: 'off', hasSelection, mouseTracking, shiftKey })).toBe('passthrough');
        }
      }
    }
  });

  describe('a mouse-tracking app', () => {
    for (const mode of ['copyPaste', 'paste'] as RightClickMode[]) {
      it(`${mode}: a bare click goes to the app`, () => {
        expect(at({ mode, mouseTracking: true })).toBe('passthrough');
        expect(at({ mode, mouseTracking: true, hasSelection: true })).toBe('passthrough');
      });
    }

    it('Shift bypasses it and behaves as if nothing tracked the mouse', () => {
      expect(at({ mouseTracking: true, shiftKey: true })).toBe('paste');
      expect(at({ mouseTracking: true, shiftKey: true, hasSelection: true })).toBe('copy');
      expect(at({ mode: 'paste', mouseTracking: true, shiftKey: true, hasSelection: true })).toBe('paste');
    });
  });

  it('Shift changes nothing when no app tracks the mouse', () => {
    expect(at({ shiftKey: true })).toBe(at());
    expect(at({ shiftKey: true, hasSelection: true })).toBe(at({ hasSelection: true }));
  });

  it('defaults to Windows Terminal behaviour', () => {
    expect(DEFAULT_TERMINAL_PREFS.rightClick).toBe('copyPaste');
  });
});

describe('normalizeRightClickMode', () => {
  it('keeps a known mode', () => {
    expect(normalizeRightClickMode('paste')).toBe('paste');
    expect(normalizeRightClickMode('off')).toBe('off');
  });

  it('reads anything else as the default', () => {
    for (const v of [undefined, null, '', 'menu', true, 0]) expect(normalizeRightClickMode(v)).toBe('copyPaste');
  });
});
