import { useEffect } from 'react';

/**
 * Run the effect when the screen mounts. There is no navigation library, so
 * there is no focus event to hook — screens mount when selected and unmount
 * when left, which makes mount the focus boundary. When a router lands, this
 * becomes its useFocusEffect without touching the call sites.
 */
export function useFocusEffect(effect: () => void | (() => void) | Promise<unknown>): void {
  useEffect(() => {
    // An async refresh returns a promise, not a cleanup — invoking it inside
    // a sync wrapper keeps the floating promise out of the effect contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const cleanup = effect();
    return typeof cleanup === 'function' ? cleanup : undefined;
  }, []);
}
