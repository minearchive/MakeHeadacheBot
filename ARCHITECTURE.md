# Architecture Documentation

> **Purpose**: This document describes the full architecture of the `no-context-breakcore` Discord bot. It is intended for AI agents and developers to quickly understand every file, the data flow, and key design decisions.

---

## Table of Contents

- [Overview](#overview)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Entry Point](#entry-point)
- [Core Modules](#core-modules)
  - [bot.ts — Discord Client & Command Router](#botts--discord-client--command-router)
  - [command.ts — Command Interface](#commandts--command-interface)
  - [compose.ts — FFmpeg Video Compositing Engine](#composets--ffmpeg-video-compositing-engine)
  - [cache.ts — Disk + SQLite Cache Layer](#cachets--disk--sqlite-cache-layer)
  - [database.ts — SQLite Database Initialization](#databasets--sqlite-database-initialization)
  - [logger.ts — Logging](#loggerts--logging)
- [Commands](#commands)
  - [fire.ts — Fire Effect Command](#firets--fire-effect-command)
  - [rand.ts — Random Cached Image Command](#randts--random-cached-image-command)
- [Data Flow Diagrams](#data-flow-diagrams)
- [File System Layout at Runtime](#file-system-layout-at-runtime)
- [Key Design Decisions](#key-design-decisions)
- [Dependencies](#dependencies)

---

## Overview

This is a Discord bot that composites a fire effect (a pre-keyed foreground video with a black background) on top of user-provided media. The bot supports:

- **Static images** (PNG, JPG, WebP, etc.)
- **Animated GIFs**
- **Videos** (MP4, WebM, MOV, etc.)

Media can be sourced from:
- Discord user avatars
- Message attachments
- URLs in message text or slash command options
- Reply target message attachments, text URLs, or embed media

The composited output can be in **GIF** or **MP4** format.

---

## Project Structure

```
no-context-breakcore/
├── assets/
│   └── fire.mp4              # Pre-keyed fire foreground video (black bg, ~12MB)
├── run/                       # Runtime data directory (created automatically)
│   ├── .cache/                # Cached render results
│   │   └── <cacheId>/
│   │       └── result.gif
│   └── cache.db               # SQLite database for cache metadata
├── src/
│   ├── index.ts               # Entry point
│   ├── bot.ts                 # Discord client + command routing
│   ├── command.ts             # Command interface definition
│   ├── compose.ts             # FFmpeg compositing engine
│   ├── cache.ts               # Cache read/write logic
│   ├── database.ts            # SQLite init + connection
│   ├── logger.ts              # Winston logger
│   ├── media.ts               # Media type detection & URL helpers
│   ├── utils.ts               # Shared utilities (tempPath, cleanup)
│   └── commands/
│       ├── fire.ts            # /fire command (main feature)
│       └── rand.ts            # /rand command (random cached image)
├── config.json                # Bot token + foreground video path
├── config.json.example        # Template for config.json
├── package.json
└── tsconfig.json
```

---

## Configuration

**File**: `config.json` (excluded from git; see `config.json.example`)

```json
{
    "token": "YOUR_DISCORD_BOT_TOKEN",
    "foregroundVideo": "./assets/fire.mp4"
}
```

| Key               | Description                                           |
|--------------------|-------------------------------------------------------|
| `token`            | Discord bot token for authentication                 |
| `foregroundVideo`  | Path to the fire overlay video (must have black bg)  |

---

## Entry Point

### `src/index.ts`

The app entry point. Performs three actions in order:

1. **`initDb()`** — Creates the `run/` directory and initializes the SQLite database schema.
2. **Creates a `Bot` instance** with the Discord token from config.
3. **Registers commands** (`FireCommand`, `RandCommand`) and starts the bot.

```
initDb() → new Bot(token) → bot.register(...) → bot.start()
```

---

## Core Modules

### `bot.ts` — Discord Client & Command Router

**Responsibility**: Manages the Discord.js client lifecycle, registers slash commands, and routes both slash command interactions and text-based message commands to the appropriate `Command` handler.

**Key behaviors**:

| Event               | Handler             | Description                                              |
|----------------------|---------------------|----------------------------------------------------------|
| `clientReady`        | `onReady()`         | Logs in, registers all slash commands with Discord API   |
| `interactionCreate`  | `onCommand()`       | Routes `ChatInputCommand` interactions to `command.execute()` |
| `messageCreate`      | `onMessageCommand()`| Parses `!<commandName>` prefix, routes to `command.onMessage()` |

**Text command format**: `!fire`, `!rand` — the first word after `!` is matched against registered command names.

**Discord Client Intents**: `Guilds`, `GuildMessages`, `MessageContent`

---

### `command.ts` — Command Interface

**Responsibility**: Defines the `Command` interface that all commands must implement.

```typescript
interface Command {
    readonly data: SlashCommandBuilder;                        // Slash command definition
    execute(interaction: ChatInputCommandInteraction): Promise<void>;  // Slash command handler
    onMessage?(message: Message): Promise<void>;              // Optional text command handler
}
```

Both `execute` and `onMessage` serve the same purpose but handle different Discord input methods (slash commands vs `!` prefix messages).

---

### `compose.ts` — FFmpeg Video Compositing Engine

**Responsibility**: Composites a foreground fire video on top of a background (image, GIF, or video) using FFmpeg.

**Exported types**:
- `OutputFormat = 'mp4' | 'gif'`
- `InputType = 'image' | 'gif' | 'video'`

**Exported functions**:

| Function      | Description                                                              |
|---------------|--------------------------------------------------------------------------|
| `compose()`   | Main entry point. Renders via `renderToMp4`, then converts to GIF if needed |
| `gifToMp4()`  | Converts a GIF file to MP4 (used by fire.ts for cached GIF → MP4 conversion) |

**Internal functions**:

| Function              | Description                                                            |
|-----------------------|------------------------------------------------------------------------|
| `probe()`             | Wraps `ffprobe` in a Promise                                           |
| `calcOutputSize()`    | Calculates 360p output dimensions preserving aspect ratio (even width) |
| `buildFilterChain()`  | Builds the FFmpeg filter chain — adds fps=15 for animated inputs       |
| `renderToMp4()`       | Unified render function for both static and animated backgrounds       |
| `mp4ToGif()`          | Converts intermediate MP4 to GIF with palette optimization             |

**FFmpeg filter chain** (built by `buildFilterChain`):

```
# Static image:
[background] → scale(outWidth×360) → [bg]
[foreground] → colorkey(black) → scale(match bg) → [scaled]
[bg] + [scaled] → overlay(centered)

# Animated (GIF/video) — adds fps reduction:
[background] → fps(15) → scale(outWidth×360) → [bg]
[foreground] → fps(15) → colorkey(black) → scale(match bg) → [scaled]
[bg] + [scaled] → overlay(centered, shortest=1)
```

**Key parameters**:
- Output height is fixed at **360px**, width is aspect-ratio-preserving (rounded to even).
- CRF: **35** (normal) or **43** (low quality).
- Codec: **libx264**, preset **ultrafast**.
- For animated backgrounds: foreground loops infinitely (`-stream_loop -1`), duration capped at **10 seconds**.
- FPS is reduced to **15** for animated inputs (both background and foreground).

---

### `cache.ts` — Disk + SQLite Cache Layer

**Responsibility**: Caches rendered GIF results for static images to avoid re-rendering the same input.

> **Important**: Only static image inputs are cached. GIF and video inputs bypass the cache due to large file sizes.

**Cache directory**: `run/.cache/<cacheId>/result.gif`

**Exported constants/functions**:

| Export                | Description                                                         |
|-----------------------|---------------------------------------------------------------------|
| `CACHE_DIR`           | Absolute path to the cache directory (used by `rand.ts` too)        |
| `generateCacheId()`   | SHA-256 hash of input buffer + `_lq` suffix if low quality + `_<inputType>` suffix if not image |
| `getCachedResult()`   | Looks up cache entry in DB, verifies file exists on disk, increments hit counter |
| `saveCacheResult()`   | Copies rendered GIF to cache dir, inserts DB entry                  |

**Cache ID format**: `<sha256>[_lq][_gif|_video]`

**Staleness handling**: If a cache entry exists in DB but the file is missing on disk, the DB entry is deleted and treated as a cache miss.

---

### `database.ts` — SQLite Database Initialization

**Responsibility**: Manages a singleton `better-sqlite3` connection and table schema.

**Database path**: `run/cache.db` (WAL mode enabled)

**Schema**:

```sql
CREATE TABLE IF NOT EXISTS cache_entries (
    id          TEXT PRIMARY KEY,   -- Cache ID (sha256 + suffixes)
    image_hash  TEXT NOT NULL,      -- SHA-256 of the original input file
    low_quality INTEGER NOT NULL,   -- 0 or 1
    file_path   TEXT NOT NULL,      -- Relative path from .cache/ dir
    created_at  TEXT NOT NULL,      -- ISO 8601 timestamp
    hit_count   INTEGER DEFAULT 0   -- Number of cache hits
)
```

---

### `media.ts` — Media Type Detection

**Responsibility**: Centralized media type detection and URL extraction helpers. Used by `fire.ts` and potentially any future command that handles media.

**Exported functions**:

| Function                          | Description                                           |
|-----------------------------------|-------------------------------------------------------|
| `detectInputTypeFromContentType()`| Parses MIME type string → `InputType`                 |
| `detectInputTypeFromUrl()`        | Extracts extension from URL pathname → `InputType`    |
| `detectInputType()`              | Combines both methods (contentType priority)           |
| `isSupportedMedia()`             | Checks if contentType is a supported media type        |
| `extensionForType()`             | Maps `InputType` → file extension                      |
| `extractUrlFromContent()`        | Regex extracts first URL from message text             |

---

### `utils.ts` — Shared Utilities

**Responsibility**: Common utility functions shared across modules.

**Exported functions**:

| Function      | Description                                    |
|---------------|------------------------------------------------|
| `tempPath()`  | Generates a unique temp file path with prefix  |
| `cleanup()`   | Silently deletes one or more files             |

---

### `logger.ts` — Logging

**Responsibility**: Provides a singleton Winston logger with timestamp formatting.

**Format**: `YYYY-MM-DD HH:mm:ss [LEVEL] message`

**Transport**: Console only.

---

## Commands

### `fire.ts` — Fire Effect Command

**Responsibility**: The primary command. Accepts media input from various sources, composites the fire effect, and replies with the result.

#### Slash Command: `/fire`

| Option       | Type        | Required | Description                               |
|--------------|-------------|----------|-------------------------------------------|
| `user`       | User        | No       | Target user (defaults to command invoker)  |
| `format`     | String      | No       | `GIF` or `MP4` (defaults to GIF)          |
| `low_quality`| Boolean     | No       | Extra low quality output                  |
| `image`      | Attachment  | No       | Image/GIF/Video file attachment           |
| `url`        | String      | No       | URL of image/GIF/video                    |

#### Text Command: `!fire`

Supports the same media sources without explicit options. Output format is always **GIF** (text commands do not support format selection).

#### Media Source Resolution Order

Media resolution is handled by `resolveMediaSource()`, which delegates to helper methods:

**Slash command** (`execute`):
1. `image` attachment option
2. `url` string option
3. Target user's avatar (or invoker's avatar)

**Text command** (`onMessage` → `resolveMediaSource`):
1. `extractFromAttachments()` — Message attachments (image/GIF/video)
2. `extractUrlFromContent()` — URL in message text
3. `resolveFromReplyTarget()` — Reply target message:
   1. Reply attachments
   2. URL in reply message text
   3. Reply message embeds (`video.url` → `image.url` → `thumbnail.url`)
4. Message author's avatar

#### Input Type Detection

Input type detection uses helpers from `media.ts`:

1. **Discord attachment `contentType`** (highest priority, e.g., `image/gif`, `video/mp4`)
2. **URL file extension** (fallback, e.g., `.gif`, `.mp4`, `.png`)
3. **HTTP `Content-Type` header** from download response (re-confirms after download via `downloadMedia()`)

If the detected type changes after download (via HTTP header), the temp file is renamed to the correct extension.

#### Processing Pipeline

```
Media Source → downloadMedia() → Detect/confirm InputType
  ├─ [image] → renderWithCache() → cache check → compose() as GIF → save → convert if MP4
  └─ [gif/video] → renderDirect() → compose() directly (no cache)
```

#### Instance Methods

| Method                    | Description                                                     |
|---------------------------|-----------------------------------------------------------------|
| `execute()`               | Slash command handler                                           |
| `onMessage()`             | Text command handler                                            |
| `resolveMediaSource()`    | Orchestrates media resolution from message context              |
| `extractFromAttachments()`| Extracts first supported media from message attachments          |
| `resolveFromReplyTarget()`| Resolves media from reply (attachments → URL → embeds)          |
| `processMedia()`          | Core pipeline: download → route to cache/direct render          |
| `downloadMedia()`         | Downloads + re-detects input type, renames if extension mismatches |
| `renderDirect()`          | Renders animated inputs without caching                         |
| `renderWithCache()`       | Renders static images with cache support                        |
| `buildAttachment()`       | Creates AttachmentBuilder with correct filename                 |
| `downloadFile()`          | HTTP(S) download with redirect support, returns content-type    |

---

### `rand.ts` — Random Cached Image Command

**Responsibility**: Returns a random image/GIF from the cache. Imports `CACHE_DIR` from `cache.ts` (no duplicate definition).

#### Slash Command: `/rand`
#### Text Command: `!rand`

No options. The `getRandomCachedFile()` method queries the database for a random entry and returns an `AttachmentBuilder` directly (or null). Both `execute` and `onMessage` share this same method.

**Staleness handling**: If the file on disk is missing, the DB entry is deleted and null is returned.

---

## Data Flow Diagrams

### Fire Command — Static Image Flow

```
User input (avatar / attachment / URL)
        │
        ▼
   Download to temp file (.png)
        │
        ▼
   Read file → SHA-256 hash → Generate cache ID
        │
        ├── Cache HIT ──────────────────┐
        │                               │
        ▼                               ▼
   Cache MISS                    Cached .gif file
        │                               │
        ▼                               ├── format=gif → Return cached file
   compose(image, fire.mp4, gif)        │
        │                               └── format=mp4 → gifToMp4() → Return temp .mp4
        ▼
   saveCacheResult() → run/.cache/<id>/result.gif
        │
        ▼
   (same as Cache HIT path)
```

### Fire Command — GIF/Video Flow

```
User input (GIF attachment / video URL / etc.)
        │
        ▼
   Download to temp file (.gif / .mp4)
        │
        ▼
   compose(animated, fire.mp4, format) ← No caching
        │
        ├── format=mp4 → Return temp .mp4
        └── format=gif → renderVideoBackground → mp4ToGif → Return temp .gif
```

---

## File System Layout at Runtime

```
no-context-breakcore/
├── run/
│   ├── cache.db           # SQLite DB (WAL mode)
│   ├── cache.db-shm       # WAL shared memory
│   ├── cache.db-wal       # WAL log
│   └── .cache/
│       ├── <sha256_hash>/
│       │   └── result.gif
│       ├── <sha256_hash>_lq/
│       │   └── result.gif
│       └── ...
│
└── (OS temp dir)/
    ├── fire-<timestamp>-<rand>.png       # Temporary downloaded media
    ├── fire-<timestamp>-<rand>.mp4       # Temporary output
    ├── compose-<timestamp>-<rand>.mp4    # Temporary intermediate MP4
    └── ...                                # All cleaned up after use
```

---

## Key Design Decisions

1. **Cache only static images**: GIF/video outputs are not cached because their file sizes are significantly larger, and the same GIF/video input is unlikely to be reused frequently.

2. **Always render to GIF first for static images**: Even if the user requests MP4, the pipeline renders a GIF first (cacheable), then converts. This ensures the cache is always populated with GIFs that can serve both format requests.

3. **GIF/video inputs default to MP4 output**: In text commands (`!fire`), animated inputs automatically output MP4 to keep Discord upload sizes manageable. Slash command users can still explicitly choose GIF.

4. **Foreground fire video uses colorkey**: The fire overlay video has a black background. FFmpeg's `colorkey` filter removes the black, making the fire appear transparent over the background.

5. **Output fixed at 360p height**: All outputs are scaled to 360px height with aspect-ratio-preserving width. This keeps file sizes small and processing fast.

6. **10-second duration cap for animated inputs**: Prevents excessively long renders and large output files.

7. **HTTP redirect support**: The `downloadFile` method follows HTTP 3xx redirects, which is important for URLs from various sources (CDNs, shortened URLs, etc.).

8. **Input type re-detection after download**: After downloading, the HTTP `Content-Type` header is used to re-confirm the input type. If the re-detected type differs from the URL-based guess, the temp file is renamed to the correct extension.

---

## Dependencies

| Package          | Purpose                                      |
|------------------|----------------------------------------------|
| `discord.js`     | Discord API client                           |
| `fluent-ffmpeg`  | Node.js wrapper for FFmpeg CLI               |
| `better-sqlite3` | Synchronous SQLite3 driver                   |
| `winston`        | Structured logging                           |

**System requirement**: FFmpeg must be installed and available in PATH.
