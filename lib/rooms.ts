"use client";

import { doc, onSnapshot, runTransaction, serverTimestamp, type DocumentData } from "firebase/firestore";
import { DEFAULT_TARGET, MAX_PLAYERS, MIN_PLAYERS, newGame, type Action, type GameState } from "./engine";
import { firebase } from "./firebase";
import type { Resolved } from "./online";

/**
 * Online rooms live in Firestore at stockMarketRooms/{code}. The game state is stored as JSON
 * (Firestore can't hold `undefined` or nested arrays), alongside the actions that
 * produced the latest version so other phones can replay them.
 */

export interface Seat {
  /** The player's account, or null for a bot. */
  uid: string | null;
  name: string;
  isBot: boolean;
}

export interface Replay {
  /** The version these actions start from. */
  from: number;
  /** Who applied them. */
  by: string;
  actions: Action[];
}

export interface Room {
  code: string;
  hostUid: string;
  status: "lobby" | "playing";
  target: number;
  seats: Seat[];
  memberUids: string[];
  version: number;
  state: GameState | null;
  replay: Replay | null;
  /** Whose turn it is (null on a bot's turn): the security rules let only them write. */
  currentUid: string | null;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I
const CODE_LENGTH = 5;

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH);
}

function randomCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
}

/** Firestore collection for this game's rooms (the project may host other games too). */
export const ROOMS = "stockMarketRooms";

const roomRef = (code: string) => doc(firebase().db, ROOMS, code);

function parseRoom(data: DocumentData): Room {
  return {
    code: data.code,
    hostUid: data.hostUid,
    status: data.status,
    target: data.target,
    seats: data.seats,
    memberUids: data.memberUids,
    version: data.version,
    state: data.stateJson ? (JSON.parse(data.stateJson) as GameState) : null,
    replay: data.replayJson ? (JSON.parse(data.replayJson) as Replay) : null,
    currentUid: data.currentUid ?? null,
  };
}

/** Who may save the next move: the current player, or anyone seated (null) while occupations are chosen. */
export function seatUid(state: GameState, seats: Seat[]): string | null {
  if (state.phase.t === "chooseCareers") return null;
  return seats[state.current]?.uid ?? null;
}

export class RoomError extends Error {}

export async function createRoom(uid: string, name: string, target = DEFAULT_TARGET): Promise<string> {
  const { db } = firebase();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const created = await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef(code));
      if (snap.exists()) return false;
      tx.set(roomRef(code), {
        code,
        hostUid: uid,
        status: "lobby",
        target,
        seats: [{ uid, name, isBot: false }],
        memberUids: [uid],
        version: 0,
        stateJson: null,
        replayJson: null,
        currentUid: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return true;
    });
    if (created) return code;
  }
  throw new RoomError("Couldn't create a room. Try again.");
}

/** Take a seat in a room's lobby (or do nothing if already seated). */
export async function joinRoom(code: string, uid: string, name: string): Promise<void> {
  await runTransaction(firebase().db, async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (!snap.exists()) throw new RoomError(`There's no room ${code}.`);
    const room = parseRoom(snap.data());
    if (room.memberUids.includes(uid)) return;
    if (room.status !== "lobby") throw new RoomError("That game has already started.");
    if (room.seats.length >= MAX_PLAYERS) throw new RoomError("That room is full.");
    tx.update(roomRef(code), {
      seats: [...room.seats, { uid, name, isBot: false }],
      memberUids: [...room.memberUids, uid],
      updatedAt: serverTimestamp(),
    });
  });
}

/** Change the lobby's seats or target (host), or leave it (anyone). */
export async function editLobby(code: string, edit: (room: Room) => { seats?: Seat[]; target?: number }): Promise<void> {
  await runTransaction(firebase().db, async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (!snap.exists()) throw new RoomError("That room no longer exists.");
    const room = parseRoom(snap.data());
    if (room.status !== "lobby") throw new RoomError("The game has already started.");
    const next = edit(room);
    const seats = next.seats ?? room.seats;
    tx.update(roomRef(code), {
      seats,
      memberUids: seats.flatMap((s) => (s.uid ? [s.uid] : [])),
      target: next.target ?? room.target,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function startGame(code: string): Promise<void> {
  await runTransaction(firebase().db, async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (!snap.exists()) throw new RoomError("That room no longer exists.");
    const room = parseRoom(snap.data());
    if (room.status !== "lobby") return;
    if (room.seats.length < MIN_PLAYERS) throw new RoomError(`You need at least ${MIN_PLAYERS} players.`);
    const state = newGame(
      room.seats.map((s) => ({ name: s.name, isBot: s.isBot })),
      room.target,
    );
    tx.update(roomRef(code), {
      status: "playing",
      version: 1,
      stateJson: JSON.stringify(state),
      replayJson: null,
      currentUid: seatUid(state, room.seats),
      updatedAt: serverTimestamp(),
    });
  });
}

/**
 * Save a move, returning the room as saved (or null if it wasn't). `decide` works it out from the latest saved state, inside the transaction,
 * so if another phone saves at the same moment Firestore simply retries it.
 *
 * With `fromVersion`, the move only counts if nothing has changed since then (a turn move,
 * or two phones racing to play the same bot turn); otherwise it returns null and the
 * caller just waits for the update. Without it (e.g. picking an occupation, which players
 * do at the same time), the move is applied to whatever the latest state is.
 */
export async function submitMove(
  code: string,
  fromVersion: number | null,
  by: string,
  decide: (state: GameState) => Resolved | null,
): Promise<Room | null> {
  return runTransaction(firebase().db, async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (!snap.exists()) return null;
    const room = parseRoom(snap.data());
    if (room.status !== "playing" || !room.state) return null;
    if (fromVersion !== null && room.version !== fromVersion) return null;
    const move = decide(room.state);
    if (!move) return null;
    const replay: Replay = { from: room.version, by, actions: move.actions };
    const saved: Room = {
      ...room,
      version: room.version + 1,
      state: move.state,
      replay,
      currentUid: seatUid(move.state, room.seats),
    };
    tx.update(roomRef(code), {
      version: saved.version,
      stateJson: JSON.stringify(saved.state),
      replayJson: JSON.stringify(replay),
      currentUid: saved.currentUid,
      updatedAt: serverTimestamp(),
    });
    return saved;
  });
}

export function watchRoom(code: string, onRoom: (room: Room | null) => void, onError: (e: Error) => void): () => void {
  return onSnapshot(
    roomRef(code),
    (snap) => onRoom(snap.exists() ? parseRoom(snap.data()) : null),
    (e) => onError(e),
  );
}
