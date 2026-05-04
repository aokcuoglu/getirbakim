declare module 'bun:test' {
  type TestCallback = () => void | Promise<void>

  interface PromiseMatchers {
    toBe(expected: unknown): Promise<void>
    toEqual(expected: unknown): Promise<void>
  }

  interface Matcher<T = unknown> {
    toBe(expected: T): void
    toBeNull(): void
    toEqual(expected: unknown): void
    toHaveLength(expected: number): void
    toHaveBeenCalledWith(...args: unknown[]): void
    not: Matcher<T>
    resolves: PromiseMatchers
  }

  export function describe(name: string, fn: TestCallback): void
  export function it(name: string, fn: TestCallback): void
  export function beforeEach(fn: TestCallback): void
  export function afterEach(fn: TestCallback): void
  export function expect<T = unknown>(actual: T): Matcher<T>
  export const mock: unknown
}
