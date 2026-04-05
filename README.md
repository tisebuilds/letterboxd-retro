# tisebuilds/films — Product Requirements Document

**Version:** 1.0
**Author:** Tise
**Date:** April 4, 2026
**For:** Cursor AI — implementation reference

---

## 1. Overview

**tisebuilds/films** is a personal film diary visualizer that pulls watch history from a Letterboxd RSS feed and renders each film as a polaroid-style card — similar in spirit to retro.app for GitHub. The site auto-updates whenever a new film is logged on Letterboxd. No Letterboxd API key is required.

---

## 2. Goal

Build a minimal, self-updating web app that displays Tise's Letterboxd film diary as a wall of polaroid cards. Each card shows only two things: an image and the date watched. The image defaults to the Letterboxd film poster but can be swapped out for a personal screencap from the film. The aesthetic is dark and stripped-back — the images do the talking.

---

## 3. Data Source

**RSS Feed URL:** `https://letterboxd.com/teeshay24/rss/`

This is a public, no-auth endpoint. It updates automatically whenever a film is logged on Letterboxd.

### 3.1 Feed Structure

Each `<item>` in the RSS feed contains many fields. For this project, only three are needed:

| Field | XML Tag | Example Value | Notes |
|---|---|---|---|
| Watch date | `<letterboxd:watchedDate>` | 2026-03-12 | ISO date — the date displayed on the card |
| Poster image | Inside `<description>` CDATA | `https://a.ltrbxd.com/resized/...` | Default card image; user can override |
| Entry GUID | `<guid>` | letterboxd-watch-1262429915 | Stable ID — used as the key for custom image overrides |

Other fields (title, rating, year, review) are parsed but not displayed in v1.

**Poster extraction example:**

The `<description>` field contains CDATA HTML. The poster URL follows this pattern:

```
src="https://a.ltrbxd.com/resized/film-poster/1/0/1/3/3/5/7/1013357-sentimental-value-2025-0-600-0-900-crop.jpg?v=e89e64a309"
```

Extract with: `/src="(https?:\/\/[^"]*a\.ltrbxd\.com[^"]*)"/`

**XML Namespace declarations in the feed:**

```xml
xmlns:letterboxd="https://letterboxd.com"
xmlns:tmdb="https://themoviedb.org"
xmlns:dc="http://purl.org/dc/elements/1.1/"
```

Use `getElementsByTagName('letterboxd:filmTitle')` or equivalent namespace-aware parsing.

---

## 4. Tech Stack

**Recommended: Next.js (App Router)**

Next.js is the ideal choice because its server-side data fetching (Server Components or Route Handlers) fetches the RSS feed on the server — completely bypassing the browser CORS restriction that blocks direct fetches from the client.

| Layer | Choice | Reason |
|---|---|---|
| Framework | Next.js 14+ (App Router) | Server-side RSS fetch, ISR, easy deploy |
| Styling | Tailwind CSS | Utility-first, easy dark theme |
| RSS parsing | fast-xml-parser or xml2js | Handles namespaced XML cleanly |
| Deployment | Vercel | One-click, free tier, ISR support |

---

## 5. Architecture

```
Letterboxd RSS Feed
        |
        v
lib/getFilms.ts (server)
  - Fetches RSS on the server (no CORS issues)
  - Parses XML: extracts watchedDate, poster URL, guid
  - Merges with custom-images.json (user overrides)
  - Returns clean array of film objects
  - Revalidates every 6 hours (ISR via next.fetch)
        |
        v
React Server Component (app/page.tsx)
  - Calls getFilms()
  - Passes films to <HomePolaroidGrid> / <PolaroidCard>
        |
        v
PolaroidCard Component
  - Renders: image + date only
  - Applies random CSS rotation via inline style
        |
        v
data/custom-images.json  (user-editable)
  - Maps entry GUID → custom image path or URL
  - User drops screencap into /public/custom/ and
    adds the mapping here to override any card's image
```

---

## 6. Data loading (`lib/getFilms.ts`)

Fetch RSS in `getFilms()`, parse XML, merge with `data/custom-images.json` for poster overrides, return `{ films, error? }`.

```typescript
// Called from app/page.tsx (Server Component)
export async function getFilms() {
  const res = await fetch('https://letterboxd.com/teeshay24/rss/', {
    headers: { 'User-Agent': 'tisebuilds-films/1.0' },
    next: { revalidate: 21600 },
  });
  const xml = await res.text();

  // Load user's custom image overrides
  // customImages shape: { [guid: string]: string }
  // e.g. { "letterboxd-watch-1262429915": "/custom/kiki-screencap.jpg" }

  // Parse XML and return film objects
  // Each film object shape:
  // {
  //   guid: string,
  //   watchedDate: string,   // "2026-03-12"
  //   image: string | null,  // custom override if set, else Letterboxd poster URL
  // }
}
```

