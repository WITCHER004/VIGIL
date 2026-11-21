"use client";

import { Fragment, useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Dependency-free JSON syntax highlighter with a line-number gutter.
 * Palette stays inside the system: keys in Silver Blue, strings in body ink,
 * numbers in Copper, booleans/null in muted emerald, punctuation recessed.
 */

const TOKEN = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|[{}[\],])/g;

function highlightLine(line: string, lineIndex: number): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of line.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(line.slice(last, idx));
    const tok = m[0];
    let cls = "text-silver/50";
    let text: string = tok;
    if (tok.startsWith('"')) {
      if (m[2]) {
        cls = "text-ultramarine font-medium";
        text = tok.slice(0, tok.length - m[2].length);
        out.push(
          <span key={`${lineIndex}-${i++}`} className={cls}>
            {text}
          </span>,
          <span key={`${lineIndex}-${i++}`} className="text-silver">
            {m[2]}
          </span>,
        );
        last = idx + tok.length;
        continue;
      }
      cls = "text-ink";
    } else if (tok === "true" || tok === "false" || tok === "null") {
      cls = "text-viridian font-semibold";
    } else if (/^-?\d/.test(tok)) {
      cls = "text-vermilion";
    }
    out.push(
      <span key={`${lineIndex}-${i++}`} className={cls}>
        {text}
      </span>,
    );
    last = idx + tok.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

interface JsonViewProps {
  /** Parsed value, or a raw string (pretty-printed if it parses as JSON). */
  value: unknown;
  className?: string;
  maxHeight?: number | string;
}

export function JsonView({ value, className, maxHeight = 520 }: JsonViewProps) {
  const { lines, isJson } = useMemo(() => {
    let text: string;
    let json = true;
    if (typeof value === "string") {
      try {
        text = JSON.stringify(JSON.parse(value), null, 2);
      } catch {
        text = value;
        json = false;
      }
    } else {
      text = JSON.stringify(value ?? null, null, 2);
    }
    return { lines: text.split("\n"), isJson: json };
  }, [value]);

  const gutter = String(lines.length).length;

  return (
    <div className={cn("well overflow-auto", className)} style={{ maxHeight }}>
      <pre className="grid min-w-max py-3" style={{ gridTemplateColumns: `${gutter + 2}ch 1fr` }}>
        {lines.map((line, i) => (
          <Fragment key={i}>
            <span className="select-none pr-3 text-right text-silver/30">{i + 1}</span>
            <code className="pr-4 text-body">{isJson ? highlightLine(line, i) : line}</code>
          </Fragment>
        ))}
      </pre>
    </div>
  );
}
