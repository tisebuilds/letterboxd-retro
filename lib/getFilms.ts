import { XMLParser } from "fast-xml-parser";
import type { Film } from "@/types/film";
import customImages from "@/data/custom-images.json";

const RSS_URL = "https://letterboxd.com/teeshay24/rss/";
const REVALIDATE_SECONDS = 21600;
/** Avoid hanging forever when Letterboxd or the network is slow (shows error + empty canvas). */
const FETCH_TIMEOUT_MS = 25_000;

const POSTER_RE =
  /src="(https?:\/\/[^"]*a\.ltrbxd\.com[^"]*)"/;

function stripXmlNamespaces(xml: string): string {
  return xml
    .replace(/letterboxd:/g, "lbd_")
    .replace(/tmdb:/g, "tmdb_");
}

function textContent(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object" && "#text" in (v as object)) {
    const t = (v as { "#text"?: string })["#text"];
    return typeof t === "string" ? t.trim() : "";
  }
  return String(v).trim();
}

function extractPosterFromDescription(description: string): string | null {
  const m = description.match(POSTER_RE);
  return m?.[1] ?? null;
}

function parseMemberRating(item: Record<string, unknown>): number | null {
  const raw = textContent(item["lbd_memberRating"]);
  if (!raw) return null;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(5, n);
}

export async function getFilms(): Promise<{ films: Film[]; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(RSS_URL, {
      headers: { "User-Agent": "tisebuilds-films/1.0" },
      next: { revalidate: REVALIDATE_SECONDS },
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        films: [],
        error: `RSS request failed (${res.status})`,
      };
    }

    const xml = await res.text();
    const cleaned = stripXmlNamespaces(xml);
    const parser = new XMLParser({
      ignoreAttributes: false,
      trimValues: true,
    });
    const doc = parser.parse(cleaned) as Record<string, unknown>;
    const rss = doc.rss as Record<string, unknown> | undefined;
    const channel = rss?.channel as Record<string, unknown> | undefined;
    const rawItems = channel?.item;

    const items: Record<string, unknown>[] = Array.isArray(rawItems)
      ? rawItems
      : rawItems
        ? [rawItems as Record<string, unknown>]
        : [];

    const overrides = customImages as Record<string, string>;
    const films: Film[] = [];

    for (const item of items) {
      const guid = textContent(item.guid);
      if (!guid) continue;

      const watchedDate = textContent(item["lbd_watchedDate"]);
      if (!watchedDate) continue;

      const desc = textContent(item.description);
      const poster = desc ? extractPosterFromDescription(desc) : null;

      const override = overrides[guid];
      const image = override?.trim() || poster || null;

      const filmTitle = textContent(item["lbd_filmTitle"]) || "Film";
      const filmYear = textContent(item["lbd_filmYear"]);
      const memberRating = parseMemberRating(item);
      const memberLike = textContent(item["lbd_memberLike"]) === "Yes";

      films.push({
        guid,
        watchedDate,
        image,
        filmTitle,
        filmYear,
        memberRating,
        memberLike,
      });
    }

    return { films };
  } catch (e) {
    const message =
      e instanceof Error
        ? e.name === "AbortError"
          ? `RSS request timed out after ${FETCH_TIMEOUT_MS / 1000}s`
          : e.message
        : "Failed to load Letterboxd diary";
    return { films: [], error: message };
  } finally {
    clearTimeout(timeout);
  }
}
