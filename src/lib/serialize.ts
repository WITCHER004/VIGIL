import type { Serialized } from "./client/types";

/**
 * Convert a server read model into exactly what the client would receive from
 * the JSON API (Dates → ISO strings), so server-rendered initial props and
 * later client refetches share one shape.
 */
export function serialize<T>(value: T): Serialized<T> {
  return JSON.parse(JSON.stringify(value)) as Serialized<T>;
}
