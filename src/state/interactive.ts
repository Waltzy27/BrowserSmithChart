/**
 * "Interactive" flag set while a drag gesture is in progress.
 *
 * Applying the network to an imported trace costs ~1 µs per point per element on a
 * desktop (≈ 75 ms for 10 000 points × 6 elements, measured), which is too slow to
 * repeat every animation frame. While dragging, derive() therefore evaluates the
 * applied trace on a decimated set of frequencies (interpolated between them) and
 * recomputes it in full when the gesture ends. All other maths stays exact.
 */
let interactive = false;
export const isInteractive = (): boolean => interactive;
export const setInteractive = (v: boolean): void => { interactive = v; };
/** Budget of point × element evaluations per frame while interactive. */
export const INTERACTIVE_BUDGET = 12000;
