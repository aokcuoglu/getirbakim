export type FeedTone = "success" | "warning" | "danger" | "neutral";
export type FeedSummary = { current: number; attention: number; error: number; idle: number; badge: "success" | "warning" | "error" };

/** Counts supplier feed tones for the dashboard card; the four counters always add up to the number of feeds. Null tones = status unreadable. */
export function summarizeFeedTones(tones: FeedTone[] | null): FeedSummary | null {
  if (!tones) return null;
  const count = (tone: FeedTone) => tones.filter(t => t === tone).length;
  const summary = { current: count("success"), attention: count("warning"), error: count("danger"), idle: count("neutral") };
  const badge = summary.error ? "error" : summary.current === tones.length ? "success" : "warning";
  return { ...summary, badge };
}