---

## 7. Film Data Model

```typescript
interface Film {
  guid: string;           // Letterboxd entry GUID — stable key for image overrides
  watchedDate: string;    // ISO date string "YYYY-MM-DD" — the only text shown on card
  image: string | null;   // Resolved image URL: custom screencap if set, else Letterboxd poster
}
```

**Custom image override file — `data/custom-images.json`:**

```json
{
  "letterboxd-watch-1262429915": "/custom/kiki-screencap.jpg",
  "letterboxd-watch-1234743997": "/custom/sentimental-value-screencap.jpg"
}
```

User workflow to swap an image:
1. Take a screencap from the film
2. Drop the file into `/public/custom/`
3. Add the entry's GUID and filename to `custom-images.json`
4. The card updates on next page load

---

## 8. UI Requirements

### 8.1 Polaroid Card

Each card is minimal — image and date only, nothing else.

- **Frame:** Off-white/cream background (`#f2ece0`), equal padding on top and sides, larger bottom padding to create the classic polaroid white space beneath the photo
- **Image:** Fills the photo area, `object-fit: cover`, no filters or overlays — the image speaks for itself
- **Date:** Displayed in the bottom white strip only. Small, muted, monospace type. Format: `Jun 16` (month + day, no year). Reference the image shared — date sits bottom-left of the white strip, small and lowercase
- **No title. No stars. No other text.**
- **Rotation:** Each card gets a fixed random CSS rotation between –3° and +3°, seeded from the entry GUID so it stays consistent across renders
- **Hover:** Card straightens to 0°, scales up slightly (~1.05), shadow deepens
- **Card size:** ~180px wide, portrait aspect ratio (~1:1.35 photo area + white strip below)

### 8.2 Date Format

Display only month abbreviation + day number, matching the reference image:

| watchedDate | Displayed as |
|---|---|
| 2026-06-16 | Jun 16 |
| 2026-03-12 | Mar 12 |
| 2026-02-14 | Feb 14 |

### 8.3 Page Layout

- **Background:** Near-black (`#111`) — no grain needed, simplicity is the point
- **Header:** Site name `tisebuilds / films`, minimal, centered
- **Grid:** Flex-wrap, centered, consistent gap between cards
- **No per-card text labels beyond the date in the white strip**

### 8.4 Loading State

Skeleton polaroid placeholders — cream rectangles with the same dimensions and random rotations as real cards, no shimmer animation needed.

---

## 9. RSS Parsing Notes

### Namespace handling

fast-xml-parser does not handle XML namespace prefixes well by default. Two options:

**Option A — Strip prefixes before parsing:**
```typescript
const cleaned = xml
  .replace(/letterboxd:/g, 'lbd_')
  .replace(/tmdb:/g, 'tmdb_');
// Then access as item.lbd_filmTitle, item.tmdb_movieId
```

**Option B — Use xml2js with explicitCharkey:**
```typescript
import { parseString } from 'xml2js';
// Access as item['letterboxd:filmTitle'][0]
```

### Poster extraction

The poster URL lives inside CDATA in `<description>`. After parsing, pull it with a regex:
```typescript
const posterMatch = description.match(/src="(https?:\/\/[^"]*a\.ltrbxd\.com[^"]*)"/);
const poster = posterMatch?.[1] ?? null;
```

### GUID extraction

The `<guid>` tag contains the stable entry ID used as the key in `custom-images.json`:

```typescript
const guid = item.getElementsByTagName('guid')[0]?.textContent ?? '';
// e.g. "letterboxd-watch-1262429915"
```

---

## 10. Deployment

1. Push to GitHub
2. Connect repo to Vercel
3. Deploy — no environment variables needed (RSS feed is public)
4. ISR handles updates: Vercel will refetch the RSS feed every 6 hours automatically

To force an immediate refresh, trigger a revalidation via Vercel's On-Demand ISR or simply redeploy.

---

## 11. Out of Scope

- User authentication / multi-user support
- Letterboxd OAuth or official API
- Film search or filtering (v1)
- TMDB API integration (posters are already in the RSS feed)
- Mobile app

---

## 12. File Structure

```
tisebuilds-films/
├── app/
│   ├── page.tsx              # Main page — renders the grid
│   ├── layout.tsx            # Root layout, fonts, metadata
│   └── globals.css           # Base styles, film grain, dark bg
├── components/
│   ├── PolaroidCard.tsx      # Individual card: image + date only
│   └── HomePolaroidGrid.tsx  # Pannable canvas + polaroids
├── lib/
│   └── getFilms.ts           # RSS fetch + XML parsing
├── types/
│   └── film.ts               # Film interface (guid, watchedDate, image)
├── data/
│   └── custom-images.json    # User-editable: guid → custom image path
└── public/
    └── custom/               # User drops screencap files here
```
