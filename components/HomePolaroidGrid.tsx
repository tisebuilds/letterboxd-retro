"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import { PolaroidCard } from "@/components/PolaroidCard";
import type { Film } from "@/types/film";

/** Match PolaroidCard outer box-border size (160×284). */
const CARD_W = 160;
const CARD_H = 284;
const GAP_X = 48;
const GAP_Y = 48;
/** Extra space around the grid so panning feels open before content thins out. */
const CANVAS_MARGIN = 960;
/** World-space pad when deciding which tiles intersect the viewport (keeps neighbors mounted). */
const TILE_VIEW_MARGIN_PX = 360;
/** Cap tile span so pathological tiny viewports do not mount thousands of cells. */
const MAX_TILES_PER_AXIS = 7;
/** Extra margin around the viewport for mounting polaroids before they scroll on-screen. */
const ITEM_CULL_MARGIN_PX = 420;

/** Spacebar burst: must match `polaroid-burst-at-camera` duration in globals.css. */
const BURST_ANIM_MS = 900;
const BURST_STAGGER_SLOTS = 24;
const BURST_STAGGER_STEP_MS = 12;

function burstStaggerDelayMs(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return (h % BURST_STAGGER_SLOTS) * BURST_STAGGER_STEP_MS;
}

/** Unit vector from viewport center through this card, scaled so each polaroid flies outward (not toward center). */
function burstOutwardOffsetPx(
  slotLeft: number,
  slotTop: number,
  canvasOriginX: number,
  canvasOriginY: number,
  panX: number,
  panY: number,
  vw: number,
  vh: number,
  key: string
): { x: number; y: number } {
  if (vw < 2 || vh < 2) {
    return { x: 0, y: -720 };
  }
  const cx = canvasOriginX + panX + slotLeft + CARD_W / 2;
  const cy = canvasOriginY + panY + slotTop + CARD_H / 2;
  const vx = vw / 2;
  const vy = vh / 2;
  let rdx = cx - vx;
  let rdy = cy - vy;
  const len = Math.hypot(rdx, rdy);
  const dist = Math.max(680, Math.min(vw, vh) * 1.05);
  if (len < 6) {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = (h * 31 + key.charCodeAt(i)) >>> 0;
    }
    const angle = (h % 628) * 0.01;
    rdx = Math.cos(angle) * dist;
    rdy = Math.sin(angle) * dist;
  } else {
    rdx = (rdx / len) * dist;
    rdy = (rdy / len) * dist;
  }
  return { x: rdx, y: rdy };
}

function worldRectIntersectsCullView(
  wx: number,
  wy: number,
  panX: number,
  panY: number,
  vw: number,
  vh: number
): boolean {
  if (vw < 1 || vh < 1) return true;
  const vl = -panX - ITEM_CULL_MARGIN_PX;
  const vr = -panX + vw + ITEM_CULL_MARGIN_PX;
  const vt = -panY - ITEM_CULL_MARGIN_PX;
  const vb = -panY + vh + ITEM_CULL_MARGIN_PX;
  return (
    wx + CARD_W >= vl && wx <= vr && wy + CARD_H >= vt && wy <= vb
  );
}

type BaseItem = { x: number; y: number; index: number };

function layoutBaseGrid(filmCount: number): {
  canvasW: number;
  canvasH: number;
  gridW: number;
  gridH: number;
  /** Period for tiling: next copy of the wall starts this far in world space (not full canvas — avoids huge empty margins). */
  strideX: number;
  strideY: number;
  baseItems: BaseItem[];
} {
  const n = filmCount;
  if (n === 0) {
    const w = CANVAS_MARGIN * 2 + CARD_W;
    const h = CANVAS_MARGIN * 2 + CARD_H;
    return {
      canvasW: w,
      canvasH: h,
      gridW: CARD_W,
      gridH: CARD_H,
      strideX: w,
      strideY: h,
      baseItems: [],
    };
  }

  const cols = Math.min(12, Math.max(4, Math.ceil(Math.sqrt(n * 1.12))));
  const rows = Math.ceil(n / cols);
  const cellW = CARD_W + GAP_X;
  const cellH = CARD_H + GAP_Y;

  const gridW = cols * CARD_W + (cols - 1) * GAP_X;
  const gridH = rows * CARD_H + (rows - 1) * GAP_Y;

  const canvasW = gridW + CANVAS_MARGIN * 2;
  const canvasH = gridH + CANVAS_MARGIN * 2;

  const strideX = gridW + GAP_X;
  const strideY = gridH + GAP_Y;

  const baseItems: BaseItem[] = [];
  for (let index = 0; index < n; index++) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = CANVAS_MARGIN + col * cellW;
    const y = CANVAS_MARGIN + row * cellH;
    baseItems.push({ x, y, index });
  }

  return { canvasW, canvasH, gridW, gridH, strideX, strideY, baseItems };
}

