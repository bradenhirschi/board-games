"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const BUTTON_STEP = 1.4;
/** Ctrl+wheel / trackpad pinch: commit the crisp re-layout once the gesture pauses this long. */
const WHEEL_SETTLE_MS = 140;

const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * Makes the board zoomable and pannable without jank.
 *
 * The board is laid out in units of its own width, so a wider board re-lays out crisply.
 * Re-laying out on every frame of a gesture would stutter, though, so while a pinch (or
 * Ctrl+wheel) is in progress the board is just scaled with a CSS transform (cheap, on the
 * GPU); when the gesture ends the new width is committed once and the transform dropped.
 * The point under the fingers or cursor stays put throughout.
 */
export default function ZoomableBoard({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  // Scroll position to apply right after a committed zoom renders (keeps the focal point fixed).
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);
  // An in-progress gesture: preview scale relative to the committed zoom, around a focal point.
  const preview = useRef<{ scale: number; cx: number; cy: number } | null>(null);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    const p = pendingScroll.current;
    const el = viewport.current;
    if (p && el) {
      el.scrollLeft = p.left;
      el.scrollTop = p.top;
      pendingScroll.current = null;
    }
  }, [zoom]);

  /** Show a cheap scaled preview around (cx, cy), relative to the viewport's top-left. */
  const showPreview = useCallback((scale: number, cx: number, cy: number) => {
    const el = viewport.current;
    const board = inner.current;
    if (!el || !board) return;
    preview.current = { scale, cx, cy };
    board.style.transformOrigin = `${el.scrollLeft + cx}px ${el.scrollTop + cy}px`;
    board.style.transform = `scale(${scale})`;
  }, []);

  /** Re-lay out at `target` zoom, keeping the point at (cx, cy) where it is on screen. */
  const commit = useCallback((target: number, cx: number, cy: number) => {
    const el = viewport.current;
    const board = inner.current;
    if (!el || !board) return;
    const z0 = zoomRef.current;
    const z1 = clamp(target);
    const k = z1 / z0;
    pendingScroll.current = { left: (el.scrollLeft + cx) * k - cx, top: (el.scrollTop + cy) * k - cy };
    preview.current = null;
    zoomRef.current = z1;
    // Drop the preview transform and lay out at the new size in the same frame.
    flushSync(() => setZoom(z1));
    board.style.transform = "";
  }, []);

  const center = () => {
    const el = viewport.current;
    return el ? [el.clientWidth / 2, el.clientHeight / 2] : [0, 0];
  };

  // Trackpad pinch (Chrome/Firefox/Edge send it as Ctrl+wheel) and Ctrl+mouse wheel.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // plain scrolling pans natively
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const z0 = zoomRef.current;
      const current = preview.current?.scale ?? 1;
      const next = clamp(z0 * current * Math.exp(-e.deltaY * 0.01)) / z0;
      showPreview(next, preview.current?.cx ?? cx, preview.current?.cy ?? cy);
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => {
        const p = preview.current;
        if (p) commit(z0 * p.scale, p.cx, p.cy);
      }, WHEEL_SETTLE_MS);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [showPreview, commit]);

  // Two-finger pinch on touch screens. One finger is left to the browser's native panning.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    let start: { dist: number; cx: number; cy: number } | null = null;
    const measure = (t: TouchList) => {
      const rect = el.getBoundingClientRect();
      const [a, b] = [t[0], t[1]];
      return {
        dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        cx: (a.clientX + b.clientX) / 2 - rect.left,
        cy: (a.clientY + b.clientY) / 2 - rect.top,
      };
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) start = measure(e.touches);
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault(); // no page zoom or scrolling while pinching the board
      const m = measure(e.touches);
      const z0 = zoomRef.current;
      showPreview(clamp((z0 * m.dist) / start.dist) / z0, start.cx, start.cy);
    };
    const onEnd = (e: TouchEvent) => {
      if (!start || e.touches.length >= 2) return;
      const p = preview.current;
      if (p) commit(zoomRef.current * p.scale, p.cx, p.cy);
      start = null;
    };
    // Safari's own gesture events would zoom the whole page; the touch handlers above do the work.
    const stopGesture = (e: Event) => e.preventDefault();
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    el.addEventListener("gesturestart", stopGesture);
    el.addEventListener("gesturechange", stopGesture);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      el.removeEventListener("gesturestart", stopGesture);
      el.removeEventListener("gesturechange", stopGesture);
    };
  }, [showPreview, commit]);

  // Desktop trackpads in Safari pinch with gesture events (e.scale) instead of Ctrl+wheel.
  useEffect(() => {
    const el = viewport.current;
    if (!el || "ontouchstart" in window) return;
    type GestureEvent = Event & { scale: number; clientX: number; clientY: number };
    let z0 = 1;
    let focal = [0, 0];
    const onStart = (e: Event) => {
      const g = e as GestureEvent;
      e.preventDefault();
      z0 = zoomRef.current;
      const rect = el.getBoundingClientRect();
      focal = [g.clientX - rect.left, g.clientY - rect.top];
    };
    const onChange = (e: Event) => {
      e.preventDefault();
      showPreview(clamp(z0 * (e as GestureEvent).scale) / z0, focal[0], focal[1]);
    };
    const onEnd = (e: Event) => {
      e.preventDefault();
      const p = preview.current;
      if (p) commit(z0 * p.scale, p.cx, p.cy);
    };
    el.addEventListener("gesturestart", onStart);
    el.addEventListener("gesturechange", onChange);
    el.addEventListener("gestureend", onEnd);
    return () => {
      el.removeEventListener("gesturestart", onStart);
      el.removeEventListener("gesturechange", onChange);
      el.removeEventListener("gestureend", onEnd);
    };
  }, [showPreview, commit]);

  // Drag with the mouse to pan when zoomed in (a short drag still counts as a click).
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    let drag: { x: number; y: number; left: number; top: number; moved: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0 || zoomRef.current <= MIN_ZOOM) return;
      drag = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      el.classList.add("dragging");
      el.scrollLeft = drag.left - dx;
      el.scrollTop = drag.top - dy;
    };
    const onUp = () => {
      if (drag?.moved) {
        // Swallow the click that ends a drag so it doesn't press a square.
        const swallow = (ev: Event) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        el.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 0);
      }
      drag = null;
      el.classList.remove("dragging");
    };
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const zoomBy = (factor: number) => {
    const [cx, cy] = center();
    commit(zoomRef.current * factor, cx, cy);
  };

  return (
    <div className="board-zoom">
      <div ref={viewport} className={`board-viewport ${zoom > MIN_ZOOM ? "zoomed" : ""}`}>
        <div ref={inner} className="board-wrap" style={{ width: `${zoom * 100}%` }}>
          {children}
        </div>
      </div>
      <div className="zoom-controls" role="group" aria-label="Board zoom">
        <button onClick={() => zoomBy(BUTTON_STEP)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in">
          +
        </button>
        <button onClick={() => zoomBy(1 / BUTTON_STEP)} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out">
          −
        </button>
        <button onClick={() => zoomBy(MIN_ZOOM / zoomRef.current)} disabled={zoom <= MIN_ZOOM} aria-label="Fit board">
          Fit
        </button>
      </div>
    </div>
  );
}
