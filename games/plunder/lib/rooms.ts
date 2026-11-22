"use client";

import { doc, onSnapshot, runTransaction, serverTimestamp, type DocumentData } from "firebase/firestore";
import { firebase } from "@/shared/firebase";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_COLORS,
  newGame,
  randomLayout,
  type Action,
  type GameState,
  type PlayerColor,
} from "./engine";
import { seatToAct, type Resolved } from "./online";

/**
 * Plunder's online rooms live in Firestore at plunderRooms/{code}, laid out like Stock Market's
 * (stockMarketRooms): the game state is stored as JSON, alongside the actions that produced the
 * latest version so other devices can replay them. `currentUid` is whoever the game waits on
 * (null for a bot); the security rules let only them write a move.
 */

export interface Seat {
  /** The player's account, or null for a bot. */
  uid: string | null;
  name: string;
  color: PlayerColor;
  isBot: boolean;
}

export interface Replay {
  /** The version these actions start from. */
  from: number;
  /** Who applied them ("bot" for a bot's move, played by any seated device). */
  by: string;
  actions: Action[];
}

export interface Room {
  code: string;
  hostUid: string;
  status: "lobby" | "playing";
  seats: Seat[];
  memberUids: string[];
  version: number;
  state: GameState | null;
  replay: Replay | null;
  currentUid: string | null;
}

export const ROOMS = "plunderRooms";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I
const CODE_LENGTH = 5;

export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, CODE_LENGTH);
}

function randomCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
}

const roomRef = (code: string) => doc(firebase().db, ROOMS, code);

function parseRoom(data: DocumentData): Room {
  return {
    code: data.code,
    hostUid: data.hostUid,
    status: data.status,
    seats: data.seats,
    memberUids: data.memberUids,
    version: data.version,
    state: data.stateJson ? (JSON.parse(data.stateJson) as GameState) : null,
    replay: data.replayJson ? (JSON.parse(data.replayJson) as Replay) : null,
    currentUid: data.currentUid ?? null,
  };
}

/** Whose account may save the next move: the seat the game waits on (null for a bot). */
export function seatUid(state: GameState, seats: Seat[]): string | null {
  const p = seatToAct(state);
  return p === null ? null : (seats[p]?.uid ?? null);
}

/** The first colour nobody in the room has taken. */
export function freeColor(seats: Seat[]): PlayerColor {
  return PLAYER_COLORS.find((c) => !seats.some((s) => s.color === c)) ?? PLAYER_COLORS[0];
}

export class RoomError extends Error {}

export async function createRoom(uid: string, name: string): Promise<string> {
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
        seats: [{ uid, name, color: PLAYER_COLORS[0], isBot: false }],
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
      seats: [...room.seats, { uid, name, color: freeColor(room.seats), isBot: false }],
      memberUids: [...room.memberUids, uid],
      updatedAt: serverTimestamp(),
    });
  });
}

/** Change the lobby's seats (the host adds or removes; anyone leaves or changes their own colour). */
export async function editLobby(code: string, edit: (room: Room) => Seat[]): Promise<void> {
  await runTransaction(firebase().db, async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (!snap.exists()) throw new RoomError("That room no longer exists.");
    const room = parseRoom(snap.data());
    if (room.status !== "lobby") throw new RoomError("The game has already started.");
    const seats = edit(room);
    tx.update(roomRef(code), {
      seats,
      memberUids: seats.flatMap((s) => (s.uid ? [s.uid] : [])),
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
    const seed = Math.floor(Math.random() * 2 ** 32);
    // Everyone rolls to decide who picks an island first (re-rolled until there's one highest).
    let rolls: number[];
    do rolls = room.seats.map(() => 1 + Math.floor(Math.random() * 6));
    while (rolls.filter((r) => r === Math.max(...rolls)).length > 1);
    const state = newGame(
      room.seats.map((s) => ({ name: s.name, color: s.color, isBot: s.isBot })),
      seed,
      randomLayout(seed ^ 0x9e3779b9),
      rolls,
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
 * Save a move, returning the room as saved (or null if it wasn't). The move only counts if the
 * room is still at `fromVersion` (so two devices racing to play the same bot move can't both
 * win); `decide` works it out from the saved state inside the transaction.
 */
export async function submitMove(
  code: string,
  fromVersion: number,
  by: string,
  decide: (state: GameState) => Resolved | null,
): Promise<{ room: Room; move: Resolved } | null> {
  return runTransaction(firebase().db, async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (!snap.exists()) return null;
    const room = parseRoom(snap.data());
    if (room.status !== "playing" || !room.state || room.version !== fromVersion) return null;
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
    return { room: saved, move };
  });
}

export function watchRoom(code: string, onRoom: (room: Room | null) => void, onError: (e: Error) => void): () => void {
  return onSnapshot(
    roomRef(code),
    (snap) => onRoom(snap.exists() ? parseRoom(snap.data()) : null),
    (e) => onError(e),
  );
}
