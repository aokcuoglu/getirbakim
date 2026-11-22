type Observe = typeof IntersectionObserver;

/**
 * Calls `arm` once, when `node` comes within 200px of the viewport (#1226). Without IntersectionObserver it arms on the
 * next frame instead; never synchronously, so a caller's effect/ref callback does not set state while it runs.
 * Returns the cleanup that cancels whatever is pending.
 */
export function armOnApproach(node: Element, arm: () => void, Observer: Observe | undefined = globalThis.IntersectionObserver): () => void {
  if (!Observer) {
    if (typeof requestAnimationFrame === "function") {
      const frame = requestAnimationFrame(arm);
      return () => cancelAnimationFrame(frame);
    }
    const timer = setTimeout(arm, 16);
    return () => clearTimeout(timer);
  }
  const observer = new Observer((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    arm();
  }, {rootMargin: "200px 0px"});
  observer.observe(node);
  return () => observer.disconnect();
}
