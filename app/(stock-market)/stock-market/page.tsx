"use client";

import { useEffect, useId, useState } from "react";
import LocalGame, { SAVE_KEY } from "@/games/stock-market/components/Game";
import GameSettingsFields from "@/games/stock-market/components/GameSettingsFields";
import OnlineRoom from "@/games/stock-market/components/OnlineRoom";
import StockMarketHeader from "@/games/stock-market/components/StockMarketHeader";
import {
  DEFAULT_TARGET,
  MAX_PLAYERS,
  MIN_PLAYERS,
  playerColor,
  newGame,
  type GameState,
  type PlayerSetup,
  type GameSettings,
} from "@/games/stock-market/lib/engine";
import {
  authErrorMessage,
  ensureUser,
  onlineAvailable,
  useFirebaseUser,
} from "@/shared/firebase";
import { enterRoom, isRoomCode, normalizeCode, ROOM_CODE_MAX_LENGTH } from "@/games/stock-market/lib/rooms";
import { useStockMarketPresence, type PresenceStatus } from "@/games/stock-market/lib/presence";

const NAME_KEY = "stock-market:name";
const TAB_KEY = "stock-market:home-tab";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

/** Keep the room code in the address bar so the page can be refreshed or shared. */
function setRoomInUrl(code: string | null) {
  const url = new URL(window.location.href);
  if (code) url.searchParams.set("room", code);
  else url.searchParams.delete("room");
  window.history.replaceState(null, "", url);
}

function loadSaved(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const s = raw ? (JSON.parse(raw) as GameState) : null;
    return s && s.version === 3 && s.phase.t !== "gameOver" ? s : null;
  } catch {
    return null;
  }
}

