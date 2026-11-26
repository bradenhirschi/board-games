"use client";

// Who is on Plunder right now (the same as Stock Market's presence, in its own collection).

import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { firebase } from "@/shared/firebase";

export type PresenceStatus = "home" | "lobby" | "playing";
const HEARTBEAT_MS = 30_000;
const ONLINE_WINDOW_MS = 90_000;

interface Presence {
  uid: string;
  name: string;
  status: PresenceStatus;
  seenAt: number;
}

export function usePlunderPresence(uid: string | undefined, name: string, status: PresenceStatus, watch: boolean) {
  const [roster, setRoster] = useState<Presence[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!uid) return;
    const ref = doc(firebase().db, "plunderPresence", uid);
    const heartbeat = () => {
      if (document.visibilityState === "hidden") return;
      // A failed heartbeat can be retried on the next tick or when the tab becomes visible.
      void setDoc(ref, { name, status, seenAt: serverTimestamp() }).catch(() => {});
    };
    heartbeat();
    const timer = window.setInterval(heartbeat, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", heartbeat);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", heartbeat);
    };
  }, [uid, name, status]);

  useEffect(() => {
    if (!uid || !watch) return;
    const recent = query(collection(firebase().db, "plunderPresence"), orderBy("seenAt", "desc"), limit(50));
    const stop = onSnapshot(
      recent,
      (snapshot) => {
        setNow(Date.now());
        setRoster(
          snapshot.docs.map((entry) => {
            const data = entry.data({ serverTimestamps: "estimate" });
            return { uid: entry.id, name: data.name, status: data.status, seenAt: data.seenAt?.toMillis() ?? 0 };
          }),
        );
        setUnavailable(false);
      },
      () => setUnavailable(true),
    );
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      stop();
      window.clearInterval(timer);
    };
  }, [uid, watch]);

  return { players: uid ? roster?.filter((player) => now - player.seenAt < ONLINE_WINDOW_MS) : undefined, unavailable };
}
