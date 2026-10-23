import { describe, it, expect } from 'vitest';
import { notificationEffects } from '../../src/main/notification-effects';

// Issue #1. NOTIFICATION_FIRE ignored the "Show toast notifications" and
// "Taskbar flash" toggles. Only an explicit `false` may turn an effect off.

describe('notificationEffects', () => {
  it('honours each toggle independently', () => {
    expect(notificationEffects({ toast: false, taskbarFlash: true })).toEqual({ toast: false, taskbarFlash: true });
    expect(notificationEffects({ toast: true, taskbarFlash: false })).toEqual({ toast: true, taskbarFlash: false });
    expect(notificationEffects({ toast: false, taskbarFlash: false })).toEqual({ toast: false, taskbarFlash: false });
  });

  it('keeps today’s behaviour for an install that never saved the block', () => {
    expect(notificationEffects(undefined)).toEqual({ toast: true, taskbarFlash: true });
    expect(notificationEffects({})).toEqual({ toast: true, taskbarFlash: true });
  });

  it('does not go silent on a corrupt block', () => {
    for (const v of [null, 'x', 42, [], { toast: 'no', taskbarFlash: 0 }]) {
      expect(notificationEffects(v)).toEqual({ toast: true, taskbarFlash: true });
    }
  });
});
