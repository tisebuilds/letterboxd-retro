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
import { CARD_H, CARD_W } from "@/lib/polaroidDimensions";

const FRICTION = 0.92;
const SENSITIVITY = 0.8;
const MAX_VEL = 40;
const CLICK_THRESHOLD = 5;

/** Marks the polaroid root so the pan canvas can ignore pointerdown (see capture listener). */
const POLAROID_CARD_SELECTOR = "[data-polaroid-card]";

/** Gap between polaroid frames (horizontal and vertical grid pitch beyond card size). */
const GRID_GAP_PX = 72;

const COL_SPACING = CARD_W + GRID_GAP_PX;
const ROW_SPACING = CARD_H + GRID_GAP_PX;

/** Min/max columns; card size is fixed — only column count changes with viewport width. */
const MIN_COLS = 3;
const MAX_COLS = 12;
const DEFAULT_COLS = 5;

const phi = 1.618;

function columnCountFromWidth(vw: number): number {
  if (vw < 1) return DEFAULT_COLS;
  const n = Math.floor(vw / COL_SPACING);
  return Math.min(MAX_COLS, Math.max(MIN_COLS, n));
}

function colOffsetsFor(numCols: number): number[] {
  return Array.from({ length: numCols }, (_, i) => {
    return (
      ((i * phi * ROW_SPACING * 1.5) % (ROW_SPACING * 3)) - ROW_SPACING * 1.5
    );
  });
}

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

function wrapAxis(base: number, scroll: number, span: number): number {
  if (span <= 0) return base + scroll;
  let p = base + scroll;
  const half = span / 2;
  p = ((((p + half) % span) + span) % span) - half;
  return p;
}

