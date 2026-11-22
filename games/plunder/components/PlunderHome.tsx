"use client";

import { useState } from "react";
import { authErrorMessage, onlineAvailable, signInWithGoogle, signOutUser, useFirebaseUser } from "@/shared/firebase";

/** Placeholder home screen. Shows the shared account so one login carries across games. */
export default function PlunderHome() {
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

  const googleName = user && !user.isAnonymous ? (user.displayName ?? user.email ?? "your Google account") : null;

  return (
    <main className="pl-home">
      <h1 className="pl-title">Plunder</h1>
      <p className="pl-tagline">A pirate board game. Coming soon.</p>

      {onlineAvailable && (
        <section className="pl-account" aria-live="polite">
          {user === undefined && <p>Checking your account…</p>}
          {user !== undefined && googleName && (
            <>
              <p>
                Signed in as <strong>{googleName}</strong>
              </p>
              <button className="pl-link" disabled={busy} onClick={() => run(signOutUser)}>
                Sign out
              </button>
            </>
          )}
          {user !== undefined && !googleName && (
            <>
              <p>{user ? "Playing as a guest." : "Not signed in."}</p>
              <button className="pl-btn" disabled={busy} onClick={() => run(signInWithGoogle)}>
                Sign in with Google
              </button>
            </>
          )}
          {error && <p className="pl-error">{error}</p>}
        </section>
      )}
    </main>
  );
}
