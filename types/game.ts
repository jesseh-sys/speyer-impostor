export type PlayerRole = 'innocent' | 'impostor';
export type PlayerStatus = 'alive' | 'dead';
export type GamePhase = 'lobby' | 'playing' | 'meeting' | 'voting' | 'results' | 'gameOver';

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

export interface VoteResult {
  playerId: string;
  votes: string[]; // Array of player IDs who voted for them
}

export interface GameState {
  roomCode: string;
  phase: GamePhase;
  players: Record<string, Player>;
  tasks: Task[];
  locations: Location[];
  chat: ChatMessage[];
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
  winner?: 'innocents' | 'impostors' | 'konami';
  lightsOut?: {
    until: number; // timestamp when lights come back
  };
  doorsLocked?: {
    until: number; // timestamp when doors unlock
  };
  secretRoomMethod?: 'piano' | 'shelves' | 'cases'; // which discovery is active this game
  secretRoomEntrance?: string; // which room has the hidden entrance this game
  // Per-player computed fields (set by server for each connection)
  sixthSenseWarning?: boolean;
  bloodhoundTarget?: { name: string; locationName: string; color: string };
}

export interface ClientMessage {
  type: 'join' | 'move' | 'completeTask' | 'kill' | 'reportBody' | 'callMeeting' | 'chat' | 'vote' | 'startGame' | 'konamiKill' | 'sabotage' | 'enterSecretRoom' | 'identify';
  playerId: string;
  data?: any;
}

export interface ServerMessage {
  type: 'gameState' | 'playerJoined' | 'playerLeft' | 'error';
  data: any;
}