export default function Home() {
  const [players, setPlayers] = useState<PlayerSetup[]>([
    { name: "Player 1", isBot: false },
    { name: "Bot 1", isBot: true },
  ]);
  const [settings, setSettings] = useState<GameSettings>({
    target: DEFAULT_TARGET,
    botLevel: "normal",
    startWithCash: false,
    balancedCareers: false,
  });
  const [game, setGame] = useState<{ key: number; state: GameState } | null>(null);
  const [saved, setSaved] = useState<GameState | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [localSetup, setLocalSetup] = useState(false);
  const [roomStatus, setRoomStatus] = useState<PresenceStatus | undefined>(undefined);
  const [presenceError, setPresenceError] = useState(false);
  const user = useFirebaseUser();
  const { players: onlinePlayers, unavailable } = useStockMarketPresence(
    user?.uid,
    name.trim() || "Player",
    roomStatus ?? (game ? "playing" : "home"),
    !room && !game && !localSetup,
  );

  useEffect(() => {
    if (onlineAvailable) void ensureUser().catch(() => setPresenceError(true));
  }, []);

  const updateName = (value: string) => {
    setName(value);
    writeStorage(NAME_KEY, value);
  };
  const [tab, setTab] = useState<Tab>(onlineAvailable ? "online" : "local");

  useEffect(() => {
    // Reading storage and the URL must wait until we're in the browser.
    /* eslint-disable react-hooks/set-state-in-effect */
    setSaved(loadSaved());
    setName(readStorage(NAME_KEY) ?? "");
    const savedTab = readStorage(TAB_KEY);
    if (savedTab === "local" || (savedTab === "online" && onlineAvailable)) setTab(savedTab);
    const fromUrl = normalizeCode(new URLSearchParams(window.location.search).get("room") ?? "");
    if (isRoomCode(fromUrl) && onlineAvailable) setRoom(fromUrl);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [game]);

  const openRoom = (code: string) => {
    setRoomInUrl(code);
    setRoom(code);
  };

  const header = <StockMarketHeader user={user} name={name} setName={updateName} />;

  if (room) {
    return (
      <OnlineRoom
        key={`${room}:${user?.uid ?? ""}`}
        code={room}
        uid={user?.uid}
        connectionError={presenceError && !user}
        header={header}
        name={name.trim() || "Player"}
        onStatusChange={setRoomStatus}
        onQuit={() => {
          setRoomStatus(undefined);
          setRoomInUrl(null);
          setRoom(null);
        }}
      />
    );
  }

  const leaveLocalGame = () => {
    setGame(null);
    setLocalSetup(false);
  };

  const update = (i: number, patch: Partial<PlayerSetup>) =>
    setPlayers(players.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const start = () => {
    const clean = players.map((p, i) => ({ ...p, name: p.name.trim() || `Player ${i + 1}` }));
    setGame({
      key: Date.now(),
      state: newGame(clean, settings.target, settings.botLevel, settings.startWithCash, settings.balancedCareers),
    });
  };

  if (game) return <LocalGame key={game.key} initial={game.state} onQuit={leaveLocalGame} />;

  if (localSetup) {
    return (
      <main className="setup">
        <div className="setup-card">
          <button type="button" className="link" onClick={() => setLocalSetup(false)}>Back to home</button>
          <h1 className="setup-logo">New local game</h1>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              start();
            }}
          >
            {players.map((p, i) => (
              <div key={i} className="setup-row">
                <span className="token token-static" style={{ background: playerColor(i) }}>
                  {(p.name.trim() || "P").slice(0, 1).toUpperCase()}
                </span>
                <input
                  value={p.name}
                  maxLength={16}
                  aria-label={`Player ${i + 1} name`}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
                <div className="seg" role="group" aria-label={`Player ${i + 1} type`}>
                  <button type="button" className={!p.isBot ? "on" : ""} onClick={() => update(i, { isBot: false })}>
                    Human
                  </button>
                  <button type="button" className={p.isBot ? "on" : ""} onClick={() => update(i, { isBot: true })}>
                    Bot
                  </button>
                </div>
                <button
                  type="button"
                  className="link small"
                  disabled={players.length <= MIN_PLAYERS}
                  onClick={() => setPlayers(players.filter((_, j) => j !== i))}
                  aria-label={`Remove player ${i + 1}`}
                >
                  ✕
                </button>
              </div>
            ))}
            {players.length < MAX_PLAYERS && (
              <div className="btn-row">
                <button
                  type="button"
                  className="link"
                  onClick={() => setPlayers([...players, { name: `Player ${players.length + 1}`, isBot: false }])}
                >
                  + Add player
                </button>
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    setPlayers([
                      ...players,
                      { name: `Bot ${players.filter((p) => p.isBot).length + 1}`, isBot: true },
                    ])
                  }
                >
                  + Add bot
                </button>
              </div>
            )}

            <GameSettingsFields
              settings={settings}
              hasBots={players.some((player) => player.isBot)}
              onChange={(change) => setSettings((current) => ({ ...current, ...change }))}
            />

            <button type="submit" className="btn btn-primary btn-big">
              Start game
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="setup">
      <div className="setup-card">
        {header}

        {onlineAvailable && (
          <div className="home-tabs" role="group" aria-label="Play mode">
            {(
              [
                ["online", "Online"],
                ["local", "On this device"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={tab === id}
                className={tab === id ? "on" : ""}
                onClick={() => {
                  setTab(id);
                  writeStorage(TAB_KEY, id);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {tab === "online" && onlineAvailable && (
          <OnlineStart name={name} setName={updateName} onOpenRoom={openRoom} />
        )}

        {tab === "local" && (
          <section className="local-start">
            {saved && (
              <div className="saved">
                <span>Game in progress · {saved.players.map((p) => p.name).join(", ")}</span>
                <button className="btn btn-primary" onClick={() => setGame({ key: Date.now(), state: saved })}>
                  Continue
                </button>
              </div>
            )}

            <button type="button" className="btn btn-primary" onClick={() => setLocalSetup(true)}>
              New local game
            </button>
          </section>
        )}

        {onlineAvailable && (
          <section className="stock-home-roster" aria-labelledby="stock-home-roster-title">
            <h2 className="home-heading" id="stock-home-roster-title">
              <span aria-hidden="true" />
              {onlinePlayers && !unavailable ? `${onlinePlayers.length} online now` : "Online now"}
            </h2>
            {unavailable || (presenceError && !user) ? (
              <p className="muted">Online players are temporarily unavailable.</p>
            ) : !onlinePlayers ? (
              <p className="muted">Checking who’s online…</p>
            ) : onlinePlayers.length === 0 ? (
              <p className="muted">Nobody is online.</p>
            ) : (
              <ul>
                {onlinePlayers.map((player) => (
                  <li key={player.uid}>
                    <span><b aria-hidden="true">{player.name.charAt(0).toUpperCase()}</b>{player.name}{player.uid === user?.uid && " (you)"}</span>
                    <small className="muted">{PRESENCE_LABELS[player.status]}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

type Tab = "online" | "local";
const PRESENCE_LABELS: Record<PresenceStatus, string> = {
  home: "On home screen",
  lobby: "Waiting in room",
  playing: "In a game",
};

function OnlineStart({
  name,
  setName,
  onOpenRoom,
}: {
  name: string;
  setName: (name: string) => void;
  onOpenRoom: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeId = useId();

  const join = async () => {
    if (busy) return;
    if (!isRoomCode(code)) {
      setError("Enter a room code with at least 3 letters or numbers.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await ensureUser();
      await enterRoom(code, user.uid, name.trim() || "Player");
      onOpenRoom(code);
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="online-start">
      <label className="stock-home-field">
        <span className="home-label">Your name</span>
        <input value={name} maxLength={16} placeholder="Player" autoComplete="nickname" onChange={(e) => setName(e.target.value)} />
      </label>
      <form
        className="stock-home-room-form"
        onSubmit={(e) => {
          e.preventDefault();
          void join();
        }}
      >
        <label className="home-label" htmlFor={codeId}>Room code</label>
        <div className="join-form">
          <input
            id={codeId}
            value={code}
            placeholder="e.g. FAM"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={ROOM_CODE_MAX_LENGTH}
            aria-describedby={`${codeId}-hint`}
            onChange={(e) => setCode(normalizeCode(e.target.value))}
          />
          <button className="btn btn-primary" disabled={busy}>{busy ? "Joining…" : "Join"}</button>
        </div>
        <small className="muted" id={`${codeId}-hint`}>Pick a code to open a room, or enter the code your friends are using.</small>
      </form>
      {error && <p className="hint bad" role="alert">{error}</p>}
    </section>
  );
}