function burstOutwardOffsetPx(
  cx: number,
  cy: number,
  vw: number,
  vh: number,
  key: string
): { x: number; y: number } {
  if (vw < 2 || vh < 2) {
    return { x: 0, y: -720 };
  }
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

function computeGridLayout(films: Film[], numCols: number) {
  const n = films.length;
  if (n === 0) {
    return {
      TOTAL_W: 0,
      TOTAL_H: 0,
      bases: [] as { baseX: number; baseY: number }[],
    };
  }
  const cols = Math.max(1, numCols);
  const colOffsets = colOffsetsFor(cols);
  const numRows = Math.ceil(n / cols);
  const TOTAL_W = cols * COL_SPACING;
  const TOTAL_H = numRows * ROW_SPACING;
  const bases = films.map((_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    // Center the card cluster horizontally (symmetric bbox around origin).
    const baseX =
      col * COL_SPACING -
      TOTAL_W / 2 +
      COL_SPACING / 2 -
      CARD_W / 2;
    const baseY =
      row * ROW_SPACING +
      colOffsets[col]! -
      TOTAL_H / 2 +
      ROW_SPACING / 2;
    return { baseX, baseY };
  });
  return { TOTAL_W, TOTAL_H, bases };
}

type TileRef = {
  el: HTMLDivElement;
  burstEl: HTMLDivElement;
  key: string;
};

export function HomePolaroidGrid({ films }: { films: Film[] }) {
  const [columnCount, setColumnCount] = useState(DEFAULT_COLS);

  const { TOTAL_W, TOTAL_H, bases } = useMemo(
    () => computeGridLayout(films, columnCount),
    [films, columnCount]
  );

  const pos = useRef({ x: 0, y: 0 });
  const vel = useRef({ vx: 0, vy: 0 });
  const rafId = useRef(0);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, px: 0, py: 0 });
  const lastPointer = useRef({ x: 0, y: 0, t: 0 });
  const dragTotalMove = useRef(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const viewportSize = useRef({ w: 0, h: 0 });
  const tileRefs = useRef<(TileRef | undefined)[]>([]);
  const assignTileRef = useRef<(i: number, el: HTMLDivElement | null) => void>(
    () => {}
  );
  const tileRefCallbackByIndex = useRef(
    new Map<number, (el: HTMLDivElement | null) => void>()
  );
  const prefersReducedMotionRef = useRef(false);

  const layoutRef = useRef({ TOTAL_W, TOTAL_H, bases });
  layoutRef.current = { TOTAL_W, TOTAL_H, bases };

  const [burstActive, setBurstActive] = useState(false);
  const burstActiveRef = useRef(false);
  const [polaroidsHidden, setPolaroidsHidden] = useState(false);
  const polaroidsHiddenRef = useRef(false);
  const burstTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    prefersReducedMotionRef.current = mq.matches;
    setPrefersReducedMotion(mq.matches);
    const onChange = () => {
      prefersReducedMotionRef.current = mq.matches;
      setPrefersReducedMotion(mq.matches);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  burstActiveRef.current = burstActive;
  polaroidsHiddenRef.current = polaroidsHidden;

  const triggerRevealAction = useCallback(() => {
    if (burstActiveRef.current) return;
    if (polaroidsHiddenRef.current) {
      setPolaroidsHidden(false);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const burstResetMs =
      BURST_ANIM_MS + (BURST_STAGGER_SLOTS - 1) * BURST_STAGGER_STEP_MS;
    setBurstActive(true);
    if (burstTimeoutRef.current != null) {
      clearTimeout(burstTimeoutRef.current);
    }
    burstTimeoutRef.current = setTimeout(() => {
      burstTimeoutRef.current = null;
      setBurstActive(false);
      setPolaroidsHidden(true);
    }, burstResetMs);
  }, []);

  const updateTiles = useRef<() => void>(() => {});

  updateTiles.current = () => {
    const { w: vw, h: vh } = viewportSize.current;
    if (vw < 1 || vh < 1) return;

    const { TOTAL_W: tw, TOTAL_H: th, bases: b } = layoutRef.current;
    const p = pos.current;
    const n = b.length;

    for (let i = 0; i < n; i++) {
      const tile = tileRefs.current[i];
      if (!tile) continue;
      const base = b[i];
      if (!base) continue;

      const tx = vw / 2 + wrapAxis(base.baseX, p.x, tw);
      const ty = vh / 2 + wrapAxis(base.baseY, p.y, th);
      tile.el.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
    }
  };

  useEffect(() => {
    const tick = () => {
      const reduced = prefersReducedMotionRef.current;

      if (reduced) {
        vel.current.vx = 0;
        vel.current.vy = 0;
      } else if (!isDragging.current) {
        vel.current.vx *= FRICTION;
        vel.current.vy *= FRICTION;
        pos.current.x += vel.current.vx;
        pos.current.y += vel.current.vy;
      }

      updateTiles.current();
      rafId.current = requestAnimationFrame(tick);
    };

    rafId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId.current);
  }, []);

  const syncViewportSize = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    viewportSize.current = { w, h };
    const nextCols = columnCountFromWidth(w);
    setColumnCount((prev) => (prev === nextCols ? prev : nextCols));
    updateTiles.current();
  }, []);

  useLayoutEffect(() => {
    syncViewportSize();
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      syncViewportSize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncViewportSize]);

  assignTileRef.current = (i, el) => {
    if (!el) {
      tileRefs.current[i] = undefined;
      return;
    }
    const burstEl = el.querySelector(
      ".polaroid-burst-layer"
    ) as HTMLDivElement | null;
    if (!burstEl) return;
    const film = films[i];
    if (!film) return;
    tileRefs.current[i] = {
      el,
      burstEl,
      key: `${i}-${film.guid}`,
    };
  };

  useLayoutEffect(() => {
    const map = tileRefCallbackByIndex.current;
    for (const k of [...map.keys()]) {
      if (k >= films.length) map.delete(k);
    }
  }, [films.length]);

  function getTileRefCallback(i: number) {
    const map = tileRefCallbackByIndex.current;
    if (!map.has(i)) {
      map.set(i, (el) => assignTileRef.current(i, el));
    }
    return map.get(i)!;
  }

  useLayoutEffect(() => {
    if (!burstActive) return;
    const vw = viewportSize.current.w;
    const vh = viewportSize.current.h;
    if (vw < 1 || vh < 1) return;

    const { TOTAL_W: tw, TOTAL_H: th, bases: b } = layoutRef.current;
    const p = pos.current;
    const n = b.length;

    for (let i = 0; i < n; i++) {
      const tile = tileRefs.current[i];
      if (!tile) continue;
      const base = b[i];
      if (!base) continue;

      const sl = vw / 2 + wrapAxis(base.baseX, p.x, tw);
      const st = vh / 2 + wrapAxis(base.baseY, p.y, th);
      const cx = sl + CARD_W / 2;
      const cy = st + CARD_H / 2;
      const { x, y } = burstOutwardOffsetPx(cx, cy, vw, vh, tile.key);
      tile.burstEl.style.setProperty("--burst-out-x", `${x}px`);
      tile.burstEl.style.setProperty("--burst-out-y", `${y}px`);
    }
  }, [burstActive, columnCount, films, TOTAL_W, TOTAL_H]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const reduced = prefersReducedMotionRef.current;
      if (reduced) {
        pos.current.x -= e.deltaX * SENSITIVITY;
        pos.current.y -= e.deltaY * SENSITIVITY;
        updateTiles.current();
        return;
      }
      vel.current.vx -= e.deltaX * SENSITIVITY;
      vel.current.vy -= e.deltaY * SENSITIVITY;
      vel.current.vx = Math.max(-MAX_VEL, Math.min(MAX_VEL, vel.current.vx));
      vel.current.vy = Math.max(-MAX_VEL, Math.min(MAX_VEL, vel.current.vy));
    };

    container.addEventListener("wheel", onWheel, { passive: false });

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const t = e.target;
      if (
        t instanceof Element &&
        t.closest(POLAROID_CARD_SELECTOR) != null
      ) {
        return;
      }
      isDragging.current = true;
      dragTotalMove.current = 0;
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        px: pos.current.x,
        py: pos.current.y,
      };
      lastPointer.current = {
        x: e.clientX,
        y: e.clientY,
        t: performance.now(),
      };
      try {
        container.setPointerCapture(e.pointerId);
      } catch {
        /* capture optional */
      }
      container.style.cursor = "grabbing";
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging.current) return;
      e.preventDefault();
      const reduced = prefersReducedMotionRef.current;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      dragTotalMove.current = Math.hypot(dx, dy);

      pos.current.x = dragStart.current.px + dx;
      pos.current.y = dragStart.current.py + dy;

      if (!reduced) {
        const now = performance.now();
        const dt = now - lastPointer.current.t;
        if (dt > 0) {
          vel.current.vx =
            ((e.clientX - lastPointer.current.x) / dt) * 16;
          vel.current.vy =
            ((e.clientY - lastPointer.current.y) / dt) * 16;
        }
        lastPointer.current = { x: e.clientX, y: e.clientY, t: now };
      }

      updateTiles.current();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      container.style.cursor = "grab";
      try {
        container.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      if (dragTotalMove.current < CLICK_THRESHOLD) {
        vel.current.vx = 0;
        vel.current.vy = 0;
      }
    };

    const onLostPointerCapture = () => {
      isDragging.current = false;
      container.style.cursor = "grab";
    };

    container.addEventListener("pointerdown", onPointerDown, { capture: true });
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointercancel", onPointerUp);
    container.addEventListener("lostpointercapture", onLostPointerCapture);

    return () => {
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("pointerdown", onPointerDown, {
        capture: true,
      });
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerUp);
      container.removeEventListener("lostpointercapture", onLostPointerCapture);
    };
  }, []);

  useEffect(() => {
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
        triggerRevealAction();
        return;
      }

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }
      e.preventDefault();
      triggerRevealAction();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (burstTimeoutRef.current != null) {
        clearTimeout(burstTimeoutRef.current);
        burstTimeoutRef.current = null;
      }
    };
  }, [triggerRevealAction]);

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
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#111] to-transparent"
          style={{ width: "min(8vw, 64px)" }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-gradient-to-l from-[#111] to-transparent"
          style={{ width: "min(8vw, 64px)" }}
        />
      </div>

      <button
        type="button"
        className={`fixed bottom-[max(1rem,env(safe-area-inset-bottom,0px))] left-1/2 z-[7] max-w-[min(calc(100vw-2rem),22rem)] -translate-x-1/2 rounded-xl border border-white/12 bg-black/55 px-5 py-2.5 text-center text-[11px] leading-snug tracking-wide text-white/65 shadow-[0_8px_36px_rgba(0,0,0,0.55)] backdrop-blur-md transition-[opacity,transform,box-shadow] duration-300 [font-family:var(--font-mono),ui-monospace,monospace] hover:border-white/18 hover:bg-black/60 hover:text-white/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 active:scale-[0.99] sm:bottom-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:px-6 sm:py-3 sm:text-xs ${
          showSpaceHint
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
        aria-hidden={!showSpaceHint}
        tabIndex={showSpaceHint ? 0 : -1}
        aria-label="Reveal message. Same as pressing Space."
        onClick={() => triggerRevealAction()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        Press{" "}
        <kbd className="mx-0.5 inline rounded-md border border-white/25 bg-black/50 px-1.5 py-0.5 text-[0.88em] font-normal text-white/80 not-italic shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] [font-family:var(--font-sans),system-ui,sans-serif]">
          Space
        </kbd>{" "}
        to reveal a message
      </button>

      <div
        className="pointer-events-none absolute inset-0 z-[6] flex items-center justify-center px-6"
        aria-hidden={!showQuote}
      >
        <p
          role="status"
          aria-live="polite"
          className={`pointer-events-auto max-w-2xl text-center text-2xl leading-relaxed text-white/75 transition-opacity duration-300 [font-family:var(--font-serif),Georgia,serif] sm:text-3xl ${
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
              <span className="quote-word-small">small</span> in{" "}
              <span className="quote-word-film">film</span>,{" "}
              <span className="quote-word-digital">digital</span> and{" "}
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
        ref={containerRef}
        role="application"
        aria-label="Film diary canvas. Pan in any direction; the same diary repeats in neighboring spaces. Drag or use a trackpad to move."
        className="absolute inset-0 z-[4] cursor-grab touch-none select-none [perspective:1200px] [perspective-origin:50%_50%] [transform-style:preserve-3d]"
      >
        {films.map((film, i) => {
          const burstKey = `${i}-${film.guid}`;
          const burstLayerStyle = {
            ...(burstActive
              ? { "--burst-delay": `${burstStaggerDelayMs(burstKey)}ms` }
              : {}),
          } as CSSProperties;

          return (
            <div
              key={film.guid}
              ref={getTileRefCallback(i)}
              className="absolute cursor-default"
              style={{
                left: 0,
                top: 0,
                willChange: "auto",
                transition: "none",
              }}
            >
              <div
                className="polaroid-slot-enter"
                style={{ width: CARD_W }}
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
            </div>
          );
        })}
      </div>
    </main>
  );
}
