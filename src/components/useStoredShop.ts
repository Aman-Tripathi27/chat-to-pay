"use client";

import { useSyncExternalStore } from "react";

export interface Shop {
  name: string;
  catalog: string;
  policies: string;
}

// The shop setup lives in this browser's localStorage: it's per-device
// convenience data, and the app keeps no database of its own.
const KEY = "ctp_shop_v1";
const EMPTY: Shop = { name: "", catalog: "", policies: "" };

const listeners = new Set<() => void>();
let memoryRaw: string | null = null; // fallback when localStorage is blocked
let cachedRaw: string | null | undefined;
let cachedShop: Shop = EMPTY;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return memoryRaw;
  }
}

function getSnapshot(): Shop {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedShop = raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
    } catch {
      cachedShop = EMPTY;
    }
  }
  return cachedShop;
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

export function saveShop(shop: Shop) {
  const raw = JSON.stringify(shop);
  memoryRaw = raw;
  try {
    window.localStorage.setItem(KEY, raw);
  } catch {
    // stays in memory for this tab
  }
  listeners.forEach((l) => l());
}

export function useStoredShop(): Shop {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
