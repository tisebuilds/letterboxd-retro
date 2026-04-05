"use client";

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

export function PolaroidCard({
  film,
  enableHover = true,
}: {
  film: Film;
  enableHover?: boolean;
}) {
  const polaroidDate = formatPolaroidDate(film.watchedDate);
  const rootRef = useRef<HTMLDivElement>(null);
  const [loadPoster, setLoadPoster] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);

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

  const polaroidFont = {
    fontFamily: "var(--font-polaroid), var(--font-sans), sans-serif",
  } as const;

  const hoverLiftClass = enableHover
    ? "group transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none hover:z-10 hover:scale-105 motion-reduce:hover:scale-100 [transform:translateZ(0)]"
    : "";

  const frameClass = `polaroid-flip-inner box-border h-full w-full break-inside-avoid border border-[#e0e0e0] bg-white shadow-[0_8px_22px_rgba(0,0,0,0.4)] ${
    enableHover
      ? "transition-shadow duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:shadow-[0_14px_32px_rgba(0,0,0,0.55)] motion-reduce:transition-none"
      : ""
  }`;

  return (
    <div className="relative z-0 cursor-default">
      <div className={hoverLiftClass || undefined}>
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
          <div
            className={`${frameClass} ${isFlipped ? "is-flipped" : ""}`}
          >
            <div className="polaroid-flip-face polaroid-flip-face--front flex flex-col">
            <div
              className="w-full shrink-0 overflow-hidden bg-neutral-200"
              style={{ height: POLAROID_IMAGE_H }}
            >
              {film.image && loadPoster ? (
                // eslint-disable-next-line @next/next/no-img-element -- avoid remotePatterns for external posters
                <img
                  src={film.image}
                  alt=""
                  draggable={false}
                  className="h-full w-full object-cover"
                  decoding="async"
                />
              ) : null}
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
          </div>
        </div>
      </div>
    </div>
  );
}

