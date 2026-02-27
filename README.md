# Speyer Impostor 👻

A social deduction game for Speyer students, inspired by Among Us!

## Features

- **5-15 Players** - Perfect for small to medium groups
- **Real-time Multiplayer** - Uses PartyKit for instant synchronization
- **Speyer-themed Locations** - Play in familiar school locations
- **Tasks & Sabotage** - Complete tasks or eliminate players
- **Text Chat** - Discuss during meetings
- **Voting System** - Vote out suspected impostors

## How to Play

### For Innocents:
- Complete tasks around Speyer locations
- Report dead bodies when you find them
- Call emergency meetings to discuss
- Vote out suspected impostors
- Win by completing all tasks OR voting out all impostors

### For Impostors:
- Eliminate innocent players when alone with them
- Sabotage to create chaos
- Blend in and avoid suspicion
- Win by eliminating enough players to equal/outnumber innocents

## Development

### Prerequisites
- Node.js 18+ installed
- npm or yarn

### Setup

1. Install dependencies:
```bash
npm install
```

2. Run the development servers:

In one terminal, start the Next.js app:
```bash
npm run dev
```

In another terminal, start the PartyKit server:
```bash
npm run party
```

3. Open [http://localhost:3000](http://localhost:3000) in your browser

### Testing Multiplayer

To test multiplayer locally:
1. Open multiple browser windows/tabs
2. Create a game in one window
3. Copy the room code
4. Join with other windows using the room code

## Deployment

### Deploy to Vercel + PartyKit

1. Deploy PartyKit server:
```bash
npx partykit deploy
```

This will give you a PartyKit URL (e.g., `my-game.partykit.dev`)

2. Update `.env.local` with your PartyKit URL:
```
NEXT_PUBLIC_PARTYKIT_HOST=my-game.partykit.dev
```

3. Deploy Next.js app to Vercel:
```bash
vercel
```

4. Make sure to add the environment variable `NEXT_PUBLIC_PARTYKIT_HOST` in your Vercel project settings

## Game Configuration

Edit `lib/gameConfig.ts` to customize:
- Locations
- Tasks
- Sabotages
- Kill animations
- Game timings
- Player counts

## Tech Stack

- **Next.js 14** - React framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **PartyKit** - Real-time multiplayer backend
- **Vercel** - Hosting (free tier)

## License

Built for Speyer students by Carina and her dad! 🎮
