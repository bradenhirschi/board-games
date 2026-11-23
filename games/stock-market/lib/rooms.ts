"use client";

import { doc, onSnapshot, runTransaction, serverTimestamp, type DocumentData } from "firebase/firestore";
import {
  DEFAULT_TARGET,
  MAX_PLAYERS,
  MIN_PLAYERS,
  newGame,
  type Action,
  type BotLevel,
  type GameState,
} from "./engine";
import { firebase } from "@/shared/firebase";
import { resolve, type Resolved } from "./online";

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
  /** How well the room's bots play (chosen by the host in the lobby). */
  botLevel: BotLevel;
  seats: Seat[];
  memberUids: string[];
  version: number;
  state: GameState | null;
  replay: Replay | null;
  /** Whose turn it is (null on a bot's turn): the security rules let only them write. */
  currentUid: string | null;
}

export const CODE_LENGTH = 5;

export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, CODE_LENGTH);
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
    botLevel: data.botLevel === "easy" ? "easy" : "normal",
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

/** Open a room and take a seat atomically. The first successful entrant hosts a new room. */
export function enterRoom(code: string, uid: string, name: string): Promise<void> {
  return takeSeat(code, uid, name, true);
}

/** Take a seat in an existing lobby, including when following a shared link. */
export function joinRoom(code: string, uid: string, name: string): Promise<void> {
  return takeSeat(code, uid, name, false);
}

async function takeSeat(code: string, uid: string, name: string, createIfMissing: boolean): Promise<void> {
  if (code.length !== CODE_LENGTH || code !== normalizeCode(code)) {
    throw new RoomError("Room codes are 5 letters and numbers.");
  }
  const ref = roomRef(code);
  await runTransaction(firebase().db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      if (!createIfMissing) throw new RoomError(`There's no room ${code}.`);
      tx.set(ref, {
        code,
        hostUid: uid,
        status: "lobby",
        target: DEFAULT_TARGET,
        seats: [{ uid, name, isBot: false }],
        memberUids: [uid],
        version: 0,
        stateJson: null,
        replayJson: null,
        currentUid: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return;
    }
    const room = parseRoom(snap.data());
    if (room.memberUids.includes(uid)) return;
    if (room.status !== "lobby") throw new RoomError("That game has already started.");
    if (room.seats.length >= MAX_PLAYERS) throw new RoomError("That room is full.");
    tx.update(ref, {
      seats: [...room.seats, { uid, name, isBot: false }],
      memberUids: [...room.memberUids, uid],
      updatedAt: serverTimestamp(),
    });
  });
}

/** Change the lobby's seats or target (host), or leave it (anyone). */
export async function editLobby(
  code: string,
  edit: (room: Room) => { seats?: Seat[]; target?: number; botLevel?: BotLevel },
): Promise<void> {
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
      // Only written when the host picks a level, so other players' edits (joining,
      // leaving) never touch a field the rules reserve for the host.
      ...(next.botLevel ? { botLevel: next.botLevel } : {}),
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
      room.botLevel,
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

/**
 * The host removes a player mid-game: their seat becomes a bot (saved as a normal move, so every
 * phone replays it) and their account leaves the room.
 */
export async function kickPlayer(code: string, hostUid: string, seat: number): Promise<Room | null> {
  return runTransaction(firebase().db, async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (!snap.exists()) return null;
    const room = parseRoom(snap.data());
    const kicked = room.seats[seat];
    if (room.status !== "playing" || !room.state || room.hostUid !== hostUid) return null;
    if (!kicked?.uid || kicked.uid === hostUid) return null;
    const move = resolve(room.state, { type: "replaceWithBot", playerId: seat });
    if (!move) return null;
    const seats = room.seats.map((s, i) => (i === seat ? { uid: null, name: s.name, isBot: true } : s));
    const replay: Replay = { from: room.version, by: hostUid, actions: move.actions };
    const saved: Room = {
      ...room,
      seats,
      memberUids: room.memberUids.filter((u) => u !== kicked.uid),
      version: room.version + 1,
      state: move.state,
      replay,
      currentUid: seatUid(move.state, seats),
    };
    tx.update(roomRef(code), {
      seats: saved.seats,
      memberUids: saved.memberUids,
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
