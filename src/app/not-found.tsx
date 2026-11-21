import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-20">
      <div className="h-px bg-rule" />
      <p className="label mt-8">Error 404</p>
      <h1 className="mt-3 text-[40px] leading-tight">Page not found</h1>
      <p className="mt-5 text-[15px] leading-relaxed text-body/85">
        Nothing is being monitored at this address. It may have been deleted, or the link was mistyped.
      </p>
      <div className="mt-8 flex gap-3">
        <Link href="/" className="btn-primary">
          Back to overview
        </Link>
        <Link href="/status/vigil" className="btn-ghost">
          Public status
        </Link>
      </div>
      <div className="mt-10 h-px bg-rule" />
    </main>
  );
}
