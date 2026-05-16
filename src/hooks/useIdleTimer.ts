import { useEffect, useRef } from "react";

/**
 * Fires `onIdle` after `delayMs` of no user interaction. Any click,
 * keypress, scroll, mousemove, or touch resets the timer.
 *
 * `active` lets the caller pause the timer when there's nothing to
 * track (e.g. when no credentials are currently revealed).
 *
 * Used by AccountLoginsPage to auto-redact revealed passwords after
 * 30 seconds of inactivity.
 */
export function useIdleTimer({
  delayMs,
  onIdle,
  active,
}: {
  delayMs: number;
  onIdle: () => void;
  active: boolean;
}) {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reset = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        onIdleRef.current();
      }, delayMs);
    };
    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "click",
    ];
    events.forEach((evt) => window.addEventListener(evt, reset, { passive: true }));
    reset();
    return () => {
      if (timer) clearTimeout(timer);
      events.forEach((evt) => window.removeEventListener(evt, reset));
    };
  }, [delayMs, active]);
}
