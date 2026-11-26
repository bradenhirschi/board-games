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