/** Deterministic rotation so echo tiles reshuffle assignments without colliding with (0,0). */
function tileRotation(tx: number, ty: number, n: number): number {
  if (n <= 1) return 0;
  const h = (tx * 374761393 + ty * 668265263) >>> 0;
  return h % n;
}

type TileWindow = { txMin: number; txMax: number; tyMin: number; tyMax: number };

function computeTileWindow(
  panX: number,
  panY: number,
  vw: number,
  vh: number,
  strideX: number,
  strideY: number
): TileWindow {
  const left = -panX - TILE_VIEW_MARGIN_PX;
  const right = -panX + vw + TILE_VIEW_MARGIN_PX;
  const top = -panY - TILE_VIEW_MARGIN_PX;
  const bottom = -panY + vh + TILE_VIEW_MARGIN_PX;

  let txMin = Math.floor(left / strideX);
  let txMax = Math.floor((right - 1) / strideX);
  let tyMin = Math.floor(top / strideY);
  let tyMax = Math.floor((bottom - 1) / strideY);

  const clampAxis = (
    min: number,
    max: number,
    centerWorld: number,
    stride: number
  ) => {
    const span = max - min + 1;
    if (span <= MAX_TILES_PER_AXIS) return [min, max] as const;
    const centerTile = Math.floor(centerWorld / stride);
    const before = Math.floor((MAX_TILES_PER_AXIS - 1) / 2);
    const after = MAX_TILES_PER_AXIS - 1 - before;
    return [centerTile - before, centerTile + after] as const;
  };

  const centerWorldX = -panX + vw / 2;
  const centerWorldY = -panY + vh / 2;
  [txMin, txMax] = clampAxis(txMin, txMax, centerWorldX, strideX);
  [tyMin, tyMax] = clampAxis(tyMin, tyMax, centerWorldY, strideY);

  return { txMin, txMax, tyMin, tyMax };
}

function windowsEqual(a: TileWindow, b: TileWindow) {
  return (
    a.txMin === b.txMin &&
    a.txMax === b.txMax &&
    a.tyMin === b.tyMin &&
    a.tyMax === b.tyMax
  );
}

