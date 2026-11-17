// After the Mac wakes from sleep, Docker/MinIO's clock can lag for a few minutes and every signed request fails with
// RequestTimeTooSkewed (403). The clock catches up on its own, so only that error is retried, on a short bounded schedule;
// AccessDenied, NoSuchKey, NoSuchBucket and everything else fail on the first attempt.
export const SKEW_RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 240_000] as const; // ~7.5 min in total

export function isClockSkewError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { name, Code, code } = error as { name?: unknown; Code?: unknown; code?: unknown };
  return [name, Code, code].some((value) => value === "RequestTimeTooSkewed" || value === "RequestExpired");
}

export async function sendWithSkewRetry<T>(
  send: () => Promise<T>,
  options: { delaysMs?: readonly number[]; wait?: (ms: number) => Promise<void>; onRetry?: (attempt: number, delayMs: number) => void } = {},
): Promise<T> {
  const delays = options.delaysMs ?? SKEW_RETRY_DELAYS_MS;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (error) {
      if (!isClockSkewError(error) || attempt >= delays.length) throw error;
      options.onRetry?.(attempt + 1, delays[attempt]);
      await wait(delays[attempt]);
    }
  }
}
