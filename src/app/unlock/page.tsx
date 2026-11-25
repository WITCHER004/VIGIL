import type { Metadata } from "next";
import { UnlockScreen } from "./UnlockScreen";

export const metadata: Metadata = { title: "Sign in" };

export default async function UnlockPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Only same-origin paths: "//evil.com" or "/\evil.com" would be an open redirect.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
  return <UnlockScreen next={safeNext} />;
}
