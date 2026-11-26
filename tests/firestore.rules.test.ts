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

// Run with `npm run test:rules` (starts the Firestore emulator).

let env: RulesTestEnvironment;

const lobby = (over: Record<string, unknown> = {}) => ({
  code: "ABCDE",
  hostUid: "host",
  status: "lobby",
  target: 100000,
  seats: [{ uid: "host", name: "Host", isBot: false }],
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
      { uid: "host", name: "Host", isBot: false },
      { uid: "amy", name: "Amy", isBot: false },
      { uid: null, name: "Bot", isBot: true },
    ],
    memberUids: ["host", "amy"],
    version: 5,
    stateJson: "{}",
    currentUid: "amy",
    ...over,
  });

const db = (uid: string) => env.authenticatedContext(uid).firestore();
const room = (uid: string) => db(uid).doc("stockMarketRooms/ABCDE");

async function seed(data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc("stockMarketRooms/ABCDE").set(data);
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-stock-market",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});
afterAll(() => env.cleanup());
beforeEach(() => env.clearFirestore());

describe("reading", () => {
  it("needs sign-in", async () => {
    await seed(lobby());
    await assertFails(env.unauthenticatedContext().firestore().doc("stockMarketRooms/ABCDE").get());
    await assertSucceeds(room("stranger").get());
  });
});

describe("creating a room", () => {
  const newRoom = (uid: string, code: string) => db(uid).doc(`stockMarketRooms/${code}`);
  const newLobby = lobby({ code: "F01" });

  it("lets the host create rooms with three or more letters and numbers", async () => {
    for (const code of ["F01", "ABCD", "FAMILY2026"]) {
      await assertSucceeds(newRoom("host", code).set(lobby({ code })));
    }
  });
  it("can't name someone else as host or start mid-game", async () => {
    await assertFails(newRoom("amy", "F01").set(newLobby));
    await assertFails(newRoom("host", "F01").set({ ...newLobby, status: "playing" }));
  });
  it("rejects new rooms with lowercase, short, or non-alphanumeric codes", async () => {
    for (const code of ["abc", "AB", "ABC-123"]) {
      await assertFails(newRoom("host", code).set(lobby({ code })));
    }
  });
});

describe("online presence", () => {
  it("lets signed-in players see presence and update only their own entry", async () => {
    const data = { name: "Amy", status: "lobby", seenAt: firebase.firestore.FieldValue.serverTimestamp() };
    await assertSucceeds(db("amy").doc("stockMarketPresence/amy").set(data));
    await assertSucceeds(db("host").collection("stockMarketPresence").get());
    await assertFails(db("host").doc("stockMarketPresence/amy").set(data));
    await assertFails(env.unauthenticatedContext().firestore().collection("stockMarketPresence").get());
  });

  it("rejects client timestamps and private fields in public presence", async () => {
    const entry = db("amy").doc("stockMarketPresence/amy");
    await assertFails(entry.set({ name: "Amy", status: "home", seenAt: new Date() }));
    await assertFails(entry.set({ name: "Amy", status: "home", seenAt: firebase.firestore.FieldValue.serverTimestamp(), email: "amy@example.com" }));
  });
});

describe("the lobby", () => {
  beforeEach(() => seed(lobby()));

  it("lets a player take their own seat", async () => {
    await assertSucceeds(
      room("amy").update({
        seats: [...lobby().seats, { uid: "amy", name: "Amy", isBot: false }],
        memberUids: ["host", "amy"],
      }),
    );
  });
  it("doesn't let a player seat someone else, or remove others", async () => {
    await assertFails(room("amy").update({ memberUids: ["host", "bob"] }));
    await assertFails(room("amy").update({ memberUids: [] }));
  });
  it("doesn't let a non-host change settings or start the game", async () => {
    await assertFails(room("amy").update({ target: 5 }));
    await assertFails(room("amy").update({ status: "playing", version: 1 }));
  });
  it("lets only the host change the starting cash switch and requires a boolean", async () => {
    await assertFails(room("amy").update({ startWithCash: true }));
    await assertFails(room("host").update({ startWithCash: "on" }));
    await assertSucceeds(room("host").update({ startWithCash: true }));
    await assertSucceeds(room("host").update({ startWithCash: false }));
  });
  it("lets only the host change the balanced occupations switch and requires a boolean", async () => {
    await assertFails(room("amy").update({ balancedCareers: true }));
    await assertFails(room("host").update({ balancedCareers: "on" }));
    await assertSucceeds(room("host").update({ balancedCareers: true }));
    await assertSucceeds(room("host").update({ balancedCareers: false }));
  });
  it("lets only the host change the simultaneous turns switch and requires a boolean", async () => {
    await assertFails(room("amy").update({ simultaneous: true }));
    await assertFails(room("host").update({ simultaneous: "on" }));
    await assertSucceeds(room("host").update({ simultaneous: true }));
  });

  it("lets only the host choose the bot level", async () => {
    await seed(lobby({ memberUids: ["host", "amy"] }));
    await assertFails(room("amy").update({ botLevel: "easy" }));
    await assertSucceeds(room("host").update({ botLevel: "easy" }));
  });
  it("lets a player leave a room that has no bot level saved", async () => {
    await seed(lobby({ memberUids: ["host", "amy"] }));
    await assertSucceeds(room("amy").update({ memberUids: ["host"] }));
  });
  it("lets the host start the game", async () => {
    await assertSucceeds(room("host").update({ status: "playing", version: 1, stateJson: "{}" }));
  });
});

describe("during a game", () => {
  beforeEach(() => seed(playing()));

  it("lets the player whose turn it is save the next version", async () => {
    await assertSucceeds(room("amy").update({ version: 6, stateJson: "{}", currentUid: null }));
  });
  it("blocks other players on someone else's turn", async () => {
    await seed(playing({ currentUid: "host" }));
    await assertFails(room("amy").update({ version: 6 }));
  });
  it("blocks skipped or repeated versions", async () => {
    await assertFails(room("amy").update({ version: 7 }));
    await assertFails(room("amy").update({ version: 5 }));
  });
  it("lets any seated player run a bot's turn", async () => {
    await seed(playing({ currentUid: null }));
    await assertSucceeds(room("amy").update({ version: 6 }));
    await assertFails(room("stranger").update({ version: 7 }));
  });
  it("gives the host no special right to write on someone else's turn", async () => {
    await assertFails(room("host").update({ version: 6 }));
  });
  it("keeps the starting cash setting fixed during play", async () => {
    await assertFails(room("amy").update({ version: 6, startWithCash: true }));
  });
  it("keeps the balanced occupations setting fixed during play", async () => {
    await assertFails(room("amy").update({ version: 6, balancedCareers: true }));
  });
  it("keeps the simultaneous turns setting fixed during play", async () => {
    await assertFails(room("amy").update({ version: 6, simultaneous: true }));
  });

  it("never lets the bot level change mid-game", async () => {
    await assertFails(room("amy").update({ version: 6, botLevel: "easy" }));
  });
  it("never lets seats or membership change", async () => {
    await assertFails(room("amy").update({ version: 6, memberUids: ["amy"] }));
    await assertFails(room("amy").update({ version: 6, seats: [] }));
  });
});

describe("simultaneous rounds", () => {
  const now = () => firebase.firestore.FieldValue.serverTimestamp();
  beforeEach(() => seed(playing({ simultaneous: true, currentUid: null })));

  it("let any seated player save the next version", async () => {
    await assertSucceeds(room("amy").update({ version: 6 }));
    await assertSucceeds(room("host").update({ version: 7 }));
    await assertFails(room("stranger").update({ version: 8 }));
  });
  it("start a stage's timer only at the server's time", async () => {
    await assertSucceeds(room("amy").update({ version: 6, stageStartedAt: now() }));
    await assertFails(room("amy").update({ version: 7, stageStartedAt: new Date(Date.now() - 60_000) }));
  });
});

describe("removing a player mid-game", () => {
  const kicked = {
    seats: [
      { uid: "host", name: "Host", isBot: false },
      { uid: null, name: "Amy", isBot: true },
      { uid: null, name: "Bot", isBot: true },
    ],
    memberUids: ["host"],
    version: 6,
    currentUid: null,
  };
  it("is allowed for the host", async () => {
    await seed(playing());
    await assertSucceeds(room("host").update(kicked));
  });
  it("isn't allowed for anyone else", async () => {
    await seed(playing());
    await assertFails(room("amy").update({ ...kicked, memberUids: ["amy"] }));
  });
  it("can't add members, drop the host, or skip a version", async () => {
    await seed(playing());
    await assertFails(room("host").update({ ...kicked, memberUids: ["host", "zed"] }));
    await assertFails(room("host").update({ ...kicked, memberUids: [] }));
    await assertFails(room("host").update({ ...kicked, version: 9 }));
    await assertFails(room("host").update({ ...kicked, seats: kicked.seats.slice(0, 2) }));
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
  const zed = { uid: "stranger", name: "Zed", isBot: false };

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
