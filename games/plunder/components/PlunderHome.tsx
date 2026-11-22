"use client";

import { useState } from "react";
import { authErrorMessage, onlineAvailable, signInWithGoogle, signOutUser, useFirebaseUser } from "@/shared/firebase";
import Board from "./Board";

/** Plunder's one-screen layout: slim header, the board, and the controls area below it. Nothing scrolls. */
export default function PlunderHome() {
  return (
    <main className="pl-screen">
      <header className="pl-header">
        <h1 className="pl-title">Plunder</h1>
        {onlineAvailable && <Account />}
      </header>
      <Board />
      <section className="pl-controls" aria-label="Controls" />
    </main>
  );
}

/** The shared account (one login across every game). */
function Account() {
  const user = useFirebaseUser();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (user === undefined) return null;
  const googleName = user && !user.isAnonymous ? (user.displayName ?? user.email ?? "Google account") : null;
  return (
    <div className="pl-account" aria-live="polite">
      {error && <span className="pl-error">{error}</span>}
      {googleName ? (
        <>
          <span className="pl-account-name">{googleName}</span>
          <button className="pl-link" disabled={busy} onClick={() => run(signOutUser)}>
            Sign out
          </button>
        </>
      ) : (
        <button className="pl-link" disabled={busy} onClick={() => run(signInWithGoogle)}>
          Sign in
        </button>
      )}
    </div>
  );
}