export function HomePolaroidGrid({ films }: { films: Film[] }) {
  const n = films.length;
  const { canvasW, canvasH, gridW, gridH, strideX, strideY, baseItems } =
    useMemo(() => layoutBaseGrid(n), [n]);

  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const panRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(
    null
  );
  const didInitialCenter = useRef(false);
  const [tileWindow, setTileWindow] = useState<TileWindow>({
    txMin: 0,
    txMax: 0,
    tyMin: 0,
    tyMax: 0,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [viewCull, setViewCull] = useState({
    panX: 0,
    panY: 0,
    vw: 0,
    vh: 0,
  });
  const rafCullRef = useRef<number | null>(null);
  const [burstActive, setBurstActive] = useState(false);
  const burstActiveRef = useRef(false);
  /** After a burst finishes, cards stay hidden until Space again. */
  const [polaroidsHidden, setPolaroidsHidden] = useState(false);
  const polaroidsHiddenRef = useRef(false);
  const burstTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mq.matches);
    const onChange = () => setPrefersReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  burstActiveRef.current = burstActive;
  polaroidsHiddenRef.current = polaroidsHidden;

  const flushViewCull = useCallback(() => {
    const v = viewportRef.current;
    if (!v) return;
    const p = panRef.current;
    const next = {
      panX: p.x,
      panY: p.y,
      vw: v.clientWidth,
      vh: v.clientHeight,
    };
    setViewCull((prev) =>
      prev.panX === next.panX &&
      prev.panY === next.panY &&
      prev.vw === next.vw &&
      prev.vh === next.vh
        ? prev
        : next
    );
  }, []);

  const scheduleViewCull = useCallback(() => {
    if (rafCullRef.current != null) return;
    rafCullRef.current = requestAnimationFrame(() => {
      rafCullRef.current = null;
      flushViewCull();
    });
  }, [flushViewCull]);

  const refreshTileWindow = useCallback(() => {
    const view = viewportRef.current;
    if (!view || strideX < 1 || strideY < 1) return;
    const vw = view.clientWidth;
    const vh = view.clientHeight;
    if (vw < 1 || vh < 1) return;
    const next = computeTileWindow(
      panRef.current.x,
      panRef.current.y,
      vw,
      vh,
      strideX,
      strideY
    );
    setTileWindow((prev) => (windowsEqual(prev, next) ? prev : next));
  }, [strideX, strideY]);

  const syncTransform = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    const { x, y } = panRef.current;
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    refreshTileWindow();
    scheduleViewCull();
  }, [refreshTileWindow, scheduleViewCull]);

  const placedItems = useMemo(() => {
    if (n === 0 || baseItems.length === 0) return [];
    const { txMin, txMax, tyMin, tyMax } = tileWindow;
    const { panX, panY, vw, vh } = viewCull;
    const out: { key: string; film: Film; x: number; y: number }[] = [];
    for (let tx = txMin; tx <= txMax; tx++) {
      for (let ty = tyMin; ty <= tyMax; ty++) {
        const rot = tx === 0 && ty === 0 ? 0 : tileRotation(tx, ty, n);
        for (const b of baseItems) {
          const wx = tx * strideX + b.x;
          const wy = ty * strideY + b.y;
          if (!worldRectIntersectsCullView(wx, wy, panX, panY, vw, vh)) {
            continue;
          }
          const film = films[(b.index + rot) % n]!;
          const lx = wx - txMin * strideX;
          const ly = wy - tyMin * strideY;
          out.push({
            key: `${tx}-${ty}-${b.index}-${film.guid}`,
            film,
            x: lx,
            y: ly,
          });
        }
      }
    }
    return out;
  }, [n, baseItems, films, tileWindow, strideX, strideY, viewCull]);

  const canvasOriginX = tileWindow.txMin * strideX;
  const canvasOriginY = tileWindow.tyMin * strideY;
  const canvasSpanW =
    (tileWindow.txMax - tileWindow.txMin) * strideX + CANVAS_MARGIN + gridW;
  const canvasSpanH =
    (tileWindow.tyMax - tileWindow.tyMin) * strideY + CANVAS_MARGIN + gridH;

  const tryInitialCenter = useCallback(() => {
    if (didInitialCenter.current) return;
    const view = viewportRef.current;
    const canvas = canvasRef.current;
    if (!view || !canvas) return;
    const vw = view.clientWidth;
    const vh = view.clientHeight;
    if (vw < 1 || vh < 1) return;
    const cx =
      n > 0 && baseItems.length > 0
        ? CANVAS_MARGIN + gridW / 2
        : canvasW / 2;
    const cy =
      n > 0 && baseItems.length > 0
        ? CANVAS_MARGIN + gridH / 2
        : canvasH / 2;
    panRef.current = {
      x: vw / 2 - cx,
      y: vh / 2 - cy,
    };
    syncTransform();
    flushViewCull();
    didInitialCenter.current = true;
  }, [
    n,
    baseItems.length,
    canvasW,
    canvasH,
    gridW,
    gridH,
    syncTransform,
    flushViewCull,
  ]);

  useLayoutEffect(() => {
    didInitialCenter.current = false;
  }, [strideX, strideY, gridW, gridH]);

  useLayoutEffect(() => {
    const view = viewportRef.current;
    if (!view) return;
    tryInitialCenter();
    const ro = new ResizeObserver(() => {
      tryInitialCenter();
      flushViewCull();
    });
    ro.observe(view);
    return () => ro.disconnect();
  }, [tryInitialCenter, flushViewCull]);

  useLayoutEffect(() => {
    return () => {
      if (rafCullRef.current != null) {
        cancelAnimationFrame(rafCullRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    const view = viewportRef.current;
    if (!view) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      panRef.current = {
        x: panRef.current.x - e.deltaX,
        y: panRef.current.y - e.deltaY,
      };
      syncTransform();
    };

    view.addEventListener("wheel", onWheel, { passive: false });
    return () => view.removeEventListener("wheel", onWheel);
  }, [syncTransform]);

  useEffect(() => {
    const burstResetMs =
      BURST_ANIM_MS + (BURST_STAGGER_SLOTS - 1) * BURST_STAGGER_STEP_MS;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (e.defaultPrevented) return;
      if (
        e.target instanceof Element &&
        e.target.closest("input, textarea, [contenteditable='true']")
      ) {
        return;
      }
      if (burstActiveRef.current) return;

      if (polaroidsHiddenRef.current) {
        e.preventDefault();
        setPolaroidsHidden(false);
        return;
      }

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }
      e.preventDefault();
      setBurstActive(true);
      if (burstTimeoutRef.current != null) {
        clearTimeout(burstTimeoutRef.current);
      }
      burstTimeoutRef.current = setTimeout(() => {
        burstTimeoutRef.current = null;
        setBurstActive(false);
        setPolaroidsHidden(true);
      }, burstResetMs);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (burstTimeoutRef.current != null) {
        clearTimeout(burstTimeoutRef.current);
        burstTimeoutRef.current = null;
      }
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* Safari / embedded browsers can throw; drag still works without capture */
    }
    dragRef.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
    };
    setIsDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    panRef.current = {
      x: panRef.current.x + dx,
      y: panRef.current.y + dy,
    };
    syncTransform();
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (d && d.pointerId === e.pointerId) {
      dragRef.current = null;
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    }
  };

  const showQuote = polaroidsHidden && !burstActive;
  const showSpaceHint =
    !polaroidsHidden && !burstActive && !prefersReducedMotion;

  return (
    <main className="fixed inset-0 overflow-hidden overscroll-none bg-[#111]">
      <div className="film-grain z-[1]" aria-hidden />

      {/* Soft vignette: edges fade into background so the plane feels open-ended. */}
      <div
        className="pointer-events-none absolute inset-0 z-[5]"
        aria-hidden
      >
        <div className="absolute inset-x-0 top-0 h-[min(22vh,200px)] bg-gradient-to-b from-[#111] to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-[min(22vh,200px)] bg-gradient-to-t from-[#111] to-transparent" />
        <div className="absolute inset-y-0 left-0 w-[min(18vw,160px)] bg-gradient-to-r from-[#111] to-transparent" />
        <div className="absolute inset-y-0 right-0 w-[min(18vw,160px)] bg-gradient-to-l from-[#111] to-transparent" />
      </div>

      <p
        className={`pointer-events-none fixed bottom-4 left-4 z-[7] max-w-[min(100vw-2rem,14rem)] text-[11px] leading-snug tracking-wide text-white/40 transition-opacity duration-300 [font-family:var(--font-mono),ui-monospace,monospace] sm:bottom-5 sm:left-5 sm:text-xs sm:max-w-none ${
          showSpaceHint ? "opacity-100" : "opacity-0"
        }`}
        aria-hidden={!showSpaceHint}
      >
        Press <kbd className="rounded border border-white/20 bg-white/[0.06] px-1 py-px font-mono text-[0.95em] text-white/55 not-italic">
          Space
        </kbd>{" "}
        to reveal a message
      </p>

      <div
        className="pointer-events-none absolute inset-0 z-[6] flex items-center justify-center px-6"
        aria-hidden={!showQuote}
      >
        <p
          role="status"
          aria-live="polite"
          className={`pointer-events-auto max-w-lg text-center text-lg leading-relaxed text-white/75 transition-opacity duration-300 [font-family:var(--font-serif),Georgia,serif] sm:text-xl ${
            showQuote ? "opacity-100" : "opacity-0"
          }`}
        >
          {showQuote ? (
            <>
              Tise loves stories,
              <span className="quote-word-big">
                {"\u00a0"}big{"\u00a0"}
              </span>
              and{" "}
              <span className="quote-word-small">small</span>
              {" "}
              in{" "}
              <span className="quote-word-film">film</span>,{" "}
              <span className="quote-word-digital">digital</span>
              {" "}
              and{" "}
              <span className="quote-word-print">
                print
                <svg
                  className="quote-word-print__scribble"
                  viewBox="0 0 128 12"
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  <path
                    className="quote-word-print__path"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pathLength="100"
                    d="M0,8.5 C11,3.5 20,11.5 32,6.5 C42,2.5 54,10.5 66,5.5 C76,1.5 90,9.5 100,4.5 C108,1.5 118,7.5 128,7"
                  />
                </svg>
              </span>
            </>
          ) : null}
        </p>
      </div>

      <div
        ref={viewportRef}
        role="application"
        aria-label="Film diary canvas. Pan in any direction; the same diary repeats in neighboring spaces. Drag or use a trackpad to move."
        className={`absolute inset-0 z-[4] touch-none select-none [perspective:1200px] [perspective-origin:50%_50%] ${
          isDragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={() => {
          dragRef.current = null;
          setIsDragging(false);
        }}
      >
        <div
          ref={canvasRef}
          className="absolute will-change-transform [transform-style:preserve-3d]"
          style={{
            left: canvasOriginX,
            top: canvasOriginY,
            width: canvasSpanW,
            height: canvasSpanH,
          }}
        >
          {placedItems.map(({ key, film, x, y }) => {
            const { panX, panY, vw, vh } = viewCull;
            const { x: outX, y: outY } = burstOutwardOffsetPx(
              x,
              y,
              canvasOriginX,
              canvasOriginY,
              panX,
              panY,
              vw,
              vh,
              key
            );
            const burstLayerStyle = {
              "--burst-out-x": `${outX}px`,
              "--burst-out-y": `${outY}px`,
              ...(burstActive
                ? { "--burst-delay": `${burstStaggerDelayMs(key)}ms` }
                : {}),
            } as CSSProperties;

            return (
            <div
              key={key}
              className="polaroid-slot-enter absolute cursor-default"
              style={{ left: x, top: y, width: CARD_W }}
            >
              <div
                className={`polaroid-burst-layer${burstActive ? " polaroid-burst-at-camera" : ""}${polaroidsHidden && !burstActive ? " polaroid-burst-hidden" : ""}`}
                style={burstLayerStyle}
              >
                <PolaroidCard
                  film={film}
                  enableHover={!burstActive && !polaroidsHidden}
                />
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
