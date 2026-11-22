"use client";

import { useSyncExternalStore } from "react";

/**
 * "Auto-roll at work": when on, a working player's turn rolls for salary straight away (no tap).
 * Remembered on this device, like the Sound setting.
 */

const KEY = "stock-market:auto-roll";
let autoRoll = read();
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setAutoRoll(on: boolean) {
  autoRoll = on;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // Private mode etc.: the setting just won't be remembered.
  }
  listeners.forEach((l) => l());
}

export function useAutoRoll(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => autoRoll,
    () => false,
  );
}
