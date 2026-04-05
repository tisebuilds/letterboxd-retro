"use client";

import {
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Film } from "@/types/film";
import {
  CARD_H,
  CARD_W,
  POLAROID_FOOTER_H,
  POLAROID_IMAGE_H,
} from "@/lib/polaroidDimensions";
import { formatPolaroidDate } from "@/lib/polaroidUtils";

/**
 * Expand the viewport for IntersectionObserver so posters start loading while
 * panning, before cards fully enter the screen (canvas uses CSS transforms).
 */
const PAN_LAZY_ROOT_MARGIN_PX = 336;

const SPRING = { stiffness: 200, damping: 20 };

const STAR_PATH =
  "M12 2.5 15.09 8.76 22 9.77 17 14.64 18.18 21.5 12 18.27 5.82 21.5 7 14.64 2 9.77 8.91 8.76 12 2.5z";

function starFractions(rating: number | null): (0 | 0.5 | 1)[] {
  const r = rating == null ? 0 : Math.min(5, Math.max(0, rating));
  return [0, 1, 2, 3, 4].map((i) => {
    const x = r - i;
    if (x >= 1) return 1;
    if (x >= 0.5) return 0.5;
    return 0;
  });
}

function Star({ fraction }: { fraction: 0 | 0.5 | 1 }) {
  const clipId = useId().replace(/:/g, "");
  if (fraction === 0) {
    return (
      <svg
        className="h-3 w-3 shrink-0 text-neutral-400"
        viewBox="0 0 24 24"
        aria-hidden
      >
        <path
          d={STAR_PATH}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (fraction === 1) {
    return (
      <svg
        className="h-3 w-3 shrink-0 text-black"
        viewBox="0 0 24 24"
        aria-hidden
      >
        <path d={STAR_PATH} fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" aria-hidden>
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width="12" height="24" />
        </clipPath>
      </defs>
      <path
        d={STAR_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        className="text-neutral-400"
      />
      <path
        d={STAR_PATH}
        fill="currentColor"
        clipPath={`url(#${clipId})`}
        className="text-black"
      />
    </svg>
  );
}

function RatingStars({ rating }: { rating: number | null }) {
  const parts = starFractions(rating);
  const label =
    rating == null
      ? "No rating"
      : `${rating === Math.floor(rating) ? rating : rating.toFixed(1)} out of 5 stars`;
  return (
    <div className="flex justify-start gap-px" role="img" aria-label={label}>
      {parts.map((f, i) => (
        <Star key={i} fraction={f} />
      ))}
    </div>
  );
}

function PosterGleam({ mx }: { mx: MotionValue<number> }) {
  const gleamTilt = useTransform(mx, [-0.5, 0.5], [40, 52]);
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 z-[1] overflow-hidden"
      initial={{ x: "-150%" }}
      animate={{ x: "150%" }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      style={{
        background:
          "linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.18) 45%, transparent 100%)",
        rotate: gleamTilt,
      }}
    />
  );
}

export function PolaroidCard({
  film,
  enableHover = true,
}: {
  film: Film;
  enableHover?: boolean;
}) {
  const polaroidDate = formatPolaroidDate(film.watchedDate);
  const rootRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const [loadPoster, setLoadPoster] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [gleamSweepKey, setGleamSweepKey] = useState(0);

  const reduceMotion = useReducedMotion();

  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const hoverT = useMotionValue(0);
  /** Card flip angle (deg); animated — must live on the same node as tilt so back-faces stay correct. */
  const flipY = useMotionValue(0);

  const tiltMul = reduceMotion ? 0 : 1;
  const rotateX = useSpring(
    useTransform(my, (v) => -v * 30 * tiltMul),
    SPRING
  );
  const mouseTiltY = useSpring(
    useTransform(mx, (v) => v * 30 * tiltMul),
    SPRING
  );
  const rotateY = useTransform([flipY, mouseTiltY], ([f, m]) => {
    const a = typeof f === "number" ? f : 0;
    const b = typeof m === "number" ? m : 0;
    return a + b;
  });
  const scale = useSpring(
    useTransform(hoverT, (t) => 1 + t * (reduceMotion ? 0 : 0.06)),
    SPRING
  );

  const shadowY = useSpring(
    useTransform(hoverT, [0, 1], [8, 20]),
    SPRING
  );
  const shadowBlur = useSpring(
    useTransform(hoverT, [0, 1], [22, 40]),
    SPRING
  );
  const shadowAlpha = useSpring(
    useTransform(hoverT, [0, 1], [0.4, 0.5]),
    SPRING
  );
  const boxShadow = useMotionTemplate`0 ${shadowY}px ${shadowBlur}px rgba(0,0,0,${shadowAlpha})`;

  const titleLine =
    film.filmYear.length > 0
      ? `${film.filmTitle} (${film.filmYear})`
      : film.filmTitle;

  useEffect(() => {
    if (!film.image || loadPoster) return;
    const el = rootRef.current;
    if (!el) return;

    const margin = `${PAN_LAZY_ROOT_MARGIN_PX}px`;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setLoadPoster(true);
            observer.disconnect();
            return;
          }
        }
      },
      { root: null, rootMargin: margin, threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [film.image, loadPoster]);

  useEffect(() => {
    if (reduceMotion) {
      flipY.set(isFlipped ? -180 : 0);
      return;
    }
    const ctrl = animate(flipY, isFlipped ? -180 : 0, {
      duration: 0.55,
      ease: [0.22, 1, 0.36, 1],
    });
    return () => ctrl.stop();
  }, [isFlipped, flipY, reduceMotion]);

  const toggleFlip = useCallback(() => {
    if (!enableHover) return;
    setIsFlipped((v) => !v);
  }, [enableHover]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!enableHover) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleFlip();
      }
    },
    [enableHover, toggleFlip]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!enableHover || reduceMotion) return;
      const el = tiltRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      mx.set((e.clientX - rect.left) / rect.width - 0.5);
      my.set((e.clientY - rect.top) / rect.height - 0.5);
    },
    [enableHover, reduceMotion, mx, my]
  );

  const handlePointerLeave = useCallback(() => {
    mx.set(0);
    my.set(0);
    hoverT.set(0);
    setIsHovered(false);
  }, [mx, my, hoverT]);

  const handlePointerEnter = useCallback(() => {
    if (!enableHover) return;
    setIsHovered(true);
    if (reduceMotion) return;
    hoverT.set(1);
    setGleamSweepKey((k) => k + 1);
  }, [enableHover, hoverT, reduceMotion]);

  const polaroidFont = {
    fontFamily: "var(--font-polaroid), var(--font-sans), sans-serif",
  } as const;

  const frameClass =
    "polaroid-flip-inner polaroid-flip-inner--motion box-border h-full w-full break-inside-avoid border border-[#e0e0e0] bg-white";

  return (
    <div
      className="relative z-0 cursor-default [perspective:800px]"
      data-polaroid-card
    >
      <motion.div
        ref={tiltRef}
        className="h-full w-full origin-center [transform-style:preserve-3d]"
        style={{
          scale,
          zIndex: isHovered && !reduceMotion ? 10 : 0,
          boxShadow,
        }}
        onPointerMove={enableHover ? handlePointerMove : undefined}
        onPointerLeave={enableHover ? handlePointerLeave : undefined}
        onPointerEnter={enableHover ? handlePointerEnter : undefined}
      >
        <div
          ref={rootRef}
          className={`polaroid-flip-scene shrink-0 ${
            enableHover ? "cursor-pointer" : "pointer-events-none"
          }`}
          style={{ width: CARD_W, height: CARD_H }}
          role="button"
          tabIndex={enableHover ? 0 : -1}
          aria-pressed={isFlipped}
          aria-label={`${film.filmTitle}. Watched ${polaroidDate}. ${
            isFlipped ? "Showing details" : "Showing photo"
          }. Press to flip.`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            toggleFlip();
          }}
          onKeyDown={onKeyDown}
        >
          <motion.div
            className={frameClass}
            style={{
              rotateX,
              rotateY,
              transformStyle: "preserve-3d",
            }}
          >
            <div className="polaroid-flip-face polaroid-flip-face--front flex flex-col">
            <div
              className="relative w-full shrink-0 overflow-hidden bg-neutral-200"
              style={{ height: POLAROID_IMAGE_H }}
            >
              {film.image && loadPoster ? (
                // eslint-disable-next-line @next/next/no-img-element -- avoid remotePatterns for external posters
                <img
                  src={film.image}
                  alt=""
                  draggable={false}
                  className="relative z-0 h-full w-full object-cover"
                  decoding="async"
                />
              ) : null}
              {enableHover &&
                film.image &&
                loadPoster &&
                isHovered &&
                !reduceMotion && (
                  <PosterGleam key={gleamSweepKey} mx={mx} />
                )}
            </div>
            <div
              className="flex w-full shrink-0 items-center justify-center bg-white px-2.5 py-1.5"
              style={{ height: POLAROID_FOOTER_H }}
            >
              <span
                className="text-[11px] font-normal italic tracking-[-0.02em] text-black"
                style={polaroidFont}
              >
                {polaroidDate}
              </span>
            </div>
            </div>

            <div className="polaroid-flip-face polaroid-flip-face--back flex w-full flex-col items-start justify-center bg-white px-2.5 py-3 text-left">
            <p
              className="line-clamp-4 w-full text-[10px] font-medium leading-snug tracking-tight text-black [font-family:var(--font-sans),system-ui,sans-serif]"
              style={polaroidFont}
            >
              {titleLine}
            </p>
            <div className="mt-2 w-full">
              <RatingStars rating={film.memberRating} />
            </div>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
