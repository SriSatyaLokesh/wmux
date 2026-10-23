/**
 * Which side effects a NOTIFICATION_FIRE may have (#1).
 *
 * Settings → Notifications has offered "Show toast notifications" and
 * "Taskbar flash" toggles since they were added, and the chokepoint in
 * ipc-handlers.ts read neither: every notification showed a toast and flashed
 * an unfocused window whatever the user had chosen. (`taskbarFlash` did reach
 * `useBlockedAlert`, which is why the toggle looked as if it did something.)
 *
 * The prefs are read off settings.json at fire time — the renderer's
 * `persist()` writes `wmux-notification-prefs` there synchronously, the way
 * `confirmAppClose` and `gpuWatchdog` are read — so no IPC and no restart.
 * Only an explicit `false` turns an effect off: an absent block is an install
 * that never opened the panel, and a corrupt one is not a reason to go silent.
 */

export interface NotificationEffects {
  toast: boolean;
  taskbarFlash: boolean;
}

export function notificationEffects(prefs: unknown): NotificationEffects {
  const p = (prefs && typeof prefs === 'object' ? prefs : {}) as Record<string, unknown>;
  return {
    toast: p.toast !== false,
    taskbarFlash: p.taskbarFlash !== false,
  };
}
