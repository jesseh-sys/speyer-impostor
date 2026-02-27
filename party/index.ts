import type * as Party from "partykit/server";
import { GameState, Player, ClientMessage, PlayerRole, Task } from "../types/game";
import { LOCATIONS, TASKS, PLAYER_COLORS, GAME_CONFIG, getImpostorCount } from "../lib/gameConfig";

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
    }

    this.broadcast();
  }

  handleJoin(msg: ClientMessage, sender: Party.Connection) {
    if (!this.gameState) return;

    const playerName = msg.data.playerName;
    const playerId = msg.playerId; // Use the persistent player ID from the client
    const icon = msg.data.icon || '😎';
    const color = msg.data.color || PLAYER_COLORS[0];

    // If player already exists, just update their info (reconnection)
    if (this.gameState.players[playerId]) {
      console.log('Player reconnected:', playerId);
      this.gameState.players[playerId].name = playerName;
      this.gameState.players[playerId].icon = icon;
      this.gameState.players[playerId].color = color;
      return;
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

    // Assign impostor roles
    const impostorCount = getImpostorCount(playerCount);
    const shuffled = [...playerIds].sort(() => Math.random() - 0.5);
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
