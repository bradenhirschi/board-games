"use client";

import { useState } from "react";
import {
  authErrorMessage,
  ensureUser,
  onlineAvailable,
  signInWithGoogle,
  signOutUser,
  type useFirebaseUser,
} from "@/shared/firebase";
import { MAX_PLAYERS, MIN_PLAYERS } from "@/games/plunder/lib/engine";

type HeaderProps = {
  user: ReturnType<typeof useFirebaseUser>;
  name: string;
  setName: (name: string) => void;
};

/**
 * The home screens' header, laid out like every game's: title and one line about the game on the
 * left, the account menu (a profile picture) on the right.
 */
export default function PlunderHeader(props: HeaderProps) {
  return (
    <header className="pl-home-header">
      <div>
        <h1 className="pl-title">Plunder</h1>
        <p className="pl-muted">
          Sail, raid and plunder. For {MIN_PLAYERS}–{MAX_PLAYERS} players.
        </p>
      </div>
      {onlineAvailable && <AccountMenu {...props} />}
    </header>
  );
}

function AccountMenu({ user, name, setName }: HeaderProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const googleName = user && !user.isAnonymous ? (user.displayName ?? user.email ?? "your Google account") : null;

  const changeAccount = async () => {
    setBusy(true);
    setError(null);
    try {
      if (googleName) {
        await signOutUser();
        await ensureUser();
      } else {
        const signedIn = await signInWithGoogle();
        if (!name.trim() && signedIn.displayName) setName(signedIn.displayName.split(" ")[0].slice(0, 16));
      }
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="pl-account">
      <summary aria-label="Account">
        <svg className="pl-profile-picture" viewBox="0 0 44 44" aria-hidden="true">
          <circle cx="22" cy="17" r="7" />
          <path d="M8.5 37c1.6-7.4 7-11 13.5-11s11.9 3.6 13.5 11" />
        </svg>
      </summary>
      <section className="pl-account-panel" aria-label="Account">
        <h2 className="pl-home-heading">Account</h2>
        <p>
          {googleName ? (
            <>
              Signed in as <b>{googleName}</b>
            </>
          ) : (
            "Playing as guest"
          )}
        </p>
        <button type="button" className="pl-btn" disabled={busy} onClick={() => void changeAccount()}>
          {googleName ? "Sign out" : "Sign in with Google"}
        </button>
        {error && (
          <p className="pl-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </details>
  );
}
