/** A test double for a resource: a fixed value plus a factory that records use. */
export interface MockResource<T> {
  /** The value the factory returns. */
  value: T;
  /** Pass to `queue.resource(name, mock.factory)`. */
  factory: () => T;
  /** How many times the factory was invoked (i.e. the resource was built). */
  resolutions: number;
}

/**
 * Build a {@link MockResource} wrapping `value`, for swapping a real resource for
 * a stub in tests. Register it with `queue.resource(name, mock.factory)` and
 * assert on `mock.resolutions` to confirm the resource was built.
 */
export function mockResource<T>(value: T): MockResource<T> {
  const mock: MockResource<T> = {
    value,
    resolutions: 0,
    factory: () => {
      mock.resolutions += 1;
      return mock.value;
    },
  };
  return mock;
}
