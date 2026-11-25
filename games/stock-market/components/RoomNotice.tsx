"use client";

import { useState, type ReactNode } from "react";
import type { Room } from "@/games/stock-market/lib/rooms";

/** Was this account seated when the game screen opened, and isn't any more? Then the host removed it. */
export function useRemoved(room: Room, uid: string): boolean {
  const [wasSeated] = useState(() => room.memberUids.includes(uid));
  return wasSeated && !room.memberUids.includes(uid);
}

export function Notice({
  header,
  title,
  text,
  onQuit,
}: {
  header?: ReactNode;
  title: string;
  text: string;
  onQuit: () => void;
}) {
  return (
    <main className="setup">
      <div className="setup-card">
        {header ? (
          <>
            {header}
            <h2 className="lobby-heading">{title}</h2>
          </>
        ) : (
          <h1 className="setup-logo">{title}</h1>
        )}
        <p className="muted">{text}</p>
        <button className="btn" onClick={onQuit}>
          Back to menu
        </button>
      </div>
    </main>
  );
}
