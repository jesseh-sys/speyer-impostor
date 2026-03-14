export type PlayerRole = 'innocent' | 'impostor';
export type PlayerStatus = 'alive' | 'dead';
export type GamePhase = 'lobby' | 'playing' | 'meeting' | 'voting' | 'voteReveal' | 'results' | 'gameOver' | 'preGame';

export type PowerupType = 'sixthSense' | 'radar' | 'shield' | 'shadowWalk' | 'tracker' | 'bloodhound';

export type SpecialRole = 'jester' | 'sheriff' | 'phantom' | 'shapeshifter' | 'survivor';

export interface Player {
  id: string;
  name: string;
  role: PlayerRole;
  specialRole?: SpecialRole;
  status: PlayerStatus;
  location: string;
  color: string;
  icon: string; // Emoji or character icon
  tasksCompleted: number;
  totalTasks: number;
  powerup?: {
    type: PowerupType;
    until: number; // timestamp when it expires
  };
  ghostVoteUsed?: boolean; // Dead players get ONE vote across all remaining meetings
  disguise?: {
    asPlayerId: string;
    asName: string;
    asColor: string;
    until: number; // timestamp when disguise expires
  };
  survivorShields?: number; // Survivor role: starts with 2 shields
}

export type MiniGameType = 'hack' | 'defrag' | 'decode' | 'password';

export interface Task {
  id: string;
  title: string;
  location: string;
  description: string;
  type: 'quick' | 'mini-game';
  miniGameType?: MiniGameType;
  isFake?: boolean;
}

export interface Location {
  id: string;
  name: string;
  description: string;
  x: number;
  y: number;
  connectedTo: string[];
}

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  message: string;
  timestamp: number;
}

export interface GameState {
  roomCode: string;
  phase: GamePhase;
  hostId?: string;
  players: Record<string, Player>;
  tasks: Task[];
  locations: Location[];
  chat: ChatMessage[];
  ghostChat: ChatMessage[]; // Dead players chat separately
  votes: Record<string, string>; // playerId -> votedForId
  deadBodies: {
    playerId: string;
    location: string;
    reportedBy?: string;
  }[];
  timer?: {
    duration: number;
    startTime: number;
  };
  roleConfig?: Record<SpecialRole, boolean>;
  phantomGlitch?: {
    playerId: string;
    playerName: string;
    location: string;
    until: number;
  };
  winner?: 'innocents' | 'impostors' | 'jester';
  survivorWin?: { playerId: string; name: string };
  commsJam?: {
    until: number; // timestamp when comms jam expires (affects next meeting)
  };
  blackout?: {
    until: number; // timestamp when blackout ends (10s darkness)
  };
  secretRoomMethod?: 'piano' | 'shelves' | 'cases'; // which discovery is active this game
  secretRoomEntrance?: string; // which room has the hidden entrance this game
  // Per-player computed fields (set by server for each connection)
  sixthSenseWarning?: boolean;
  bloodhoundTarget?: { name: string; locationName: string; color: string };
  taskProgress?: { completed: number; total: number }; // Global task bar for innocents
  atSecretEntrance?: boolean; // Server tells client if they're at the secret entrance
  ejectionResult?: { playerId: string; role: PlayerRole; specialRole?: SpecialRole; name: string } | null; // Set during results phase
  voteRevealData?: {
    votes: Array<{ voterId: string; voterName: string; votedForId: string; votedForName: string; isGhost: boolean }>;
    ejectedId?: string;
    ejectedRole?: PlayerRole;
    ejectedSpecialRole?: SpecialRole;
    ejectedName?: string;
    noEjection: boolean;
  };
  ghostVoteAvailable?: boolean; // Dead player's one-time ghost vote status
  scrambled?: { until: number }; // Brief flash when scramble happens
  eventLog?: Array<{ time: string; event: string }>; // DECLASSIFIED log — only sent during gameOver
  awards?: Array<{ playerId: string; playerName: string; playerColor: string; title: string; description: string }>; // Ephemeral awards — only sent during gameOver
  cooldowns?: {
    kill?: number;      // timestamp when kill cooldown ends
    sabotage?: number;  // timestamp when sabotage cooldown ends
    meeting?: number;   // timestamp when meeting cooldown ends
    meetingUsed?: boolean; // player already used their 1 emergency meeting
    investigate?: number; // timestamp when sheriff investigate cooldown ends
    shapeshift?: number;  // timestamp when shapeshifter cooldown ends
  };
  gameTimeRemaining?: number; // game clock seconds remaining (sent during meetings/voting/results)
  meetingLocations?: Record<string, string>; // playerId -> locationName at meeting start
  reportedBody?: { name: string; location: string; reportedBy: string }; // whose body triggered the meeting
  restartCountdown?: { until: number }; // auto-restart countdown after game over
  preGameTimer?: { until: number }; // preGame phase countdown before auto-start
  connectedCount?: number; // number of connected players (sent during preGame)
}

export type ClientMessageType = 'join' | 'move' | 'completeTask' | 'kill' | 'reportBody' | 'callMeeting' | 'chat' | 'vote' | 'startGame' | 'sabotage' | 'enterSecretRoom' | 'identify' | 'restartGame' | 'roleConfig' | 'investigate' | 'reportPhantom' | 'shapeshift';

export interface ClientMessage {
  type: ClientMessageType;
  playerId: string;
  data?: any;
}

