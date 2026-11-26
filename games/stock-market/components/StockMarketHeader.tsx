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

interface HeaderProps {
  user: ReturnType<typeof useFirebaseUser>;
  name: string;
  setName: (name: string) => void;
}

export default function StockMarketHeader(props: HeaderProps) {
  return (
    <header className="stock-market-header">
      <div>
        <h1 className="setup-logo">Stock Market</h1>
        <p className="muted">Buy low, sell high. For 2–32 players.</p>
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
    <details className="stock-market-account">
      <summary aria-label="Account">
        <span className="stock-market-profile-picture" aria-hidden="true" />
      </summary>
      <section className="stock-market-account-panel" aria-label="Account">
        <h2 className="home-heading">Account</h2>
        <p>{googleName ? <>Signed in as <b>{googleName}</b></> : "Playing as guest"}</p>
        <button type="button" className="btn" disabled={busy} onClick={() => void changeAccount()}>
          {googleName ? "Sign out" : "Sign in with Google"}
        </button>
        {error && <p className="hint bad" role="alert">{error}</p>}
      </section>
    </details>
  );
}
