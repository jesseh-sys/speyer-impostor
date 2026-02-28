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
  private meetingStartedAt: number = 0; // When the current meeting began (for powerup pause)
  private hostId: string | null = null; // First player to join is host
  private disconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private lastEjection?: { playerId: string; role: PlayerRole };
  private gameTimeRemaining: number = 0; // ms remaining on game clock (paused during meetings)
  private ephemeralTimers: ReturnType<typeof setTimeout>[] = []; // sabotage/powerup timers (cleared on restart)
  private meetingsCalled: Set<string> = new Set(); // players who used their 1 emergency meeting
  private meetingLocations: Record<string, string> = {}; // snapshot of player locations at meeting start
  private reportedBody?: { name: string; location: string; reportedBy: string };

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
        locations: LOCATIONS.map(l => ({ ...l, connectedTo: [...l.connectedTo] })),
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
    let msg: ClientMessage;
    try {
      msg = JSON.parse(message);
    } catch {
      console.error('Bad message from', sender.id, ':', message.slice(0, 100));
      return;
    }

    if (!this.gameState) return;

    // 'join' and 'identify' establish the connection-to-player mapping
    if (msg.type === 'join' || msg.type === 'identify') {
      if (msg.playerId) {
        this.connectionToPlayer.set(sender.id, msg.playerId);
        // Cancel disconnect timer if they're reconnecting
        const dcTimer = this.disconnectTimers.get(msg.playerId);
        if (dcTimer) {
          clearTimeout(dcTimer);
          this.disconnectTimers.delete(msg.playerId);
        }
      }
    }

    // Identify: re-send properly filtered state to this connection
    if (msg.type === 'identify') {
      const filtered = this.filterStateForPlayer(msg.playerId);
      sender.send(JSON.stringify({ type: 'gameState', data: filtered }));
      return;
    }

    // For all non-join messages, use the server-side connection mapping
    // to prevent player ID spoofing
    const authenticatedPlayerId = this.connectionToPlayer.get(sender.id);
    if (msg.type !== 'join' && !authenticatedPlayerId) return;
    if (msg.type !== 'join') {
      msg.playerId = authenticatedPlayerId!;
    }

    // Validate msg.data exists for handlers that need it
    const needsData = ['join', 'move', 'completeTask', 'kill', 'chat', 'vote', 'sabotage'];
    if (needsData.includes(msg.type) && !msg.data) return;

    switch (msg.type) {
      case 'join':
        this.handleJoin(msg, sender);
        break;
      case 'startGame':
        if (msg.playerId === this.hostId) {
          this.handleStartGame();
        }
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
      case 'sabotage':
        this.handleSabotage(msg);
        break;
      case 'enterSecretRoom':
        this.handleEnterSecretRoom(msg);
        break;
      case 'restartGame':
        this.handleRestartGame();
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

    // If player already exists, just update their connection (reconnection)
    if (this.gameState.players[playerId]) {
      console.log('Player reconnected:', playerId);
      // Don't allow appearance changes mid-game
      if (this.gameState.phase === 'lobby') {
        // Dedup against other players before updating
        const others = Object.values(this.gameState.players).filter(p => p.id !== playerId);
        const takenNames = new Set(others.map(p => p.name));
        if (takenNames.has(playerName)) {
          let suffix = 2;
          while (takenNames.has(`${playerName}${suffix}`)) suffix++;
          playerName = `${playerName}${suffix}`;
        }
        const takenIcons = new Set(others.map(p => p.icon));
        if (takenIcons.has(icon)) {
          const available = PLAYER_ICONS.find(i => !takenIcons.has(i));
          if (available) icon = available;
        }
        const takenColors = new Set(others.map(p => p.color));
        if (takenColors.has(color)) {
          const available = PLAYER_COLORS.find(c => !takenColors.has(c));
          if (available) color = available;
        }
        this.gameState.players[playerId].name = playerName;
        this.gameState.players[playerId].icon = icon;
        this.gameState.players[playerId].color = color;
      }
      return;
    }

    // New players can only join during lobby
    if (this.gameState.phase !== 'lobby') return;

    // Enforce max player limit
    if (Object.keys(this.gameState.players).length >= GAME_CONFIG.MAX_PLAYERS) return;

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

    // First player to join becomes host
    if (!this.hostId) {
      this.hostId = playerId;
    }
    this.gameState.hostId = this.hostId;
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
    this.gameTimeRemaining = GAME_CONFIG.GAME_DURATION * 1000;
    this.startGameTimer();
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
    if (!player) return;

    // Dead players move as ghosts (no door lock restriction)
    if (player.status === 'dead') {
      const currentLoc = this.gameState.locations.find(l => l.id === player.location);
      if (!currentLoc || !currentLoc.connectedTo.includes(data.location)) return;
      player.location = data.location;
      return;
    }

    if (player.status !== 'alive') return;

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
    if (!player || player.role !== 'innocent') return;

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
    if (playerId === data.victimId) return; // Can't self-kill
    if (victim.role === 'impostor') return; // Can't kill co-impostor

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
    const bodyPlayer = this.gameState.players[body.playerId];
    const bodyLoc = this.gameState.locations.find(l => l.id === body.location);
    this.reportedBody = {
      name: bodyPlayer?.name || '???',
      location: bodyLoc?.name || '???',
      reportedBy: reporter.name,
    };
    this.startMeeting();
  }

  handleCallMeeting(msg: ClientMessage) {
    if (!this.gameState || this.gameState.phase !== 'playing') return;

    const player = this.gameState.players[msg.playerId];
    if (!player || player.status !== 'alive') return;

    // Each player gets 1 emergency meeting per game
    if (this.meetingsCalled.has(msg.playerId)) return;

    // Meeting cooldown — 30s between meetings
    const now = Date.now();
    if (now - this.lastMeetingTime < 30000) return;

    this.meetingsCalled.add(msg.playerId);
    this.reportedBody = undefined;
    this.startMeeting();
  }

  startMeeting() {
    if (!this.gameState) return;

    // Clear any pending meeting timers from previous meetings
    this.meetingTimers.forEach(t => clearTimeout(t));
    this.meetingTimers = [];

    // Snapshot player locations at meeting start (hide secret room)
    this.meetingLocations = {};
    for (const [id, p] of Object.entries(this.gameState.players)) {
      if (p.status === 'alive') {
        if (p.location === 'secret') {
          // Show the entrance room instead to keep secret room hidden
          const entrance = this.gameState.locations.find(l => l.id === this.gameState!.secretRoomEntrance);
          this.meetingLocations[id] = entrance?.name || '???';
        } else {
          const loc = this.gameState.locations.find(l => l.id === p.location);
          this.meetingLocations[id] = loc?.name || p.location;
        }
      }
    }

    this.lastMeetingTime = Date.now();
    this.meetingStartedAt = Date.now();
    this.pauseGameTimer(); // Pause game clock during meetings
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
    // Only allow chat during meeting/voting phases
    if (this.gameState.phase !== 'meeting' && this.gameState.phase !== 'voting') return;

    const player = this.gameState.players[msg.playerId];

    if (player && player.status === 'alive') {
      const message = typeof msg.data.message === 'string' ? msg.data.message.slice(0, 200) : '';
      if (!message) return;

      this.gameState.chat.push({
        id: `${Date.now()}-${msg.playerId}`,
        playerId: msg.playerId,
        playerName: player.name,
        message,
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

    // Can't vote for yourself
    const targetId = data.votedForId;
    if (targetId === playerId) return;

    // Validate vote target: must be 'skip' or an alive player
    if (targetId !== 'skip') {
      const target = this.gameState.players[targetId];
      if (!target || target.status !== 'alive') return;
    }

    this.gameState.votes[playerId] = targetId;

    // Short-circuit: end voting early when all alive players have voted
    const allAlive = Object.values(this.gameState.players).filter(p => p.status === 'alive');
    if (allAlive.every(p => this.gameState!.votes[p.id] !== undefined)) {
      this.countVotes();
    }
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
      this.ephemeralTimers.push(setTimeout(() => {
        if (this.gameState && this.gameState.phase === 'playing') {
          this.gameState.lightsOut = undefined;
          this.broadcastFiltered();
        }
      }, 30000));
    } else if (sabotageType === 'doorsLocked') {
      this.lastSabotageTime = now;
      this.gameState.doorsLocked = { until: now + 25000 };
      this.ephemeralTimers.push(setTimeout(() => {
        if (this.gameState && this.gameState.phase === 'playing') {
          this.gameState.doorsLocked = undefined;
          this.broadcastFiltered();
        }
      }, 25000));
    } else if (sabotageType === 'scramble') {
      this.lastSabotageTime = now;
      // Randomly teleport all alive players to different rooms
      const alivePlayers = Object.values(this.gameState.players).filter(p => p.status === 'alive');
      const roomIds = this.gameState.locations.filter(l => l.id !== 'secret').map(l => l.id);
      for (const p of alivePlayers) {
        p.location = roomIds[Math.floor(Math.random() * roomIds.length)];
      }
      // Brief flash so players know what happened
      this.gameState.scrambled = { until: now + 3000 };
      this.ephemeralTimers.push(setTimeout(() => {
        if (this.gameState && this.gameState.phase === 'playing') {
          this.gameState.scrambled = undefined;
          this.broadcastFiltered();
        }
      }, 3000));
    }
  }

  handleEnterSecretRoom(msg: ClientMessage) {
    if (!this.gameState || this.gameState.phase !== 'playing') return;

    // Can't enter secret room during door lock
    if (this.gameState.doorsLocked && this.gameState.doorsLocked.until > Date.now()) return;

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

    // Auto-clear powerup after expiry (checks timestamp, so meetings extending it still work)
    const pid = msg.playerId;
    const checkPowerupExpiry = () => {
      const p = this.gameState?.players[pid];
      if (!p?.powerup) return;
      const remaining = p.powerup.until - Date.now();
      if (remaining <= 0) {
        p.powerup = undefined;
        this.broadcastFiltered();
      } else {
        // Re-check after remaining time (handles meeting extensions)
        this.ephemeralTimers.push(setTimeout(checkPowerupExpiry, remaining + 100));
      }
    };
    this.ephemeralTimers.push(setTimeout(checkPowerupExpiry, 30000));
  }

  countVotes() {
    if (!this.gameState) return;
    if (this.gameState.phase !== 'voting') return; // Prevent double-fire

    const voteCounts: Record<string, number> = {};

    Object.values(this.gameState.votes).forEach(votedForId => {
      voteCounts[votedForId] = (voteCounts[votedForId] || 0) + 1;
    });

    // Find player with most votes (exclude 'skip'), detect ties
    let maxVotes = 0;
    let ejectedId = '';
    let isTied = false;

    Object.entries(voteCounts).forEach(([id, count]) => {
      if (id === 'skip') return;
      if (count > maxVotes) {
        maxVotes = count;
        ejectedId = id;
        isTied = false;
      } else if (count === maxVotes && maxVotes > 0) {
        isTied = true; // Tie — no one gets ejected
      }
    });

    // Eject requires majority of alive players AND no tie
    const aliveCount = Object.values(this.gameState.players).filter(p => p.status === 'alive').length;
    const votesNeeded = Math.floor(aliveCount / 2) + 1;

    // Store ejection result so the results phase can show the true role
    let ejectedPlayerId: string | undefined;
    let ejectedRole: PlayerRole | undefined;

    if (!isTied && ejectedId && maxVotes >= votesNeeded && this.gameState.players[ejectedId]) {
      ejectedRole = this.gameState.players[ejectedId].role;
      this.gameState.players[ejectedId].status = 'dead';
      ejectedPlayerId = ejectedId;
    }

    // Store ejection info for the results phase (so clients can show true role)
    this.lastEjection = ejectedPlayerId ? { playerId: ejectedPlayerId, role: ejectedRole! } : undefined;

    this.gameState.phase = 'results';
    this.gameState.deadBodies = []; // Clear all bodies after meeting

    // Return to playing after 5 seconds
    const resumeTimer = setTimeout(() => {
      if (this.gameState && this.gameState.phase === 'results') {
        // Extend active powerups by the time spent in meeting/voting/results
        const meetingDuration = Date.now() - this.meetingStartedAt;
        for (const player of Object.values(this.gameState.players)) {
          if (player.powerup && player.powerup.until > this.meetingStartedAt) {
            player.powerup.until += meetingDuration;
          }
        }

        this.gameState.phase = 'playing';
        this.gameState.chat = [];
        // Restore the game timer display for clients
        this.gameState.timer = {
          duration: Math.ceil(this.gameTimeRemaining / 1000),
          startTime: Date.now(),
        };
        this.startGameTimer(); // Resume game clock
        this.checkWinCondition(); // Check before broadcast to avoid flicker
        this.broadcastFiltered();
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

  startGameTimer() {
    if (this.gameTimerHandle) clearTimeout(this.gameTimerHandle);
    const startedAt = Date.now();
    this.gameTimerHandle = setTimeout(() => {
      if (this.gameState && this.gameState.phase === 'playing') {
        this.endGame('innocents');
      }
    }, this.gameTimeRemaining);
    // Track when we started so we can compute remaining on pause
    this._gameTimerStartedAt = startedAt;
  }

  pauseGameTimer() {
    if (this.gameTimerHandle) {
      clearTimeout(this.gameTimerHandle);
      this.gameTimerHandle = null;
    }
    // Deduct elapsed time
    if (this._gameTimerStartedAt) {
      const elapsed = Date.now() - this._gameTimerStartedAt;
      this.gameTimeRemaining = Math.max(0, this.gameTimeRemaining - elapsed);
      this._gameTimerStartedAt = 0;
    }
  }

  private _gameTimerStartedAt: number = 0;

  endGame(winner: 'innocents' | 'impostors') {
    if (!this.gameState) return;

    // Clear all timers
    this.meetingTimers.forEach(t => clearTimeout(t));
    this.meetingTimers = [];
    this.ephemeralTimers.forEach(t => clearTimeout(t));
    this.ephemeralTimers = [];
    if (this.gameTimerHandle) {
      clearTimeout(this.gameTimerHandle);
      this.gameTimerHandle = null;
    }
    this.disconnectTimers.forEach(t => clearTimeout(t));
    this.disconnectTimers.clear();

    this.gameState.phase = 'gameOver';
    this.gameState.winner = winner;
    this.broadcastFiltered();
  }

  handleRestartGame() {
    if (!this.gameState) return;
    // Only allow restart when game is over
    if (this.gameState.phase !== 'gameOver') return;

    // Clear all timers
    this.meetingTimers.forEach(t => clearTimeout(t));
    this.meetingTimers = [];
    this.ephemeralTimers.forEach(t => clearTimeout(t));
    this.ephemeralTimers = [];
    if (this.gameTimerHandle) {
      clearTimeout(this.gameTimerHandle);
      this.gameTimerHandle = null;
    }

    // Reset all players to lobby state, keep names/icons/colors
    for (const player of Object.values(this.gameState.players)) {
      player.role = 'innocent';
      player.status = 'alive';
      player.location = 'speyer';
      player.tasksCompleted = 0;
      player.totalTasks = GAME_CONFIG.TASKS_PER_PLAYER;
      player.powerup = undefined;
    }

    // Reset game state
    this.gameState.phase = 'lobby';
    this.gameState.tasks = [];
    this.gameState.chat = [];
    this.gameState.votes = {};
    this.gameState.deadBodies = [];
    this.gameState.timer = undefined;
    this.gameState.winner = undefined;
    this.gameState.lightsOut = undefined;
    this.gameState.doorsLocked = undefined;
    this.gameState.secretRoomMethod = undefined;
    this.gameState.secretRoomEntrance = undefined;
    this.gameState.scrambled = undefined;
    this.gameState.locations = LOCATIONS.map(l => ({ ...l, connectedTo: [...l.connectedTo] }));

    // Reset server-side tracking
    this.lastKillTimes = {};
    this.lastMeetingTime = 0;
    this.lastSabotageTime = 0;
    this.lastEjection = undefined;
    this.gameTimeRemaining = 0;
    this._gameTimerStartedAt = 0;
    this.meetingsCalled = new Set();
    this.meetingLocations = {};
    this.reportedBody = undefined;
    this.disconnectTimers.forEach(t => clearTimeout(t));
    this.disconnectTimers.clear();
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

      // Shadow Walk: hide shadow-walking impostors from innocent players
      // by spoofing their location so they don't appear in "You see:" lists
      if (!isImpostor && p.role === 'impostor' &&
          p.powerup?.type === 'shadowWalk' && p.powerup.until > Date.now()) {
        fp.location = '__shadow__';
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

    // Task progress bar — show overall progress to innocents (impostors see it too for info)
    const allInnocents = Object.values(gs.players).filter(p => p.role === 'innocent');
    const totalTasks = allInnocents.length * GAME_CONFIG.TASKS_PER_PLAYER;
    const completedTasks = allInnocents.reduce((sum, p) => sum + p.tasksCompleted, 0);
    const taskProgress = totalTasks > 0 ? { completed: completedTasks, total: totalTasks } : undefined;

    // Cooldowns (only during playing phase)
    let cooldowns: { kill?: number; sabotage?: number; meeting?: number; meetingUsed?: boolean } | undefined;
    if (gs.phase === 'playing') {
      cooldowns = {};
      if (isImpostor) {
        const killEnd = (this.lastKillTimes[playerId] || 0) + GAME_CONFIG.KILL_COOLDOWN * 1000;
        if (killEnd > Date.now()) cooldowns.kill = killEnd;
        const sabEnd = this.lastSabotageTime + 45000;
        if (sabEnd > Date.now()) cooldowns.sabotage = sabEnd;
      }
      const meetEnd = this.lastMeetingTime + 30000;
      if (meetEnd > Date.now()) cooldowns.meeting = meetEnd;
      if (this.meetingsCalled.has(playerId)) cooldowns.meetingUsed = true;
    }

    // Game time remaining (for non-playing phases to show game clock)
    let gameTimeRemaining: number | undefined;
    if (['meeting', 'voting', 'results'].includes(gs.phase) && this.gameTimeRemaining > 0) {
      gameTimeRemaining = Math.ceil(this.gameTimeRemaining / 1000);
    }

    // Strip secret room's connectedTo to prevent anti-cheat leak
    // But keep it if the player is IN the secret room (so ghosts can leave)
    const filteredLocations = gs.locations.map(l =>
      l.id === 'secret' ? { ...l, connectedTo: player.location === 'secret' ? l.connectedTo : [] } : l
    );

    return {
      ...gs,
      players: filteredPlayers,
      tasks: filteredTasks,
      locations: filteredLocations,
      sixthSenseWarning: sixthSenseWarning || undefined,
      bloodhoundTarget,
      taskProgress,
      cooldowns,
      gameTimeRemaining,
      // Strip secret room internals — client only needs to know if they're at the entrance
      secretRoomMethod: player.location === gs.secretRoomEntrance ? gs.secretRoomMethod : undefined,
      secretRoomEntrance: undefined, // Never send the entrance room ID
      atSecretEntrance: player.location === gs.secretRoomEntrance || undefined,
      // Player locations at meeting start (shown during meeting/voting)
      meetingLocations: (gs.phase === 'meeting' || gs.phase === 'voting') ? this.meetingLocations : undefined,
      // Body report info (shown during meeting/voting)
      reportedBody: (gs.phase === 'meeting' || gs.phase === 'voting') ? this.reportedBody : undefined,
      // Include ejection result during results phase so clients can show the true role
      ejectionResult: gs.phase === 'results' && this.lastEjection
        ? { playerId: this.lastEjection.playerId, role: this.lastEjection.role, name: gs.players[this.lastEjection.playerId]?.name || '???' }
        : undefined,
    };
  }

  onClose(connection: Party.Connection) {
    const playerId = this.connectionToPlayer.get(connection.id);
    this.connectionToPlayer.delete(connection.id);

    if (!playerId || !this.gameState) return;

    // If host left, pass to next player (works in all phases)
    if (this.hostId === playerId) {
      const remaining = Object.keys(this.gameState.players).filter(id => id !== playerId);
      this.hostId = remaining.length > 0 ? remaining[0] : null;
      this.gameState.hostId = this.hostId || undefined;
    }

    // In lobby: remove the player entirely
    if (this.gameState.phase === 'lobby') {
      delete this.gameState.players[playerId];
      this.broadcastFiltered();
      return;
    }

    // Check if the player has another active connection (reconnect race)
    for (const [, pid] of this.connectionToPlayer) {
      if (pid === playerId) return; // Still connected on another socket
    }

    // During active game: give them 5 minutes to reconnect, then mark dead
    // (browsers aggressively throttle background tabs, so short timers cause false deaths)
    const player = this.gameState.players[playerId];
    if (!player || player.status !== 'alive') return;

    const timer = setTimeout(() => {
      if (!this.gameState?.players[playerId] || this.gameState.players[playerId].status !== 'alive') return;
      if (this.gameState.phase === 'lobby' || this.gameState.phase === 'gameOver') return;
      this.gameState.players[playerId].status = 'dead';
      this.disconnectTimers.delete(playerId);
      this.checkWinCondition();
      this.broadcastFiltered();
    }, 300000);
    this.disconnectTimers.set(playerId, timer);
  }
}

GameServer satisfies Party.Worker;
