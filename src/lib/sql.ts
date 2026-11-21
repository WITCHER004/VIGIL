import "server-only";
import { Prisma } from "@prisma/client";

/**
 * A UTC `timestamp` literal for raw SQL comparisons against Prisma DateTime
 * columns (`timestamp(3)` without time zone, stored as UTC).
 *
 * Passing a JS Date straight into `$queryRaw` binds it as `timestamptz`; Postgres
 * then casts the *column* to timestamptz using the session TimeZone, silently
 * shifting every window by the server's UTC offset (e.g. +5:30). Building the
 * value from epoch milliseconds and converting `AT TIME ZONE 'UTC'` makes the
 * comparison independent of session settings.
 */
export function utcTimestamp(at: Date | number): Prisma.Sql {
  const ms = typeof at === "number" ? at : at.getTime();
  return Prisma.sql`(to_timestamp(${ms}::float8 / 1000.0) AT TIME ZONE 'UTC')`;
}
