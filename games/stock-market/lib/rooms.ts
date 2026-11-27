"use client";

import {
  Timestamp,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type DocumentData,
  type Transaction,
} from "firebase/firestore";
import {
  DEFAULT_TARGET,
  MAX_PLAYERS,
  MIN_PLAYERS,
  newGame,
  type Action,
  type GameSettings,
  type GameState,
} from "./engine";
import { firebase } from "@/shared/firebase";
import { resolve, type Resolved } from "./online";
import { beginRounds, simulReplaceWithBot, stageKey } from "./simultaneous";

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

export interface Room extends GameSettings {
  code: string;
  hostUid: string;
  status: "lobby" | "playing";
  seats: Seat[];
  memberUids: string[];
  version: number;
  state: GameState | null;
  replay: Replay | null;
  /** Whose turn it is (null on a bot's turn): the security rules let only them write. */
  currentUid: string | null;
  /** Simultaneous turns: when the current stage started (server time, ms), for its timer. */
  stageStartedAt: number | null;
  /** The game has been won: its players may play again, and anyone may reuse the code. */
  over: boolean;
  /** When the room was last saved (server time, ms). */
  updatedAt: number | null;
}

const ROOM_CODE_MIN_LENGTH = 3;
// Firestore document IDs are limited to 1,500 bytes. Room codes are ASCII.
export const ROOM_CODE_MAX_LENGTH = 1500;

export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function isRoomCode(code: string): boolean {
  return code.length >= ROOM_CODE_MIN_LENGTH && code.length <= ROOM_CODE_MAX_LENGTH && code === normalizeCode(code);
}

/** Firestore collection for this game's rooms (the project may host other games too). */
export const ROOMS = "stockMarketRooms";

const roomRef = (code: string) => doc(firebase().db, ROOMS, code);

/** How many times a room save is tried before giving up. */
const SAVE_ATTEMPTS = 8;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a transaction that saves the room, trying again if it loses a race. When several devices
 * save the room at once (everyone in a simultaneous round, a crowd joining a lobby, two devices
 * playing the same bot turn), Firestore can judge the losing write against the winner's newer
 * room. The security rules then refuse it ("Missing or insufficient permissions") where it would
 * otherwise just be retried, so retry those here too, after a short random wait, reading the room
 * afresh each time. A write the rules really forbid still fails after the last try.
 */
async function saveRoom<T>(update: (tx: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await runTransaction(firebase().db, update);
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      const lostRace = code === "permission-denied" || code === "failed-precondition" || code === "aborted";
      if (!lostRace || attempt >= SAVE_ATTEMPTS) throw e;
      await sleep(attempt * (100 + Math.random() * 400));
    }
  }
}

function parseRoom(data: DocumentData): Room {
  return {
    code: data.code,
    hostUid: data.hostUid,
    status: data.status,
    target: data.target,
    startWithCash: data.startWithCash === true,
    balancedCareers: data.balancedCareers === true,
    simultaneous: data.simultaneous === true,
    botLevel: data.botLevel === "easy" ? "easy" : "normal",
    seats: data.seats,
    memberUids: data.memberUids,
    version: data.version,
    state: data.stateJson ? (JSON.parse(data.stateJson) as GameState) : null,
    replay: data.replayJson ? (JSON.parse(data.replayJson) as Replay) : null,
    currentUid: data.currentUid ?? null,
    stageStartedAt: data.stageStartedAt instanceof Timestamp ? data.stageStartedAt.toMillis() : null,
    over: data.over === true,
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toMillis() : null,
  };
}

/**
 * The server's clock minus this device's, so every phone runs a round's timer to the same
 * deadline. Each room update read from the server carries its server write time, which can
 * only be earlier than when it arrives here, so the largest difference seen is the best guess.
 */
let serverOffset: number | null = null;

function noteServerTime(data: DocumentData | undefined) {
  if (!(data?.updatedAt instanceof Timestamp)) return;
  const offset = data.updatedAt.toMillis() - Date.now();
  if (serverOffset === null || offset > serverOffset) serverOffset = offset;
}

