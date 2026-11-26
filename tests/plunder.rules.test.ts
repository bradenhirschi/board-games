import { readFileSync } from "node:fs";
import firebase from "firebase/compat/app";
import "firebase/compat/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";

// Plunder's online rooms (plunderRooms). Run with `npm run test:rules` (starts the Firestore emulator).

let env: RulesTestEnvironment;

const lobby = (over: Record<string, unknown> = {}) => ({
  code: "PLNDR",
  hostUid: "host",
  status: "lobby",
  seats: [{ uid: "host", name: "Host", color: "red", isBot: false }],
  memberUids: ["host"],
  version: 0,
  stateJson: null,
  replayJson: null,
  currentUid: null,
  ...over,
});

const playing = (over: Record<string, unknown> = {}) =>
  lobby({
    status: "playing",
    seats: [
      { uid: "host", name: "Host", color: "red", isBot: false },
      { uid: "amy", name: "Amy", color: "purple", isBot: false },
      { uid: null, name: "Bot", color: "green", isBot: true },
    ],
    memberUids: ["host", "amy"],
    version: 5,
    stateJson: "{}",
    currentUid: "amy",
    ...over,
  });

const db = (uid: string) => env.authenticatedContext(uid).firestore();
const room = (uid: string) => db(uid).doc("plunderRooms/PLNDR");

async function seed(data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc("plunderRooms/PLNDR").set(data);
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-stock-market",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8085 },
  });
});
afterAll(() => env.cleanup());
beforeEach(() => env.clearFirestore());

describe("plunder rooms", () => {
  it("need sign-in to read, and a valid code and own hosting to create", async () => {
    await seed(lobby());
    await assertFails(env.unauthenticatedContext().firestore().doc("plunderRooms/PLNDR").get());
    await assertSucceeds(room("stranger").get());
    await env.clearFirestore();
    await assertSucceeds(room("host").set(lobby()));
    await env.clearFirestore();
    await assertFails(room("amy").set(lobby()));
    await assertFails(
      db("host")
        .doc("plunderRooms/abc")
        .set(lobby({ code: "abc" })),
    );
  });

  it("take any code of 3+ letters and numbers, like Stock Market's rooms", async () => {
    for (const code of ["FAM", "FAMILY2026", "PLNDR"]) {
      await assertSucceeds(db("host").doc(`plunderRooms/${code}`).set(lobby({ code })));
    }
    for (const code of ["AB", "abc", "AB-12"]) {
      await assertFails(db("host").doc(`plunderRooms/${code}`).set(lobby({ code })));
    }
  });

  it("let players take or leave their own seat in the lobby, and only the host start", async () => {
    await seed(lobby());
    await assertSucceeds(
      room("amy").update({
        seats: [...lobby().seats, { uid: "amy", name: "Amy", color: "purple", isBot: false }],
        memberUids: ["host", "amy"],
      }),
    );
    await assertFails(room("amy").update({ memberUids: ["host", "amy", "bob"] }));
    await assertFails(room("amy").update({ status: "playing", version: 1 }));
    await assertSucceeds(room("host").update({ status: "playing", version: 1, stateJson: "{}" }));
  });

  it("let only the player the game waits on save the next version", async () => {
    await seed(playing());
    await assertSucceeds(room("amy").update({ version: 6, stateJson: "{}", currentUid: "host" }));
    await assertFails(room("amy").update({ version: 7 }));
    await assertSucceeds(room("host").update({ version: 7 }));
  });

  it("let any seated player play a bot, but not strangers", async () => {
    await seed(playing({ currentUid: null }));
    await assertSucceeds(room("amy").update({ version: 6 }));
    await assertFails(room("stranger").update({ version: 7 }));
  });

  it("block skipped versions and changes to seats mid-game", async () => {
    await seed(playing());
    await assertFails(room("amy").update({ version: 7 }));
    await assertFails(room("amy").update({ version: 6, seats: [] }));
    await assertFails(room("amy").update({ version: 6, memberUids: ["amy"] }));
  });
});

