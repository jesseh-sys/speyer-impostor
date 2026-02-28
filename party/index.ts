import type * as Party from "partykit/server";
import { GameState, Player, ClientMessage, PlayerRole, Task, PowerupType } from "../types/game";
import { LOCATIONS, TASKS, PLAYER_ICONS, PLAYER_COLORS, GAME_CONFIG, getImpostorCount } from "../lib/gameConfig";

export default class GameServer implements Party.Server {
  gameState: GameState | null = null;

  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    console.log('Player connected:', conn.id);

    // Initialize game state if it doesn't exist
    if (!this.gameState) {
      console.log('Initializing new game state for room:', this.room.id);
      this.gameState = {
        roomCode: this.room.id,
        phase: 'lobby',
        players: {},
        tasks: [],
        locations: LOCATIONS,
        chat: [],
        votes: {},
      };
    }

    // Send current game state to the newly connected player
    console.log('Sending game state to player:', conn.id);
    conn.send(JSON.stringify({ type: 'gameState', data: this.gameState }));
  }

  onMessage(message: string, sender: Party.Connection) {
    console.log('Received message from', sender.id, ':', message);
    const msg: ClientMessage = JSON.parse(message);

    if (!this.gameState) {
      console.log('No game state, ignoring message');
      return;
    }

    switch (msg.type) {
      case 'join':
        this.handleJoin(msg, sender);
        break;
      case 'startGame':
        this.handleStartGame();
        break;
      case 'move':
        this.handleMove(msg);
        break;
      case 'completeTask':
        this.handleCompleteTask(msg);
        break;
      case 'kill':
        this.handleKill(msg);
        break;
      case 'reportBody':
        this.handleReportBody(msg);
        break;
      case 'callMeeting':
        this.handleCallMeeting(msg);
        break;
      case 'chat':
        this.handleChat(msg);
        break;
      case 'vote':
        this.handleVote(msg);
        break;
      case 'konamiKill':
        this.handleKonamiKill();
        break;
      case 'sabotage':
        this.handleSabotage(msg);
        break;
      case 'enterSecretRoom':
        this.handleEnterSecretRoom(msg);
        break;
    }

    this.broadcast();
  }

  handleJoin(msg: ClientMessage, sender: Party.Connection) {
    if (!this.gameState) return;

    const playerId = msg.playerId;
    let playerName = msg.data.playerName;
    let icon = msg.data.icon || '@';
    let color = msg.data.color || PLAYER_COLORS[0];

    // If player already exists, just update their info (reconnection)
    if (this.gameState.players[playerId]) {
      console.log('Player reconnected:', playerId);
      this.gameState.players[playerId].name = playerName;
      this.gameState.players[playerId].icon = icon;
      this.gameState.players[playerId].color = color;
      return;
    }

    // Prevent duplicate names — append a number if taken
    const otherPlayers = Object.values(this.gameState.players).filter(p => p.id !== playerId);
    const takenNames = new Set(otherPlayers.map(p => p.name));
    if (takenNames.has(playerName)) {
      let suffix = 2;
      while (takenNames.has(`${playerName}${suffix}`)) suffix++;
      playerName = `${playerName}${suffix}`;
    }

    // Prevent duplicate icons — bump to next available
    const takenIcons = new Set(otherPlayers.map(p => p.icon));
    if (takenIcons.has(icon)) {
      const available = PLAYER_ICONS.find(i => !takenIcons.has(i));
      if (available) icon = available;
    }

    // Prevent duplicate colors — bump to next available
    const takenColors = new Set(otherPlayers.map(p => p.color));
    if (takenColors.has(color)) {
      const available = PLAYER_COLORS.find(c => !takenColors.has(c));
      if (available) color = available;
    }

    const player: Player = {
      id: playerId,
      name: playerName,
      role: 'innocent',
      status: 'alive',
      location: 'speyer',
      color,
      icon,
      tasksCompleted: 0,
      totalTasks: GAME_CONFIG.TASKS_PER_PLAYER,
    };

    console.log('New player joined:', playerId, playerName, icon);
    this.gameState.players[playerId] = player;
  }

  handleStartGame() {
    if (!this.gameState) return;

    const playerIds = Object.keys(this.gameState.players);
    const playerCount = playerIds.length;

    if (playerCount < GAME_CONFIG.MIN_PLAYERS) {
      return; // Not enough players
    }

    // Assign impostor roles — Fisher-Yates shuffle for true randomness
    const impostorCount = getImpostorCount(playerCount);
    const shuffled = [...playerIds];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const impostorIds = shuffled.slice(0, impostorCount);

    impostorIds.forEach(id => {
      if (this.gameState) {
        this.gameState.players[id].role = 'impostor';
      }
    });

    // Assign tasks to innocent players
    playerIds.forEach(id => {
      if (this.gameState && this.gameState.players[id].role === 'innocent') {
        this.assignTasks(id);
      }
    });

    this.gameState.phase = 'playing';
    this.gameState.timer = {
      duration: GAME_CONFIG.GAME_DURATION,
      startTime: Date.now(),
    };

    // Pick which secret room discovery method is active this game
    const methods = ['piano', 'shelves', 'cases'] as const;
    this.gameState.secretRoomMethod = methods[Math.floor(Math.random() * methods.length)];

    // Randomize which room has the secret entrance (exclude 'secret' itself and 'speyer' spawn)
    const eligibleRooms = this.gameState.locations
      .filter(l => l.id !== 'secret' && l.id !== 'speyer')
      .map(l => l.id);
    const entranceRoom = eligibleRooms[Math.floor(Math.random() * eligibleRooms.length)];
    this.gameState.secretRoomEntrance = entranceRoom;

    // Update Room 404's connectedTo to point back to this game's entrance
    const secretLoc = this.gameState.locations.find(l => l.id === 'secret');
    if (secretLoc) {
      secretLoc.connectedTo = [entranceRoom];
    }
  }

  assignTasks(playerId: string) {
    if (!this.gameState) return;

    const shuffledTasks = [...TASKS].sort(() => Math.random() - 0.5);
    const selectedTasks = shuffledTasks.slice(0, GAME_CONFIG.TASKS_PER_PLAYER);

    selectedTasks.forEach((task, index) => {
      if (this.gameState) {
        this.gameState.tasks.push({
          id: `${playerId}-task-${index}`,
          ...task,
        });
      }
    });
  }

  handleMove(msg: ClientMessage) {
    if (!this.gameState) return;

    const { playerId, data } = msg;
    const player = this.gameState.players[playerId];

    if (player && player.status === 'alive') {
      player.location = data.location;
    }
  }

  handleCompleteTask(msg: ClientMessage) {
    if (!this.gameState) return;

    const { playerId, data } = msg;
    const player = this.gameState.players[playerId];

    if (player && player.role === 'innocent' && player.status === 'alive') {
      player.tasksCompleted++;

      // Remove task from list
      this.gameState.tasks = this.gameState.tasks.filter(t => t.id !== data.taskId);

      this.checkWinCondition();
    }
  }

  handleKill(msg: ClientMessage) {
    if (!this.gameState) return;

    const { playerId, data } = msg;
    const killer = this.gameState.players[playerId];
    const victim = this.gameState.players[data.victimId];

    if (killer && killer.role === 'impostor' && victim && victim.status === 'alive') {
      // Shield powerup blocks the kill
      if (victim.powerup?.type === 'shield' && victim.powerup.until > Date.now()) {
        // Shield consumed on use — clear it
        victim.powerup = undefined;
        return;
      }

      victim.status = 'dead';

      this.gameState.deadBody = {
        playerId: data.victimId,
        location: victim.location,
      };

      this.checkWinCondition();
    }
  }

  handleReportBody(msg: ClientMessage) {
    if (!this.gameState || !this.gameState.deadBody) return;

    // Reporter must be at the body's location
    const reporter = this.gameState.players[msg.playerId];
    if (!reporter || reporter.location !== this.gameState.deadBody.location) return;

    this.gameState.deadBody.reportedBy = msg.playerId;
    this.startMeeting();
  }

  handleCallMeeting(msg: ClientMessage) {
    if (!this.gameState) return;
    this.startMeeting();
  }

  startMeeting() {
    if (!this.gameState) return;

    this.gameState.phase = 'meeting';
    this.gameState.votes = {};
    this.gameState.timer = {
      duration: GAME_CONFIG.DISCUSSION_TIME,
      startTime: Date.now(),
    };

    // After discussion time, move to voting
    setTimeout(() => {
      if (this.gameState) {
        this.gameState.phase = 'voting';
        this.gameState.timer = {
          duration: GAME_CONFIG.VOTING_TIME,
          startTime: Date.now(),
        };
        this.broadcast();

        // After voting time, count votes and eject player
        setTimeout(() => {
          this.countVotes();
        }, GAME_CONFIG.VOTING_TIME * 1000);
      }
    }, GAME_CONFIG.DISCUSSION_TIME * 1000);
  }

  handleChat(msg: ClientMessage) {
    if (!this.gameState) return;

    const player = this.gameState.players[msg.playerId];

    if (player) {
      this.gameState.chat.push({
        id: `${Date.now()}-${msg.playerId}`,
        playerId: msg.playerId,
        playerName: player.name,
        message: msg.data.message,
        timestamp: Date.now(),
      });

      // Keep only last 50 messages
      if (this.gameState.chat.length > 50) {
        this.gameState.chat = this.gameState.chat.slice(-50);
      }
    }
  }

  handleVote(msg: ClientMessage) {
    if (!this.gameState) return;

    const { playerId, data } = msg;
    this.gameState.votes[playerId] = data.votedForId;
  }

  handleKonamiKill() {
    if (!this.gameState) return;

    // Kill everyone
    Object.values(this.gameState.players).forEach(p => {
      p.status = 'dead';
    });

    this.gameState.phase = 'gameOver';
    this.gameState.winner = 'konami';
    this.broadcast();
  }

  handleSabotage(msg: ClientMessage) {
    if (!this.gameState || this.gameState.phase !== 'playing') return;

    const player = this.gameState.players[msg.playerId];
    if (!player || player.role !== 'impostor') return;

    if (msg.data?.type === 'lightsOut') {
      // Can't stack lights out
      if (this.gameState.lightsOut && this.gameState.lightsOut.until > Date.now()) return;

      this.gameState.lightsOut = {
        until: Date.now() + 30000, // 30 seconds
      };

      // Auto-clear after 30s
      setTimeout(() => {
        if (this.gameState) {
          this.gameState.lightsOut = undefined;
          this.broadcast();
        }
      }, 30000);
    }
  }

  handleEnterSecretRoom(msg: ClientMessage) {
    if (!this.gameState || this.gameState.phase !== 'playing') return;

    const player = this.gameState.players[msg.playerId];
    if (!player || player.status !== 'alive') return;

    // Must be in the room with the secret entrance
    if (player.location !== this.gameState.secretRoomEntrance) return;

    // Already have an active powerup? Can't stack.
    if (player.powerup && player.powerup.until > Date.now()) return;

    // Move player to secret room
    player.location = 'secret';

    // Assign random powerup based on role
    const INNOCENT_POWERUPS: PowerupType[] = ['sixthSense', 'radar', 'shield'];
    const IMPOSTOR_POWERUPS: PowerupType[] = ['shadowWalk', 'tracker', 'bloodhound'];

    const pool = player.role === 'impostor' ? IMPOSTOR_POWERUPS : INNOCENT_POWERUPS;
    const powerup = pool[Math.floor(Math.random() * pool.length)];

    player.powerup = {
      type: powerup,
      until: Date.now() + 30000, // 30 seconds
    };

    // Auto-clear powerup after 30s
    const pid = msg.playerId;
    setTimeout(() => {
      if (this.gameState?.players[pid]?.powerup) {
        this.gameState.players[pid].powerup = undefined;
        this.broadcast();
      }
    }, 30000);
  }

  countVotes() {
    if (!this.gameState) return;

    const voteCounts: Record<string, number> = {};

    Object.values(this.gameState.votes).forEach(votedForId => {
      voteCounts[votedForId] = (voteCounts[votedForId] || 0) + 1;
    });

    // Find player with most votes
    let maxVotes = 0;
    let ejectedId = '';

    Object.entries(voteCounts).forEach(([playerId, count]) => {
      if (count > maxVotes) {
        maxVotes = count;
        ejectedId = playerId;
      }
    });

    // Eject player if they have at least 2 votes (prevent random ejection)
    if (ejectedId && maxVotes >= 2) {
      this.gameState.players[ejectedId].status = 'dead';
    }

    this.gameState.phase = 'results';
    this.gameState.deadBody = undefined;

    // Return to playing after 5 seconds
    setTimeout(() => {
      if (this.gameState) {
        this.gameState.phase = 'playing';
        this.gameState.chat = [];
        this.broadcast();

        this.checkWinCondition();
      }
    }, 5000);

    this.broadcast();
  }

  checkWinCondition() {
    if (!this.gameState) return;

    const alivePlayers = Object.values(this.gameState.players).filter(p => p.status === 'alive');
    const aliveImpostors = alivePlayers.filter(p => p.role === 'impostor');
    const aliveInnocents = alivePlayers.filter(p => p.role === 'innocent');

    // Impostors win if they equal or outnumber innocents
    if (aliveImpostors.length >= aliveInnocents.length && aliveImpostors.length > 0) {
      this.gameState.phase = 'gameOver';
      this.gameState.winner = 'impostors';
      this.broadcast();
      return;
    }

    // Innocents win if all impostors are dead
    if (aliveImpostors.length === 0) {
      this.gameState.phase = 'gameOver';
      this.gameState.winner = 'innocents';
      this.broadcast();
      return;
    }

    // Innocents can also win by completing all tasks
    const totalTasks = aliveInnocents.length * GAME_CONFIG.TASKS_PER_PLAYER;
    const completedTasks = aliveInnocents.reduce((sum, p) => sum + p.tasksCompleted, 0);

    if (completedTasks >= totalTasks) {
      this.gameState.phase = 'gameOver';
      this.gameState.winner = 'innocents';
      this.broadcast();
    }
  }

  broadcast() {
    if (!this.gameState) return;
    const message = JSON.stringify({ type: 'gameState', data: this.gameState });
    console.log('Broadcasting to', Object.keys(this.gameState.players).length, 'players, phase:', this.gameState.phase);
    this.room.broadcast(message);
  }

  onClose(connection: Party.Connection) {
    console.log('Player disconnected:', connection.id);
    // Don't remove players on disconnect - they might reconnect
    // This prevents issues with Safari tab suspension and page navigation
  }
}

GameServer satisfies Party.Worker;
