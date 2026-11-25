"use client";

import { BOT_LEVELS, BOT_LEVEL_NAMES, DEFAULT_TARGET, fmt, type BotLevel, type GameSettings } from "../lib/engine";

const TARGETS = [25_000, 50_000, DEFAULT_TARGET, 250_000];

interface GameSettingsFieldsProps {
  settings: GameSettings;
  hasBots: boolean;
  disabled?: boolean;
  /** Online lobbies also offer simultaneous turns. */
  online?: boolean;
  onChange: (change: Partial<GameSettings>) => void;
}

export default function GameSettingsFields({ settings, hasBots, disabled, online, onChange }: GameSettingsFieldsProps) {
  const { target, botLevel, startWithCash, balancedCareers, simultaneous = false } = settings;

  return (
    <>
      <label className="setup-target">
        <span>Winning amount</span>
        <select
          value={target}
          disabled={disabled}
          onChange={(event) => onChange({ target: Number(event.currentTarget.value) })}
        >
          {TARGETS.map((amount) => (
            <option key={amount} value={amount}>
              ${fmt(amount)}
              {amount === DEFAULT_TARGET ? " (standard)" : ""}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="stock-cash-switch"
        role="switch"
        aria-checked={startWithCash}
        disabled={disabled}
        onClick={() => onChange({ startWithCash: !startWithCash })}
      >
        <span>Everyone starts with $1000</span>
        <span className={startWithCash ? "switch switch-on" : "switch"} aria-hidden="true"><span /></span>
      </button>
      <button
        type="button"
        className="stock-cash-switch"
        role="switch"
        aria-checked={balancedCareers}
        disabled={disabled}
        title="Policeman pays $150 and Prospector $600, so every occupation pays the same per throw on average"
        onClick={() => onChange({ balancedCareers: !balancedCareers })}
      >
        <span>Balanced occupations</span>
        <span className={balancedCareers ? "switch switch-on" : "switch"} aria-hidden="true"><span /></span>
      </button>
      {online && (
        <button
          type="button"
          className="stock-cash-switch"
          role="switch"
          aria-checked={simultaneous}
          disabled={disabled}
          title="Everyone takes their turn at the same time, in private: 60 seconds to sell and roll, then 90 to buy and sell"
          onClick={() => onChange({ simultaneous: !simultaneous })}
        >
          <span>Simultaneous turns</span>
          <span className={simultaneous ? "switch switch-on" : "switch"} aria-hidden="true"><span /></span>
        </button>
      )}
      {hasBots && (
        <label className="setup-target">
          <span>Bots</span>
          <select
            value={botLevel}
            disabled={disabled}
            onChange={(event) => onChange({ botLevel: event.currentTarget.value as BotLevel })}
          >
            {BOT_LEVELS.map((level) => (
              <option key={level} value={level}>
                {BOT_LEVEL_NAMES[level]}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}
