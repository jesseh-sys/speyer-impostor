import type * as Party from "partykit/server";
import { GameState, Player, ClientMessage, PlayerRole, Task, PowerupType } from "../types/game";
import { LOCATIONS, TASKS, PLAYER_ICONS, PLAYER_COLORS, GAME_CONFIG, getImpostorCount } from "../lib/gameConfig";

export default class GameServer implements Party.Server {
  gameState: GameState | null = null;

  // Server-side state (not broadcast to clients)
  private lastKillTimes: Record<string, number> = {};
  private lastMeetingTime: number = 0;
  private lastSabotageTime: number = 0;
  private gameTimerHandle: ReturnType<typeof setTimeout> | null = null;
  private meetingTimers: ReturnType<typeof setTimeout>[] = [];
  private connectionToPlayer: Map<string, string> = new Map();

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
        deadBodies: [],
      };
    }

    // Send safe initial state (roles masked) — proper filtered state sent after 'identify'
    console.log('Sending initial state to connection:', conn.id);
    const safeState = this.maskRoles(this.gameState);
    conn.send(JSON.stringify({ type: 'gameState', data: safeState }));
  }

  onMessage(message: string, sender: Party.Connection) {
    const msg: ClientMessage = JSON.parse(message);

    if (!this.gameState) return;

    // Track connection-to-player mapping
    if (msg.playerId) {
      this.connectionToPlayer.set(sender.id, msg.playerId);
    }

    // Identify: re-send properly filtered state to this connection
    if (msg.type === 'identify') {
      const filtered = this.filterStateForPlayer(msg.playerId);
      sender.send(JSON.stringify({ type: 'gameState', data: filtered }));
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

    this.broadcastFiltered();
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

    // Game timer — innocents win if time runs out (impostors must act)
    this.gameTimerHandle = setTimeout(() => {
      if (this.gameState && this.gameState.phase === 'playing') {
        this.gameState.phase = 'gameOver';
        this.gameState.winner = 'innocents';
        this.broadcastFiltered();
      }
    }, GAME_CONFIG.GAME_DURATION * 1000);
  }

  assignTasks(playerId: string) {
    if (!this.gameState) return;

    const shuffledTasks = [...TASKS];
    for (let i = shuffledTasks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledTasks[i], shuffledTasks[j]] = [shuffledTasks[j], shuffledTasks[i]];
    }
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
    if (!this.gameState || this.gameState.phase !== 'playing') return;

    const { playerId, data } = msg;
    const player = this.gameState.players[playerId];
    if (!player || player.status !== 'alive') return;

    // Locked doors: no movement allowed
    if (this.gameState.doorsLocked && this.gameState.doorsLocked.until > Date.now()) return;

    // Validate the destination is connected to the player's current location
    const currentLoc = this.gameState.locations.find(l => l.id === player.location);
    if (!currentLoc || !currentLoc.connectedTo.includes(data.location)) return;

    player.location = data.location;
  }

  handleCompleteTask(msg: ClientMessage) {
    if (!this.gameState || this.gameState.phase !== 'playing') return;

    const { playerId, data } = msg;
    const player = this.gameState.players[playerId];
    if (!player || player.role !== 'innocent' || player.status !== 'alive') return;

    // Validate the task exists, belongs to this player, and they're at the right location
    const task = this.gameState.tasks.find(t => t.id === data.taskId);
    if (!task) return;
    if (!task.id.startsWith(playerId)) return;
    if (task.location !== player.location) return;

    player.tasksCompleted++;
    this.gameState.tasks = this.gameState.tasks.filter(t => t.id !== data.taskId);
    this.checkWinCondition();
  }

  handleKill(msg: ClientMessage) {
    if (!this.gameState || this.gameState.phase !== 'playing') return;

    const { playerId, data } = msg;
    const killer = this.gameState.players[playerId];
    const victim = this.gameState.players[data.victimId];

    if (!killer || killer.role !== 'impostor' || killer.status !== 'alive') return;
    if (!victim || victim.status !== 'alive') return;

    // Kill cooldown enforcement
    const now = Date.now();
    const lastKill = this.lastKillTimes[playerId] || 0;
    if (now - lastKill < GAME_CONFIG.KILL_COOLDOWN * 1000) return;

    // Killer must be in the same room as victim
    if (killer.location !== victim.location) return;

    // Shield powerup blocks the kill
    if (victim.powerup?.type === 'shield' && victim.powerup.until > Date.now()) {
      victim.powerup = undefined; // Shield consumed
      this.lastKillTimes[playerId] = now; // Cooldown still triggers
      return;
    }

    victim.status = 'dead';
    this.lastKillTimes[playerId] = now;

    this.gameState.deadBodies.push({
      playerId: data.victimId,
      location: victim.location,
    });

    this.checkWinCondition();
  }

  handleReportBody(msg: ClientMessage) {
    if (!this.gameState || this.gameState.phase !== 'playing') return;
    if (this.gameState.deadBodies.length === 0) return;

    const reporter = this.gameState.players[msg.playerId];
    if (!reporter || reporter.status !== 'alive') return;

    // Find a body at the reporter's location
    const body = this.gameState.deadBodies.find(b => b.location === reporter.location && !b.reportedBy);
    if (!body) return;

    body.reportedBy = msg.playerId;
    this.startMeeting();
  }

  handleCallMeeting(msg: ClientMessage) {
    if (!this.gameState || this.gameState.phase !== 'playing') return;

    const player = this.gameState.players[msg.playerId];
    if (!player || player.status !== 'alive') return;

    // Meeting cooldown — 30s between meetings
    const now = Date.now();
    if (now - this.lastMeetingTime < 30000) return;

    this.startMeeting();
  }

  startMeeting() {
    if (!this.gameState) return;

    // Clear any pending meeting timers from previous meetings
    this.meetingTimers.forEach(t => clearTimeout(t));
    this.meetingTimers = [];

    this.lastMeetingTime = Date.now();
    this.gameState.phase = 'meeting';
    this.gameState.votes = {};
    this.gameState.timer = {
      duration: GAME_CONFIG.DISCUSSION_TIME,
      startTime: Date.now(),
    };

    // After discussion time, move to voting
    const votingTimer = setTimeout(() => {
      if (this.gameState && this.gameState.phase === 'meeting') {
        this.gameState.phase = 'voting';
        this.gameState.timer = {
          duration: GAME_CONFIG.VOTING_TIME,
          startTime: Date.now(),
        };
        this.broadcastFiltered();

        // After voting time, count votes and eject player
        const countTimer = setTimeout(() => {
          if (this.gameState && this.gameState.phase === 'voting') {
            this.countVotes();
          }
        }, GAME_CONFIG.VOTING_TIME * 1000);
        this.meetingTimers.push(countTimer);
      }
    }, GAME_CONFIG.DISCUSSION_TIME * 1000);
    this.meetingTimers.push(votingTimer);
  }

  handleChat(msg: ClientMessage) {
    if (!this.gameState) return;

    const player = this.gameState.players[msg.playerId];

    if (player && player.status === 'alive') {
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
    if (!this.gameState || this.gameState.phase !== 'voting') return;

    const { playerId, data } = msg;
    const player = this.gameState.players[playerId];
    if (!player || player.status !== 'alive') return;

    // Can't change your vote
    if (this.gameState.votes[playerId] !== undefined) return;

    this.gameState.votes[playerId] = data.votedForId;
  }

  handleKonamiKill() {
    if (!this.gameState) return;
    // Only allow during active gameplay phases (not lobby, not already game over)
    if (this.gameState.phase === 'lobby' || this.gameState.phase === 'gameOver') return;

    // Clear all timers
    this.meetingTimers.forEach(t => clearTimeout(t));
    this.meetingTimers = [];
    if (this.gameTimerHandle) clearTimeout(this.gameTimerHandle);

    Object.values(this.gameState.players).forEach(p => {
      p.status = 'dead';
    });

    this.gameState.phase = 'gameOver';
    this.gameState.winner = 'konami';
    this.broadcastFiltered();
  }

  handleSabotage(msg: ClientMessage) {
    if (!this.gameState || this.gameState.phase !== 'playing') return;

    const player = this.gameState.players[msg.playerId];
    if (!player || player.role !== 'impostor' || player.status !== 'alive') return;

    // Global sabotage cooldown — 45s between any sabotage
    const now = Date.now();
    if (now - this.lastSabotageTime < 45000) return;

    // Can't stack active sabotages
    if (this.gameState.lightsOut && this.gameState.lightsOut.until > now) return;
    if (this.gameState.doorsLocked && this.gameState.doorsLocked.until > now) return;

    const sabotageType = msg.data?.type;

    if (sabotageType === 'lightsOut') {
      this.lastSabotageTime = now;
      this.gameState.lightsOut = { until: now + 30000 };
      setTimeout(() => {
        if (this.gameState) {
          this.gameState.lightsOut = undefined;
          this.broadcastFiltered();
        }
      }, 30000);
    } else if (sabotageType === 'doorsLocked') {
      this.lastSabotageTime = now;
      this.gameState.doorsLocked = { until: now + 25000 };
      setTimeout(() => {
        if (this.gameState) {
          this.gameState.doorsLocked = undefined;
          this.broadcastFiltered();
        }
      }, 25000);
    } else if (sabotageType === 'scramble') {
      this.lastSabotageTime = now;
      // Randomly teleport all alive players to different rooms
      const alivePlayers = Object.values(this.gameState.players).filter(p => p.status === 'alive');
      const roomIds = this.gameState.locations.filter(l => l.id !== 'secret').map(l => l.id);
      for (const p of alivePlayers) {
        p.location = roomIds[Math.floor(Math.random() * roomIds.length)];
      }
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
        this.broadcastFiltered();
      }
    }, 30000);
  }

  countVotes() {
    if (!this.gameState) return;

    const voteCounts: Record<string, number> = {};

    Object.values(this.gameState.votes).forEach(votedForId => {
      voteCounts[votedForId] = (voteCounts[votedForId] || 0) + 1;
    });

    // Find player with most votes (exclude 'skip')
    let maxVotes = 0;
    let ejectedId = '';

    Object.entries(voteCounts).forEach(([id, count]) => {
      if (id === 'skip') return; // Skip votes don't eject anyone
      if (count > maxVotes) {
        maxVotes = count;
        ejectedId = id;
      }
    });

    // Eject player if they have at least 2 votes and player exists
    if (ejectedId && maxVotes >= 2 && this.gameState.players[ejectedId]) {
      this.gameState.players[ejectedId].status = 'dead';
    }

    this.gameState.phase = 'results';
    this.gameState.deadBodies = []; // Clear all bodies after meeting

    // Return to playing after 5 seconds
    const resumeTimer = setTimeout(() => {
      if (this.gameState && this.gameState.phase === 'results') {
        this.gameState.phase = 'playing';
        this.gameState.chat = [];
        this.broadcastFiltered();

        this.checkWinCondition();
      }
    }, 5000);
    this.meetingTimers.push(resumeTimer);

    this.broadcastFiltered();
  }

  checkWinCondition() {
    if (!this.gameState) return;
    if (this.gameState.phase === 'gameOver') return;

    const alivePlayers = Object.values(this.gameState.players).filter(p => p.status === 'alive');
    const aliveImpostors = alivePlayers.filter(p => p.role === 'impostor');
    const aliveInnocents = alivePlayers.filter(p => p.role === 'innocent');

    // Impostors win if they equal or outnumber innocents
    if (aliveImpostors.length >= aliveInnocents.length && aliveImpostors.length > 0) {
      this.endGame('impostors');
      return;
    }

    // Innocents win if all impostors are dead
    if (aliveImpostors.length === 0) {
      this.endGame('innocents');
      return;
    }

    // Task win: count ALL innocents (dead + alive) so completed progress is never lost
    const allInnocents = Object.values(this.gameState.players).filter(p => p.role === 'innocent');
    const totalTasks = allInnocents.length * GAME_CONFIG.TASKS_PER_PLAYER;
    const completedTasks = allInnocents.reduce((sum, p) => sum + p.tasksCompleted, 0);

    if (completedTasks >= totalTasks) {
      this.endGame('innocents');
    }
  }

  endGame(winner: 'innocents' | 'impostors') {
    if (!this.gameState) return;

    // Clear all timers
    this.meetingTimers.forEach(t => clearTimeout(t));
    this.meetingTimers = [];
    if (this.gameTimerHandle) {
      clearTimeout(this.gameTimerHandle);
      this.gameTimerHandle = null;
    }

    this.gameState.phase = 'gameOver';
    this.gameState.winner = winner;
    this.broadcastFiltered();
  }

  // Send per-player filtered state to each connection
  broadcastFiltered() {
    if (!this.gameState) return;

    for (const conn of this.room.getConnections()) {
      const playerId = this.connectionToPlayer.get(conn.id);
      if (playerId) {
        const filtered = this.filterStateForPlayer(playerId);
        conn.send(JSON.stringify({ type: 'gameState', data: filtered }));
      } else {
        // Unknown connection — send safe masked state
        const safe = this.maskRoles(this.gameState);
        conn.send(JSON.stringify({ type: 'gameState', data: safe }));
      }
    }
  }

  // Mask all roles as 'innocent' (safe default for unknown connections)
  maskRoles(gs: GameState): GameState {
    if (gs.phase === 'gameOver') return gs; // Roles revealed at game over
    const filteredPlayers: Record<string, Player> = {};
    for (const [id, p] of Object.entries(gs.players)) {
      filteredPlayers[id] = { ...p, role: 'innocent', powerup: undefined };
    }
    return { ...gs, players: filteredPlayers, tasks: [] };
  }

  // Filter state for a specific player — hide what they shouldn't see
  filterStateForPlayer(playerId: string): GameState {
    if (!this.gameState) return this.gameState!;

    const gs = this.gameState;
    const player = gs.players[playerId];
    if (!player) return this.maskRoles(gs);

    // During game over, reveal everything
    if (gs.phase === 'gameOver') return gs;

    const isImpostor = player.role === 'impostor';

    // Filter players — hide roles and powerups of others
    const filteredPlayers: Record<string, Player> = {};
    for (const [id, p] of Object.entries(gs.players)) {
      if (id === playerId) {
        filteredPlayers[id] = p; // Full info for yourself
        continue;
      }
      const fp = { ...p };

      // Roles: impostors see each other, innocents see everyone as innocent
      if (!isImpostor) {
        fp.role = 'innocent';
      }

      // Hide powerups on other players
      fp.powerup = undefined;

      filteredPlayers[id] = fp;
    }

    // Tasks: only your own
    const filteredTasks = gs.tasks.filter(t => t.id.startsWith(playerId));

    // Compute sixth sense warning server-side
    const hasSixthSense = player.powerup?.type === 'sixthSense' && player.powerup.until > Date.now();
    const sixthSenseWarning = hasSixthSense &&
      Object.values(gs.players).some(p =>
        p.id !== playerId && p.role === 'impostor' && p.status === 'alive' && p.location === player.location
      );

    // Compute bloodhound target server-side
    let bloodhoundTarget: { name: string; locationName: string; color: string } | undefined;
    if (player.powerup?.type === 'bloodhound' && player.powerup.until > Date.now()) {
      const aliveInnocents = Object.values(gs.players).filter(
        p => p.status === 'alive' && p.id !== playerId && p.role !== 'impostor'
      );
      if (aliveInnocents.length > 0) {
        let mostIsolated = aliveInnocents[0];
        let leastCompany = Infinity;
        for (const p of aliveInnocents) {
          const company = aliveInnocents.filter(o => o.location === p.location && o.id !== p.id).length;
          if (company < leastCompany) {
            leastCompany = company;
            mostIsolated = p;
          }
        }
        const loc = gs.locations.find(l => l.id === mostIsolated.location);
        bloodhoundTarget = { name: mostIsolated.name, locationName: loc?.name || '???', color: mostIsolated.color };
      }
    }

    return {
      ...gs,
      players: filteredPlayers,
      tasks: filteredTasks,
      sixthSenseWarning: sixthSenseWarning || undefined,
      bloodhoundTarget,
    };
  }

  onClose(connection: Party.Connection) {
    this.connectionToPlayer.delete(connection.id);
    // Don't remove players on disconnect - they might reconnect
  }
}

GameServer satisfies Party.Worker;