/** The server's time now (ms), as best this device knows it. */
export function serverNow(): number {
  return Date.now() + (serverOffset ?? 0);
}

/** Who may save the next move: the current player, or anyone seated (null) while occupations are chosen. */
export function seatUid(state: GameState, seats: Seat[]): string | null {
  // In a simultaneous round everyone plays at once.
  if (state.phase.t === "chooseCareers" || state.simul) return null;
  return seats[state.current]?.uid ?? null;
}

export class RoomError extends Error {}

/**
 * A room untouched for this long counts as abandoned: entering its code opens a new lobby there.
 * The security rules allow it after 12 hours; the extra minutes cover a device's clock being off.
 */
const ABANDONED_MS = (12 * 60 + 10) * 60 * 1000;

/**
 * Whether entering this room's code should open a new lobby in its place: its game is over, or
 * nobody has touched it for half a day and this player isn't in it (they'd rather pick their game
 * back up).
 */
function reopens(room: Room, uid: string): boolean {
  if (room.over) return true;
  const abandoned = room.updatedAt !== null && serverNow() - room.updatedAt > ABANDONED_MS;
  return abandoned && !room.memberUids.includes(uid);
}

const d6 = () => 1 + Math.floor(Math.random() * 6);

/** Open a room and take a seat atomically. The first successful entrant hosts a new room. */
export function enterRoom(code: string, uid: string, name: string): Promise<void> {
  return takeSeat(code, uid, name, true);
}

/** Take a seat in an existing lobby, including when following a shared link. */
export function joinRoom(code: string, uid: string, name: string): Promise<void> {
  return takeSeat(code, uid, name, false);
}

