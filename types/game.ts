export type PlayerRole = 'innocent' | 'impostor';
export type PlayerStatus = 'alive' | 'dead';
export type GamePhase = 'lobby' | 'playing' | 'meeting' | 'voting' | 'voteReveal' | 'results' | 'gameOver';

export type PowerupType = 'sixthSense' | 'radar' | 'shield' | 'shadowWalk' | 'tracker' | 'bloodhound';

export interface Player {
  id: string;
  name: string;
  role: PlayerRole;
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
}

export interface Task {
  id: string;
  title: string;
  location: string;
  description: string;
  type: 'quick' | 'mini-game';
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
  winner?: 'innocents' | 'impostors';
  lightsOut?: {
    until: number; // timestamp when lights come back
  };
  doorsLocked?: {
    until: number; // timestamp when doors unlock
    room: string;  // which room is locked
  };
  secretRoomMethod?: 'piano' | 'shelves' | 'cases'; // which discovery is active this game
  secretRoomEntrance?: string; // which room has the hidden entrance this game
  // Per-player computed fields (set by server for each connection)
  sixthSenseWarning?: boolean;
  bloodhoundTarget?: { name: string; locationName: string; color: string };
  taskProgress?: { completed: number; total: number }; // Global task bar for innocents
  atSecretEntrance?: boolean; // Server tells client if they're at the secret entrance
  ejectionResult?: { playerId: string; role: PlayerRole; name: string } | null; // Set during results phase
  voteRevealData?: {
    votes: Array<{ voterId: string; voterName: string; votedForId: string; votedForName: string; isGhost: boolean }>;
    ejectedId?: string;
    ejectedRole?: PlayerRole;
    ejectedName?: string;
    noEjection: boolean;
  };
  ghostVoteAvailable?: boolean; // Dead player's one-time ghost vote status
  scrambled?: { until: number }; // Brief flash when scramble happens
  cooldowns?: {
    kill?: number;      // timestamp when kill cooldown ends
    sabotage?: number;  // timestamp when sabotage cooldown ends
    meeting?: number;   // timestamp when meeting cooldown ends
    meetingUsed?: boolean; // player already used their 1 emergency meeting
  };
  gameTimeRemaining?: number; // game clock seconds remaining (sent during meetings/voting/results)
  meetingLocations?: Record<string, string>; // playerId -> locationName at meeting start
  reportedBody?: { name: string; location: string; reportedBy: string }; // whose body triggered the meeting
}

export type ClientMessageType = 'join' | 'move' | 'completeTask' | 'kill' | 'reportBody' | 'callMeeting' | 'chat' | 'vote' | 'startGame' | 'sabotage' | 'enterSecretRoom' | 'identify' | 'restartGame';

export interface ClientMessage {
  type: ClientMessageType;
  playerId: string;
  data?: any;
}

