@AGENTS.md

# Board Games

A Next.js site hosting several board games that share one Firebase project (`braden-board-games`),
one set of player accounts, and a shared online-play layer. See README.md for the full layout.

- Games: **Stock Market** (`games/stock-market/`, at `/stock-market`, playable) and **Plunder**, a pirate
  ship combat and exploration game in development (planned at `games/plunder/`, `/plunder`).
- `platform/` holds everything shared: Firebase and sign-in, online rooms (`rooms.ts`), the game contract
  (`game.ts`), move syncing (`useRoomSync.ts`), the lobby and online start panel, sound, dice, storage.
- `games/<id>/` holds everything specific to one game. Games import from `platform/`; `platform/` never
  imports from a game, and games don't import from each other. If two games need the same thing, move it
  into `platform/`.

## Rules for game code

- Game rules are pure: `reducer(state, action) -> state`, no randomness, I/O or time inside. Dice, card
  draws and other randomness are decided in the game's `resolve` and stored in the action, so every phone
  can replay a move and get the same state. Keep state JSON-serializable.
- Each game has its own Firestore collection (`<camelCaseId>Rooms`) and its own block in `firestore.rules`
  built from the shared room functions. Add rules tests in `tests/` for any change to the rules.
- Prefix a game's localStorage keys with `<id>:`; site-wide ones use `board-games:`.
- Don't change a saved state's shape without handling old saves (local saves and rooms in progress).
- Plunder needs **hidden information** (not simultaneous turns yet). A room's state is currently one
  document every player can read; see "Hidden information" in README.md for the options and pick one with
  the owner before building it.

## Checks

```bash
npm test             # rules engine tests (vitest)
npm run test:rules   # Firestore security rules tests (emulator, needs Java)
npx tsc --noEmit && npm run lint
npm run build
```

Online play against local emulators:
`npx firebase emulators:start --project demo-board-games --only auth,firestore`, then
`NEXT_PUBLIC_FIREBASE_EMULATORS=1 npm run dev`.