describe("plunder presence", () => {
  it("lets signed-in players see presence and update only their own entry", async () => {
    const data = { name: "Amy", status: "home", seenAt: firebase.firestore.FieldValue.serverTimestamp() };
    await assertSucceeds(db("amy").doc("plunderPresence/amy").set(data));
    await assertSucceeds(db("host").collection("plunderPresence").get());
    await assertFails(db("host").doc("plunderPresence/amy").set(data));
    await assertFails(env.unauthenticatedContext().firestore().collection("plunderPresence").get());
  });

  it("rejects client timestamps, unknown statuses and extra fields", async () => {
    const entry = db("amy").doc("plunderPresence/amy");
    const now = firebase.firestore.FieldValue.serverTimestamp();
    await assertFails(entry.set({ name: "Amy", status: "home", seenAt: new Date() }));
    await assertFails(entry.set({ name: "Amy", status: "sailing", seenAt: now }));
    await assertFails(entry.set({ name: "Amy", status: "home", seenAt: now, email: "amy@example.com" }));
  });
});

describe("reusing a room after its game", () => {
  const serverTime = firebase.firestore.FieldValue.serverTimestamp();
  const daysAgo = (days: number) => firebase.firestore.Timestamp.fromMillis(Date.now() - days * 86_400_000);
  const backToLobby = { status: "lobby", version: 6, stateJson: null, replayJson: null, currentUid: null, over: false };
  const ownLobby = (uid: string, seat: Record<string, unknown>) => ({
    hostUid: uid,
    status: "lobby",
    seats: [seat],
    memberUids: [uid],
    version: 6,
    stateJson: null,
    replayJson: null,
    currentUid: null,
    over: false,
    updatedAt: serverTime,
  });
  const zed = { uid: "stranger", name: "Zed", color: "red", isBot: false };

  it("lets any of the players take everyone back to the lobby once the game is over", async () => {
    await seed(playing({ over: true, currentUid: null }));
    await assertSucceeds(room("host").update(backToLobby));
    await seed(playing({ over: true, currentUid: null }));
    await assertSucceeds(room("amy").update(backToLobby));
  });
  it("doesn't let players end a game that isn't over, or strangers play again", async () => {
    await seed(playing());
    await assertFails(room("amy").update(backToLobby));
    await seed(playing({ over: true }));
    await assertFails(room("stranger").update(backToLobby));
    await assertFails(room("amy").update({ ...backToLobby, version: 9 }));
    await assertFails(room("amy").update({ ...backToLobby, hostUid: "amy" }));
  });
  it("lets anyone open a new lobby in a finished game's room", async () => {
    await seed(playing({ over: true, updatedAt: daysAgo(0) }));
    await assertSucceeds(room("stranger").update(ownLobby("stranger", zed)));
  });
  it("lets anyone open a new lobby in a room left alone for 12 hours", async () => {
    await seed(playing({ updatedAt: daysAgo(3) }));
    await assertSucceeds(room("stranger").update(ownLobby("stranger", zed)));
    await seed(lobby({ updatedAt: daysAgo(1) }));
    await assertSucceeds(room("stranger").update({ ...ownLobby("stranger", zed), version: 1 }));
  });
  it("doesn't let anyone take over a game in progress", async () => {
    await seed(playing({ updatedAt: daysAgo(0.1) }));
    await assertFails(room("stranger").update(ownLobby("stranger", zed)));
    await seed(playing());
    await assertFails(room("stranger").update(ownLobby("stranger", zed)));
  });
  it("only opens a lobby hosted by, and holding only, whoever reopens it", async () => {
    await seed(playing({ over: true }));
    await assertFails(room("stranger").update({ ...ownLobby("stranger", zed), hostUid: "amy" }));
    await assertFails(room("stranger").update({ ...ownLobby("stranger", zed), memberUids: ["stranger", "amy"] }));
    await assertFails(room("stranger").update({ ...ownLobby("stranger", zed), stateJson: "{}" }));
    await assertFails(room("stranger").update({ ...ownLobby("stranger", zed), version: 0 }));
  });
});
