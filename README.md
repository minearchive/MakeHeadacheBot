# MakeHeadacheBot

Discord bot that composites a user's avatar with a video overlay using ffmpeg, producing intentionally low-quality, artifact-heavy results.

## Features

- `/fire` — Compose fire effect on any user's avatar
  - `user` — Target user (defaults to self)
  - `format` — GIF or MP4 output (defaults to GIF)
  - `low_quality` — Extra compression artifacts

## Setup

1. Clone the repository
```bash
git clone git@github.com:minearchive/MakeHeadacheBot.git
cd MakeHeadacheBot
```

2. Install dependencies
```bash
npm install
```

3. Create `config.json` from example
```bash
cp config.json.example config.json
```

4. Edit `config.json` with your bot token and video path
```json
{
    "token": "YOUR_DISCORD_BOT_TOKEN",
    "foregroundVideo": "./assets/fire.mp4"
}
```

5. Place your overlay video in `assets/`

## Usage

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm start
```

## Adding Commands

1. Create a new class in `src/commands/` implementing the `Command` interface
2. Register it in `src/index.ts`:
```typescript
bot.register(new YourCommand());
```

## Tech Stack

- TypeScript
- discord.js
- fluent-ffmpeg

---

*This project was created using [Antigravity](https://antigravity.google).*
