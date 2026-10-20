"use client";

import { useCallback, useState } from "react";

/** Copies text and reports which key was copied for ~1.5s. */
export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      window.prompt("Copy this:", text);
    }
  }, []);
  return { copied, copy };
}
