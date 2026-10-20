"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Status = { razorpay: "live" | "test" | "demo"; claudeConfigured: boolean };

const MODE_LABEL: Record<Status["razorpay"], { text: string; className: string }> = {
  test: { text: "Razorpay test mode", className: "bg-warn-soft text-warn" },
  live: { text: "Live payments", className: "bg-ok-soft text-ok" },
  demo: { text: "Demo mode (no Razorpay keys)", className: "bg-surface-2 text-muted" },
};

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
  }

  const nav = [
    { href: "/", label: "New order" },
    { href: "/orders", label: "Orders" },
  ];

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-sm text-accent-ink">₹</span>
          Chat-to-Pay
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-3 py-1.5 transition-colors ${
                pathname === item.href ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-text"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {status && (
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${MODE_LABEL[status.razorpay].className}`}>
              {MODE_LABEL[status.razorpay].text}
            </span>
          )}
          <button onClick={logout} className="rounded-lg px-2 py-1 text-sm text-muted hover:text-text">
            Log out
          </button>
        </div>
      </div>
      {status && !status.claudeConfigured && (
        <div className="bg-danger-soft px-4 py-2 text-center text-sm text-danger">
          ANTHROPIC_API_KEY isn&apos;t set on the server, so reading chats won&apos;t work yet.
        </div>
      )}
    </header>
  );
}