async function takeSeat(code: string, uid: string, name: string, createIfMissing: boolean): Promise<void> {
  if (!isRoomCode(code)) {
    throw new RoomError("Enter a room code with at least 3 letters or numbers.");
  }
  const ref = roomRef(code);
  await saveRoom(async (tx) => {
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
    if (createIfMissing && reopens(room, uid)) {
      // A new lobby for this player, keeping the last game's settings.
      tx.update(ref, {
        hostUid: uid,
        status: "lobby",
        seats: [{ uid, name, isBot: false }],
        memberUids: [uid],
        version: room.version + 1,
        stateJson: null,
        replayJson: null,
        currentUid: null,
        stageStartedAt: null,
        over: false,
        updatedAt: serverTimestamp(),
      });
      return;
    }
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

/** Change lobby settings and seats (host), or leave the lobby (anyone). */
export async function editLobby(
  code: string,
  edit: (room: Room) => Partial<GameSettings & Pick<Room, "seats">>,
): Promise<void> {
  await saveRoom(async (tx) => {
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
      // Leave optional settings untouched when a player only edits seats.
      ...(next.startWithCash === undefined ? {} : { startWithCash: next.startWithCash }),
      ...(next.balancedCareers === undefined ? {} : { balancedCareers: next.balancedCareers }),
      ...(next.simultaneous === undefined ? {} : { simultaneous: next.simultaneous }),
      ...(next.botLevel ? { botLevel: next.botLevel } : {}),
      updatedAt: serverTimestamp(),
    });
  });
}

/** "Play again": once the game is won, take everyone back to the lobby with the same seats and settings. */
export async function playAgain(code: string, uid: string): Promise<void> {
  await saveRoom(async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (!snap.exists()) throw new RoomError("That room no longer exists.");
    const room = parseRoom(snap.data());
    if (room.status === "lobby") return;
    if (!room.over || !room.memberUids.includes(uid)) throw new RoomError("This game isn't over yet.");
    tx.update(roomRef(code), {
      status: "lobby",
      version: room.version + 1,
      stateJson: null,
      replayJson: null,
      currentUid: null,
      stageStartedAt: null,
      over: false,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function startGame(code: string): Promise<void> {
  await saveRoom(async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (!snap.exists()) throw new RoomError("That room no longer exists.");
    const room = parseRoom(snap.data());
    if (room.status !== "lobby") return;
    if (room.seats.length < MIN_PLAYERS) throw new RoomError(`You need at least ${MIN_PLAYERS} players.`);
    const created = newGame(
      room.seats.map((s) => ({ name: s.name, isBot: s.isBot })),
      room.target,
      room.botLevel,
      room.startWithCash,
      room.balancedCareers,
      room.simultaneous,
    );
    const state = beginRounds(created, d6) ?? created;
    tx.update(roomRef(code), {
      status: "playing",
      // Counting on from the last game, so devices never mistake the new game for an old move.
      version: room.version + 1,
      over: false,
      stateJson: JSON.stringify(state),
      replayJson: null,
      currentUid: seatUid(state, room.seats),
      ...(state.simul ? { stageStartedAt: serverTimestamp() } : {}),
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
  return saveRoom(async (tx) => {
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
      over: move.state.phase.t === "gameOver",
    };
    const newStage = !!saved.state?.simul && stageKey(saved.state) !== stageKey(room.state);
    tx.update(roomRef(code), {
      version: saved.version,
      stateJson: JSON.stringify(saved.state),
      replayJson: JSON.stringify(replay),
      currentUid: saved.currentUid,
      over: saved.over,
      // A new stage of a simultaneous round restarts the timer for everyone.
      ...(newStage ? { stageStartedAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp(),
    });
    return newStage ? { ...saved, stageStartedAt: null } : saved;
  });
}

/**
 * The host removes a player mid-game: their seat becomes a bot (saved as a normal move, so every
 * phone replays it) and their account leaves the room.
 */
export async function kickPlayer(code: string, hostUid: string, seat: number): Promise<Room | null> {
  return saveRoom(async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (!snap.exists()) return null;
    const room = parseRoom(snap.data());
    const kicked = room.seats[seat];
    if (room.status !== "playing" || !room.state || room.hostUid !== hostUid) return null;
    if (!kicked?.uid || kicked.uid === hostUid) return null;
    const simul = room.state.simul ? simulReplaceWithBot(room.state, seat, d6) : null;
    const move = simul ? { state: simul, actions: [] } : resolve(room.state, { type: "replaceWithBot", playerId: seat });
    if (!move) return null;
    const newStage = !!move.state.simul && stageKey(move.state) !== stageKey(room.state);
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
      over: move.state.phase.t === "gameOver",
    };
    tx.update(roomRef(code), {
      seats: saved.seats,
      memberUids: saved.memberUids,
      version: saved.version,
      stateJson: JSON.stringify(saved.state),
      replayJson: JSON.stringify(replay),
      currentUid: saved.currentUid,
      over: saved.over,
      ...(newStage ? { stageStartedAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp(),
    });
    return saved;
  });
}

export function watchRoom(code: string, onRoom: (room: Room | null) => void, onError: (e: Error) => void): () => void {
  return onSnapshot(
    roomRef(code),
    (snap) => {
      if (snap.exists() && !snap.metadata.hasPendingWrites && !snap.metadata.fromCache) noteServerTime(snap.data());
      onRoom(snap.exists() ? parseRoom(snap.data()) : null);
    },
    (e) => onError(e),
  );
}

/**
 * Read the room straight from the server, skipping the live listener. Phones sometimes let
 * the listener's connection go quiet (after the app was in the background, on a flaky
 * network) without any error, so the room screen checks this every so often to catch up.
 * It reads in a (read-only) transaction because those use the same plain requests as saving
 * a move; `getDocFromServer` would go through the live connection that may be stuck.
 */
export async function fetchRoom(code: string): Promise<Room | null> {
  return runTransaction(firebase().db, async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (snap.exists()) noteServerTime(snap.data());
    return snap.exists() ? parseRoom(snap.data()) : null;
  });
}

/** Whether `fresh` (read from the server) has news that `seen` (from the listener) is missing. */
export function isNewer(fresh: Room, seen: Room): boolean {
  if (fresh.version !== seen.version) return fresh.version > seen.version;
  if (fresh.status !== "lobby") return false;
  // Lobby edits (seats, settings) don't bump the version.
  const stamp = (r: Room) =>
    JSON.stringify([r.status, r.seats, r.target, r.botLevel, r.startWithCash, r.balancedCareers, r.simultaneous]);
  return stamp(fresh) !== stamp(seen);
}
