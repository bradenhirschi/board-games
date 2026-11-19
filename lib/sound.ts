"use client";

import { useSyncExternalStore } from "react";

/**
 * Game sounds, synthesized with the Web Audio API (no audio files to load).
 *
 * Browsers only allow sound after the page has been tapped or clicked, so the audio
 * context is created lazily and resumed on the first interaction.
 */

const MUTE_KEY = "stock-market:muted";

let ctx: AudioContext | null = null;
let muted = readMuted();
const listeners = new Set<() => void>();

function readMuted(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// Unlock audio on the first tap/click/key so later sounds (e.g. another player's roll) can play.
if (typeof window !== "undefined") {
  const unlock = () => {
    audio();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    // Private mode etc.: the setting just won't be remembered.
  }
  listeners.forEach((l) => l());
}

/** The current mute setting, kept in sync across components. */
export function useMuted(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => muted,
    () => false,
  );
}

let noise: AudioBuffer | null = null;
function noiseBuffer(ac: AudioContext): AudioBuffer {
  if (!noise || noise.sampleRate !== ac.sampleRate) {
    noise = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.1), ac.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

/** One die hitting the table: a short filtered noise burst plus a little wooden "tock". */
function clack(ac: AudioContext, out: AudioNode, at: number, level: number) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 2200 + Math.random() * 1800;
  band.Q.value = 3 + Math.random() * 3;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + 0.002);
  g.gain.exponentialRampToValueAtTime(0.001, at + 0.03 + Math.random() * 0.02);
  src.connect(band).connect(g).connect(out);
  src.start(at, Math.random() * 0.05, 0.06);

  const tone = ac.createOscillator();
  tone.type = "triangle";
  tone.frequency.setValueAtTime(700 + Math.random() * 500, at);
  const tg = ac.createGain();
  tg.gain.setValueAtTime(level * 0.35, at);
  tg.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
  tone.connect(tg).connect(out);
  tone.start(at);
  tone.stop(at + 0.05);
}

/** Two dice rattling and settling: impacts that get quieter and closer together. */
export function playDice() {
  if (muted) return;
  const ac = audio();
  if (!ac) return;
  const out = ac.createGain();
  out.gain.value = 0.55;
  out.connect(ac.destination);
  const start = ac.currentTime + 0.01;
  for (let die = 0; die < 2; die++) {
    let t = start + die * 0.025 + Math.random() * 0.02;
    let gap = 0.09 + Math.random() * 0.03;
    let level = 0.9;
    const hits = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < hits; i++) {
      clack(ac, out, t, level * (0.75 + Math.random() * 0.25));
      t += gap;
      gap *= 0.78;
      level *= 0.78;
    }
  }
}

/** A single bright bell "ding" (a few inharmonic partials, like a desk bell). */
export function playBell() {
  if (muted) return;
  const ac = audio();
  if (!ac) return;
  const at = ac.currentTime + 0.01;
  const base = 1320;
  const partials: [ratio: number, level: number, decay: number][] = [
    [1, 0.5, 1.6],
    [2.0, 0.18, 1.1],
    [2.76, 0.12, 0.8],
    [5.4, 0.05, 0.4],
  ];
  const out = ac.createGain();
  out.gain.value = 0.35;
  out.connect(ac.destination);
  for (const [ratio, level, decay] of partials) {
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.value = base * ratio;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0005, at + decay);
    osc.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + decay + 0.05);
  }
}

/** A cash register: a mechanical "ca" (drawer clack) then a bright "ching". */
export function playCash() {
  if (muted) return;
  const ac = audio();
  if (!ac) return;
  const at = ac.currentTime + 0.01;
  const out = ac.createGain();
  out.gain.value = 0.4;
  out.connect(ac.destination);

  // "Ca": two quick low clacks.
  clack(ac, out, at, 0.8);
  clack(ac, out, at + 0.045, 0.6);

  // "Ching": a cluster of high, slightly detuned partials that ring out.
  const ching = at + 0.08;
  const partials: [freq: number, level: number, decay: number][] = [
    [2637, 0.35, 0.9],
    [2660, 0.25, 0.9],
    [3951, 0.22, 0.7],
    [5274, 0.14, 0.5],
    [6650, 0.08, 0.35],
  ];
  for (const [freq, level, decay] of partials) {
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, ching);
    g.gain.linearRampToValueAtTime(level, ching + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0005, ching + decay);
    osc.connect(g).connect(out);
    osc.start(ching);
    osc.stop(ching + decay + 0.05);
  }
}

/** A short "womp womp": two falling, slightly sagging horn notes. */
export function playLoss() {
  if (muted) return;
  const ac = audio();
  if (!ac) return;
  const at = ac.currentTime + 0.01;
  const out = ac.createGain();
  out.gain.value = 0.22;
  const tone = ac.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 1400;
  tone.connect(out).connect(ac.destination);

  const notes: [start: number, from: number, to: number, length: number][] = [
    [0, 311, 294, 0.24],
    [0.28, 262, 220, 0.5],
  ];
  for (const [offset, from, to, length] of notes) {
    const t0 = at + offset;
    const osc = ac.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.linearRampToValueAtTime(to, t0 + length);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(1, t0 + 0.03);
    g.gain.setValueAtTime(1, t0 + length * 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + length);
    osc.connect(g).connect(tone);
    osc.start(t0);
    osc.stop(t0 + length + 0.02);
  }
}
