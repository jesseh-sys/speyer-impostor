import type * as Party from "partykit/server";
import { GameState, Player, ClientMessage, PlayerRole, SpecialRole, Task, PowerupType } from "../types/game";
import { LOCATIONS, TASKS, PLAYER_ICONS, PLAYER_COLORS, GAME_CONFIG, getImpostorCount, DEFAULT_ROLE_CONFIG, SPECIAL_ROLES } from "../lib/gameConfig";

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
  private lastEjection?: { playerId: string; role: PlayerRole; specialRole?: SpecialRole };
  private gameTimeRemaining: number = 0; // ms remaining on game clock (paused during meetings)
  private ephemeralTimers: ReturnType<typeof setTimeout>[] = []; // sabotage/powerup timers (cleared on restart)
  private meetingsCalled: Set<string> = new Set(); // players who used their 1 emergency meeting
  private meetingLocations: Record<string, string> = {}; // snapshot of player locations at meeting start
  private reportedBody?: { name: string; location: string; reportedBy: string };
  private lastChatTimes: Record<string, number> = {}; // rate limit: 1 msg per 2s per player
  private lastInvestigateTime: Record<string, number> = {}; // sheriff investigate cooldown
  private lastShapeshiftTime: Record<string, number> = {}; // shapeshifter cooldown
  private phantomGlitchKillerId: string | null = null; // hidden from clients — revealed on report
  private gameEventLog: Array<{ time: number; event: string }> = [];
  private gameStartTime: number = 0;
  private voteHistory: Array<{ votes: Record<string, string>; ejectedId?: string }> = [];
  private restartCountdownTimer: ReturnType<typeof setTimeout> | null = null;
  private preGameTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly room: Party.Room) {}

  private logEvent(event: string) {
    this.gameEventLog.push({ time: Date.now(), event });
  }

  private formatEventTime(timestamp: number): string {
    const elapsed = Math.max(0, Math.floor((timestamp - this.gameStartTime) / 1000));
    const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const s = (elapsed % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

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
        ghostChat: [],
        votes: {},
        deadBodies: [],
        roleConfig: { ...DEFAULT_ROLE_CONFIG },
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
        // Prevent session hijacking: reject if another ACTIVE connection already owns this playerId
        const existingConnId = this.connectionToPlayer.get(sender.id);
        if (existingConnId !== msg.playerId) {
          for (const [connId, pid] of this.connectionToPlayer) {
            if (pid === msg.playerId && connId !== sender.id) {
              // Another connection already owns this playerId — reject
              console.warn('Session hijack attempt blocked:', sender.id, 'tried to claim', msg.playerId);
              return;
            }
          }
        }
        // Clean up if this connection was previously mapped to a different player
        const previousId = this.connectionToPlayer.get(sender.id);
        if (previousId && previousId !== msg.playerId && (this.gameState.phase === 'lobby' || this.gameState.phase === 'preGame')) {
          delete this.gameState.players[previousId];
        }
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
    const needsData = ['join', 'move', 'completeTask', 'kill', 'chat', 'vote', 'sabotage', 'roleConfig', 'investigate', 'shapeshift'];
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
      case 'roleConfig':
        this.handleRoleConfig(msg);
        break;
      case 'investigate':
        this.handleInvestigate(msg, sender);
        break;
      case 'reportPhantom':
        this.handleReportPhantom(msg, sender);
        break;
      case 'shapeshift':
        this.handleShapeshift(msg);
        break;
      case 'restartGame':
        if (msg.playerId === this.hostId) {
          this.handleRestartGame();
        }
        break;
    }

    this.broadcastFiltered();
  }

  handleJoin(msg: ClientMessage, sender: Party.Connection) {
    if (!this.gameState) return;

    const playerId = msg.playerId;
    let playerName = typeof msg.data.playerName === 'string'
      ? msg.data.playerName.trim().slice(0, 15)
      : 'Anonymous';
    if (!playerName) playerName = 'Anonymous';
    let icon = typeof msg.data.icon === 'string' ? msg.data.icon.slice(0, 2) : '@';
    let color = typeof msg.data.color === 'string' ? msg.data.color.slice(0, 10) : PLAYER_COLORS[0];

    // If player already exists, just update their connection (reconnection)
    if (this.gameState.players[playerId]) {
      console.log('Player reconnected:', playerId);
      // Don't allow appearance changes mid-game
      if (this.gameState.phase === 'lobby' || this.gameState.phase === 'preGame') {
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

    // New players can only join during lobby or preGame
    if (this.gameState.phase !== 'lobby' && this.gameState.phase !== 'preGame') return;

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

  handleRoleConfig(msg: ClientMessage) {
    if (!this.gameState || (this.gameState.phase !== 'lobby' && this.gameState.phase !== 'preGame')) return;
    // Only host can change role config
    if (msg.playerId !== this.hostId) return;
    const { role, enabled } = msg.data as { role: SpecialRole; enabled: boolean };
    if (!this.gameState.roleConfig) this.gameState.roleConfig = { ...DEFAULT_ROLE_CONFIG };
    // Jester cannot be disabled
    if (role === 'jester') return;
    if (role in this.gameState.roleConfig) {
      this.gameState.roleConfig[role] = enabled;
    }
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

    // Assign special roles based on roleConfig
    if (this.gameState.roleConfig) {
      // 1. Shapeshifter: pick one impostor if enabled and 7+ players
      if (this.gameState.roleConfig.shapeshifter && playerCount >= SPECIAL_ROLES.shapeshifter.minPlayers && impostorIds.length > 0) {
        const shapeshifterId = impostorIds[Math.floor(Math.random() * impostorIds.length)];
        this.gameState.players[shapeshifterId].specialRole = 'shapeshifter';
      }

      // 2. Non-impostor special roles: Jester, Sheriff, Phantom, Survivor
      const nonImpostorIds = playerIds.filter(id => !impostorIds.includes(id));
      const shuffledNonImp = [...nonImpostorIds];
      for (let i = shuffledNonImp.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledNonImp[i], shuffledNonImp[j]] = [shuffledNonImp[j], shuffledNonImp[i]];
      }
      let assignIdx = 0;

      // Jester
      if (this.gameState.roleConfig.jester && playerCount >= SPECIAL_ROLES.jester.minPlayers && assignIdx < shuffledNonImp.length) {
        const jesterId = shuffledNonImp[assignIdx];
        this.gameState.players[jesterId].specialRole = 'jester';
        this.gameState.players[jesterId].totalTasks = 0;
        assignIdx++;
      }

      // Sheriff
      if (this.gameState.roleConfig.sheriff && playerCount >= SPECIAL_ROLES.sheriff.minPlayers && assignIdx < shuffledNonImp.length) {
        const sheriffId = shuffledNonImp[assignIdx];
        this.gameState.players[sheriffId].specialRole = 'sheriff';
        assignIdx++;
      }

      // Phantom
      if (this.gameState.roleConfig.phantom && playerCount >= SPECIAL_ROLES.phantom.minPlayers && assignIdx < shuffledNonImp.length) {
        const phantomId = shuffledNonImp[assignIdx];
        this.gameState.players[phantomId].specialRole = 'phantom';
        assignIdx++;
      }

      // Survivor
      if (this.gameState.roleConfig.survivor && playerCount >= SPECIAL_ROLES.survivor.minPlayers && assignIdx < shuffledNonImp.length) {
        const survivorId = shuffledNonImp[assignIdx];
        this.gameState.players[survivorId].specialRole = 'survivor';
        this.gameState.players[survivorId].survivorShields = 2;
        assignIdx++;
      }
    }

    // Assign tasks to innocent players (skip Jester — they get no tasks)
    playerIds.forEach(id => {
      if (this.gameState && this.gameState.players[id].role === 'innocent' && this.gameState.players[id].specialRole !== 'jester') {
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

    // Initialize event log and game start time
    this.gameEventLog = [];
    this.gameStartTime = Date.now();
    this.voteHistory = [];

    // Log game start with impostor names
    const impostorNames = impostorIds.map(id => this.gameState!.players[id].name).join(', ');
    const impostorLabel = impostorIds.length > 1 ? 'impostors' : 'impostor';
    this.logEvent(`Game started. ${impostorNames} assigned as ${impostorLabel}.`);

    // Log special role assignments
    for (const p of Object.values(this.gameState.players)) {
      if (p.specialRole) {
        this.logEvent(`${p.name} assigned as ${p.specialRole.toUpperCase()}.`);
      }
    }

    // Initial kill cooldown — give innocents time to spread out
    const now = Date.now();
    impostorIds.forEach(id => {
      this.lastKillTimes[id] = now;
    });

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

  // Generate deterministic fake tasks for an impostor (stable across state broadcasts)
  generateFakeTasksForImpostor(playerId: string): Task[] {
    // Simple seeded PRNG from playerId + roomCode for deterministic results
    let seed = 0;
    const seedStr = playerId + (this.gameState?.roomCode || '');
    for (let i = 0; i < seedStr.length; i++) {
      seed = ((seed << 5) - seed + seedStr.charCodeAt(i)) | 0;
    }
    const seededRandom = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    // Shuffle tasks deterministically
    const taskPool = [...TASKS];
    for (let i = taskPool.length - 1; i > 0; i--) {
      const j = Math.floor(seededRandom() * (i + 1));
      [taskPool[i], taskPool[j]] = [taskPool[j], taskPool[i]];
    }

    return taskPool.slice(0, GAME_CONFIG.TASKS_PER_PLAYER).map((task, index) => ({
      id: `${playerId}-task-${index}`,
      ...task,
      isFake: true,
    }));
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
    // Dead innocents CAN complete tasks (ghost tasks count toward team progress)

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
      // Notify the killer directly
      for (const conn of this.room.getConnections()) {
        if (this.connectionToPlayer.get(conn.id) === playerId) {
          conn.send(JSON.stringify({ type: 'shieldBlocked', data: { victimName: victim.name } }));
        }
      }
      return;
    }

    // Survivor shield blocks the kill
    if (victim.specialRole === 'survivor' && (victim.survivorShields ?? 0) > 0) {
      victim.survivorShields = (victim.survivorShields ?? 1) - 1;
      this.lastKillTimes[playerId] = now; // Cooldown still triggers
      this.logEvent(`${victim.name}'s shield blocked a kill.`);
      // Notify the killer
      for (const conn of this.room.getConnections()) {
        if (this.connectionToPlayer.get(conn.id) === playerId) {
          conn.send(JSON.stringify({ type: 'shieldBlocked', data: { victimName: victim.name } }));
        }
      }
      // Notify the survivor
      for (const conn of this.room.getConnections()) {
        if (this.connectionToPlayer.get(conn.id) === data.victimId) {
          conn.send(JSON.stringify({ type: 'survivorShieldUsed', data: { shieldsRemaining: victim.survivorShields } }));
        }
      }
      return;
    }

    victim.status = 'dead';
    this.lastKillTimes[playerId] = now;

    // Log kill event
    const killLoc = this.gameState.locations.find(l => l.id === victim.location);
    this.logEvent(`${killer.name} eliminated ${victim.name} in ${killLoc?.name || victim.location}.`);

    this.gameState.deadBodies.push({
      playerId: data.victimId,
      location: victim.location,
    });

    // Phantom: create a glitch visible for 15 seconds
    if (victim.specialRole === 'phantom') {
      const glitchUntil = Date.now() + 15000;
      this.gameState.phantomGlitch = {
        playerId: data.victimId,
        playerName: victim.name,
        location: victim.location,
        until: glitchUntil,
      };
      this.phantomGlitchKillerId = playerId;
      // Auto-clear after 15 seconds
      this.ephemeralTimers.push(setTimeout(() => {
        if (this.gameState && this.gameState.phantomGlitch?.playerId === data.victimId) {
          this.gameState.phantomGlitch = undefined;
          this.phantomGlitchKillerId = null;
          this.broadcastFiltered();
        }
      }, 15000));
    }

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
    this.logEvent(`${reporter.name} reported ${bodyPlayer?.name || '???'}'s body in ${bodyLoc?.name || '???'}.`);
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
    this.logEvent(`${player.name} called an emergency meeting.`);
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

    // Clear active disguises and phantom glitch during meetings
    for (const p of Object.values(this.gameState.players)) {
      p.disguise = undefined;
    }
    this.gameState.phantomGlitch = undefined;
    this.phantomGlitchKillerId = null;

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

    const player = this.gameState.players[msg.playerId];
    if (!player) return;

    let message = typeof msg.data.message === 'string' ? msg.data.message.slice(0, 200) : '';
    if (!message) return;

    // Rate limit: 1 message per 2 seconds per player
    const now = Date.now();
    if (now - (this.lastChatTimes[msg.playerId] || 0) < 2000) return;
    this.lastChatTimes[msg.playerId] = now;

    // Comms Jam: garble living player chat during meeting/voting phases
    if (this.gameState.commsJam && this.gameState.commsJam.until > now &&
        player.status === 'alive' &&
        (this.gameState.phase === 'meeting' || this.gameState.phase === 'voting')) {
      message = this.garbleMessage(message);
    }

    const chatMsg = {
      id: `${Date.now()}-${msg.playerId}`,
      playerId: msg.playerId,
      playerName: player.name,
      message,
      timestamp: Date.now(),
    };

    if (player.status === 'dead') {
      // Dead players can ghost chat during ANY phase (playing, meeting, voting)
      if (this.gameState.phase !== 'playing' && this.gameState.phase !== 'meeting' && this.gameState.phase !== 'voting' && this.gameState.phase !== 'voteReveal') return;
      this.gameState.ghostChat.push(chatMsg);
      if (this.gameState.ghostChat.length > 50) {
        this.gameState.ghostChat = this.gameState.ghostChat.slice(-50);
      }
    } else {
      // Living players can only chat during meeting/voting
      if (this.gameState.phase !== 'meeting' && this.gameState.phase !== 'voting') return;
      this.gameState.chat.push(chatMsg);
      if (this.gameState.chat.length > 50) {
        this.gameState.chat = this.gameState.chat.slice(-50);
      }
    }
  }

  // Garble a message for comms jam — replace ~30% of alphanumeric chars with █
  garbleMessage(text: string): string {
    return text.split('').map(ch => {
      // Keep spaces, punctuation, and emoji intact
      if (/\s/.test(ch) || /[^a-zA-Z0-9]/.test(ch)) return ch;
      return Math.random() < 0.3 ? '\u2588' : ch;
    }).join('');
  }

  handleVote(msg: ClientMessage) {
    if (!this.gameState || this.gameState.phase !== 'voting') return;

    const { playerId, data } = msg;
    const player = this.gameState.players[playerId];
    if (!player) return;

    // Dead players: allow ONE ghost vote total across all meetings
    if (player.status === 'dead') {
      if (player.ghostVoteUsed) return; // Already used their one ghost vote
      if (this.gameState.votes[playerId] !== undefined) return;

      const targetId = data.votedForId;
      if (targetId === playerId) return;

      // Allow "skip" or a valid alive player
      if (targetId !== 'skip') {
        const target = this.gameState.players[targetId];
        if (!target || target.status !== 'alive') return;
      }

      this.gameState.votes[playerId] = targetId;
      player.ghostVoteUsed = true;

      // Check if all alive + ghost-vote-available players have voted
      const allAlive = Object.values(this.gameState.players).filter(p => p.status === 'alive');
      if (allAlive.every(p => this.gameState!.votes[p.id] !== undefined)) {
        this.countVotes();
      }
      return;
    }

    // Living players
    if (player.status !== 'alive') return;

    // Can't change your vote
    if (this.gameState.votes[playerId] !== undefined) return;

    // Can't vote for yourself (but CAN skip)
    const targetId = data.votedForId;
    if (targetId === playerId) return;

    // Validate vote target: must be "skip" or an alive player
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

    // Can't stack active sabotages (blackout is short but check anyway)
    if (this.gameState.blackout && this.gameState.blackout.until > now) return;

    const sabotageType = msg.data?.type;

    if (sabotageType === 'commsJam') {
      this.lastSabotageTime = now;
      this.logEvent('Comms Jam sabotage activated.');
      // Active for 2 minutes or until next meeting ends, whichever comes first
      this.gameState.commsJam = { until: now + 120000 };
      this.ephemeralTimers.push(setTimeout(() => {
        if (this.gameState) {
          this.gameState.commsJam = undefined;
          this.broadcastFiltered();
        }
      }, 120000));
    } else if (sabotageType === 'blackout') {
      this.lastSabotageTime = now;
      this.logEvent('Blackout sabotage activated.');
      this.gameState.blackout = { until: now + 10000 };
      this.ephemeralTimers.push(setTimeout(() => {
        if (this.gameState && this.gameState.phase === 'playing') {
          this.gameState.blackout = undefined;
          this.broadcastFiltered();
        }
      }, 10000));
    } else if (sabotageType === 'scramble') {
      this.lastSabotageTime = now;
      this.logEvent('Scramble sabotage activated.');
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

  handleInvestigate(msg: ClientMessage, sender: Party.Connection) {
    if (!this.gameState || this.gameState.phase !== 'playing') return;

    const player = this.gameState.players[msg.playerId];
    if (!player || player.specialRole !== 'sheriff' || player.status !== 'alive') return;

    const targetId = msg.data?.targetId;
    if (!targetId) return;
    const target = this.gameState.players[targetId];
    if (!target || target.status !== 'alive') return;

    // Must be in the same room
    if (player.location !== target.location) return;

    // Cooldown: 45 seconds
    const now = Date.now();
    const lastInvestigate = this.lastInvestigateTime[msg.playerId] || 0;
    if (now - lastInvestigate < 45000) return;

    this.lastInvestigateTime[msg.playerId] = now;

    // Jester reads as NOT impostor (they're technically innocent)
    const isImpostor = target.role === 'impostor';

    // Send result only to the sheriff
    sender.send(JSON.stringify({
      type: 'investigateResult',
      data: { targetId, targetName: target.name, isImpostor },
    }));
  }

  handleReportPhantom(msg: ClientMessage, sender: Party.Connection) {
    if (!this.gameState || this.gameState.phase !== 'playing') return;

    const player = this.gameState.players[msg.playerId];
    if (!player || player.status !== 'alive') return;

    // Must have an active phantom glitch
    if (!this.gameState.phantomGlitch || this.gameState.phantomGlitch.until < Date.now()) return;

    // Must be in the same room as the glitch
    if (player.location !== this.gameState.phantomGlitch.location) return;

    // Reveal the killer to the reporter
    const killerId = this.phantomGlitchKillerId;
    if (killerId) {
      const killer = this.gameState.players[killerId];
      if (killer) {
        this.logEvent(`${player.name} identified ${killer.name} via phantom glitch.`);
        sender.send(JSON.stringify({
          type: 'phantomReveal',
          data: { killerName: killer.name, killerColor: killer.color },
        }));
      }
    }

    // Clear the phantom glitch
    this.gameState.phantomGlitch = undefined;
    this.phantomGlitchKillerId = null;
  }

  handleShapeshift(msg: ClientMessage) {
    if (!this.gameState || this.gameState.phase !== 'playing') return;

    const player = this.gameState.players[msg.playerId];
    if (!player || player.specialRole !== 'shapeshifter' || player.role !== 'impostor' || player.status !== 'alive') return;

    const targetId = msg.data?.targetId;
    if (!targetId) return;
    const target = this.gameState.players[targetId];
    if (!target || target.status !== 'alive') return;

    // Cooldown: 60 seconds
    const now = Date.now();
    const lastShapeshift = this.lastShapeshiftTime[msg.playerId] || 0;
    if (now - lastShapeshift < 60000) return;

    this.lastShapeshiftTime[msg.playerId] = now;
    this.logEvent(`${player.name} disguised as ${target.name}.`);

    const disguiseUntil = Date.now() + 20000;
    player.disguise = {
      asPlayerId: targetId,
      asName: target.name,
      asColor: target.color,
      until: disguiseUntil,
    };

    // Auto-clear after 20 seconds
    const pid = msg.playerId;
    this.ephemeralTimers.push(setTimeout(() => {
      const p = this.gameState?.players[pid];
      if (p?.disguise && p.disguise.until <= Date.now()) {
        p.disguise = undefined;
        this.broadcastFiltered();
      }
    }, 20000));
  }

  countVotes() {
    if (!this.gameState) return;
    if (this.gameState.phase !== 'voting') return; // Prevent double-fire

    const voteCounts: Record<string, number> = {};

    // Skip votes ("skip") don't count toward any player's tally
    Object.values(this.gameState.votes).forEach(votedForId => {
      if (votedForId !== 'skip') {
        voteCounts[votedForId] = (voteCounts[votedForId] || 0) + 1;
      }
    });

    // Find player with most votes, detect ties
    let maxVotes = 0;
    let ejectedId = '';
    let isTied = false;

    Object.entries(voteCounts).forEach(([id, count]) => {
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

    // Determine ejection (but don't apply yet — wait for reveal animation)
    let ejectedPlayerId: string | undefined;
    let ejectedRole: PlayerRole | undefined;
    let ejectedSpecialRole: SpecialRole | undefined;
    let ejectedName: string | undefined;

    if (!isTied && ejectedId && maxVotes >= votesNeeded && this.gameState.players[ejectedId]) {
      ejectedRole = this.gameState.players[ejectedId].role;
      ejectedSpecialRole = this.gameState.players[ejectedId].specialRole;
      ejectedPlayerId = ejectedId;
      ejectedName = this.gameState.players[ejectedId].name;
    }

    // Build vote reveal data for dramatic animation
    const voteRevealVotes: Array<{ voterId: string; voterName: string; votedForId: string; votedForName: string; isGhost: boolean }> = [];
    for (const [voterId, votedForId] of Object.entries(this.gameState.votes)) {
      const voter = this.gameState.players[voterId];
      const votedForName = votedForId === 'skip' ? 'SKIP' : (this.gameState.players[votedForId]?.name || '???');
      voteRevealVotes.push({
        voterId,
        voterName: voter?.name || '???',
        votedForId,
        votedForName,
        isGhost: voter?.status === 'dead',
      });
    }

    // Store ejection info for the results phase
    this.lastEjection = ejectedPlayerId ? { playerId: ejectedPlayerId, role: ejectedRole!, specialRole: ejectedSpecialRole } : undefined;

    // Track vote history for awards
    this.voteHistory.push({
      votes: { ...this.gameState.votes },
      ejectedId: ejectedPlayerId,
    });

    // Log vote result
    if (ejectedPlayerId && ejectedName) {
      this.logEvent(`${ejectedName} was ejected.`);
    } else {
      this.logEvent('No one was ejected.');
    }

    // Enter vote reveal phase (dramatic animation before results)
    this.gameState.phase = 'voteReveal';
    this.gameState.voteRevealData = {
      votes: voteRevealVotes,
      ejectedId: ejectedPlayerId,
      ejectedRole,
      ejectedSpecialRole,
      ejectedName,
      noEjection: !ejectedPlayerId,
    };
    this.gameState.deadBodies = []; // Clear all bodies after meeting

    this.broadcastFiltered();

    // After 6 seconds, apply ejection and move to results phase
    const revealTimer = setTimeout(() => {
      if (this.gameState && this.gameState.phase === 'voteReveal') {
        // Apply the actual ejection now
        if (ejectedPlayerId && this.gameState.players[ejectedPlayerId]) {
          this.gameState.players[ejectedPlayerId].status = 'dead';

          // Jester win: ejected player with specialRole 'jester' wins immediately
          if (this.gameState.players[ejectedPlayerId].specialRole === 'jester') {
            this.logEvent(`${this.gameState.players[ejectedPlayerId].name} was ejected — JESTER WINS.`);
            this.endGame('jester');
            return;
          }
        }

        this.gameState.phase = 'results';
        this.gameState.voteRevealData = undefined;

        this.broadcastFiltered();

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
            // Clear comms jam after meeting ends
            this.gameState.commsJam = undefined;
            // Note: ghostChat persists across meetings (ghosts keep their conversation)
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
      }
    }, 6000);
    this.meetingTimers.push(revealTimer);
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
    // Exclude Jester from task win calculation (they have no tasks)
    const allInnocents = Object.values(this.gameState.players).filter(p => p.role === 'innocent' && p.specialRole !== 'jester');
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

  endGame(winner: 'innocents' | 'impostors' | 'jester') {
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
    if (this.restartCountdownTimer) {
      clearTimeout(this.restartCountdownTimer);
      this.restartCountdownTimer = null;
    }
    if (this.preGameTimer) {
      clearTimeout(this.preGameTimer);
      this.preGameTimer = null;
    }
    this.disconnectTimers.forEach(t => clearTimeout(t));
    this.disconnectTimers.clear();

    this.gameState.phase = 'gameOver';
    this.gameState.winner = winner;

    // Log game end
    const durationSecs = Math.floor((Date.now() - this.gameStartTime) / 1000);
    const durM = Math.floor(durationSecs / 60).toString().padStart(2, '0');
    const durS = (durationSecs % 60).toString().padStart(2, '0');
    const winnerLabel = winner === 'innocents' ? 'INNOCENTS' : winner === 'impostors' ? 'IMPOSTORS' : 'JESTER';
    this.logEvent(`${winnerLabel} WIN. Duration: ${durM}:${durS}.`);

    // Survivor wins if alive at game end (regardless of which team won)
    const survivorPlayer = Object.values(this.gameState.players).find(
      p => p.specialRole === 'survivor' && p.status === 'alive'
    );
    if (survivorPlayer) {
      this.gameState.survivorWin = { playerId: survivorPlayer.id, name: survivorPlayer.name };
    }

    // Format event log with MM:SS timestamps
    this.gameState.eventLog = this.gameEventLog.map(e => ({
      time: this.formatEventTime(e.time),
      event: e.event,
    }));

    // Calculate awards
    this.gameState.awards = this.calculateAwards();

    // Start auto-restart countdown (20 seconds)
    const restartUntil = Date.now() + 20000;
    this.gameState.restartCountdown = { until: restartUntil };
    if (this.restartCountdownTimer) clearTimeout(this.restartCountdownTimer);
    this.restartCountdownTimer = setTimeout(() => {
      this.restartCountdownTimer = null;
      this.autoRestart();
    }, 20000);

    this.broadcastFiltered();
  }

  calculateAwards(): Array<{ playerId: string; playerName: string; playerColor: string; title: string; description: string }> {
    if (!this.gameState) return [];
    const awards: Array<{ playerId: string; playerName: string; playerColor: string; title: string; description: string }> = [];
    const players = this.gameState.players;
    const allPlayers = Object.values(players);

    const addAward = (pid: string, title: string, description: string) => {
      const p = players[pid];
      if (p) awards.push({ playerId: pid, playerName: p.name, playerColor: p.color, title, description });
    };

    // DETECTIVE: First player to correctly vote for an impostor who got ejected
    for (const round of this.voteHistory) {
      if (round.ejectedId && players[round.ejectedId]?.role === 'impostor') {
        // Find first voter who voted for this impostor
        for (const [voterId, votedForId] of Object.entries(round.votes)) {
          if (votedForId === round.ejectedId && players[voterId]?.role !== 'impostor') {
            addAward(voterId, 'DETECTIVE', 'First to identify the threat');
            break;
          }
        }
        break; // Only first correct ejection counts
      }
    }

    // WRONGLY ACCUSED: Innocent player who was voted out
    for (const round of this.voteHistory) {
      if (round.ejectedId) {
        const ejected = players[round.ejectedId];
        if (ejected && ejected.role === 'innocent' && ejected.specialRole !== 'jester') {
          addAward(round.ejectedId, 'WRONGLY ACCUSED', 'Terminated without cause');
        }
      }
    }

    // PERFECT INFILTRATION: Impostor who was never voted against (0 votes in any meeting)
    const impostors = allPlayers.filter(p => p.role === 'impostor');
    for (const imp of impostors) {
      let everVotedAgainst = false;
      for (const round of this.voteHistory) {
        for (const votedForId of Object.values(round.votes)) {
          if (votedForId === imp.id) {
            everVotedAgainst = true;
            break;
          }
        }
        if (everVotedAgainst) break;
      }
      if (!everVotedAgainst && this.voteHistory.length > 0) {
        addAward(imp.id, 'PERFECT INFILTRATION', 'Zero suspicion, maximum damage');
      }
    }

    // FIRST BLOOD: First player to be killed (from event log)
    const firstKill = this.gameEventLog.find(e => e.event.includes(' eliminated '));
    if (firstKill) {
      const match = firstKill.event.match(/eliminated (.+?) in/);
      if (match) {
        const victimName = match[1];
        const victim = allPlayers.find(p => p.name === victimName);
        if (victim) addAward(victim.id, 'FIRST BLOOD', 'Wrong place, wrong time');
      }
    }

    // TASK MASTER: Player who completed the most tasks (among those with tasks)
    const taskPlayers = allPlayers.filter(p => p.role === 'innocent' && p.specialRole !== 'jester');
    if (taskPlayers.length > 0) {
      const maxTasks = Math.max(...taskPlayers.map(p => p.tasksCompleted));
      if (maxTasks > 0) {
        const topTasker = taskPlayers.find(p => p.tasksCompleted === maxTasks);
        if (topTasker) addAward(topTasker.id, 'TASK MASTER', 'Most productive crew member');
      }
    }

    // GHOST WHISPERER: Dead player whose ghost vote was in the final vote tally
    if (this.voteHistory.length > 0) {
      const lastRound = this.voteHistory[this.voteHistory.length - 1];
      for (const voterId of Object.keys(lastRound.votes)) {
        const voter = players[voterId];
        if (voter && voter.status === 'dead' && voter.ghostVoteUsed) {
          addAward(voterId, 'GHOST WHISPERER', 'Even death couldn\'t silence them');
          break; // Only one award
        }
      }
    }

    // SERIAL KILLER: Impostor with the most kills
    const killCounts: Record<string, number> = {};
    for (const e of this.gameEventLog) {
      const killMatch = e.event.match(/^(.+?) eliminated/);
      if (killMatch) {
        const killerName = killMatch[1];
        const killer = allPlayers.find(p => p.name === killerName);
        if (killer) {
          killCounts[killer.id] = (killCounts[killer.id] || 0) + 1;
        }
      }
    }
    const impKillEntries = Object.entries(killCounts).filter(([id]) => players[id]?.role === 'impostor');
    if (impKillEntries.length > 0) {
      const maxKills = Math.max(...impKillEntries.map(([, c]) => c));
      if (maxKills >= 2) {
        const topKiller = impKillEntries.find(([, c]) => c === maxKills);
        if (topKiller) addAward(topKiller[0], 'SERIAL KILLER', 'The darkness consumed them');
      }
    }

    // LAST STANDING: Last innocent alive (if impostors won)
    if (this.gameState.winner === 'impostors') {
      const aliveInnocents = allPlayers.filter(p => p.role === 'innocent' && p.status === 'alive');
      // If only one innocent left alive when impostors won
      if (aliveInnocents.length > 0) {
        // Find who was alive longest — the one still alive (or last killed before game ended)
        // Since impostors win when they equal/outnumber innocents, there may be alive innocents
        for (const p of aliveInnocents) {
          addAward(p.id, 'LAST STANDING', 'Held out the longest');
        }
      }
    }

    // JESTER'S FOOL: Player who cast the deciding vote on the Jester
    if (this.gameState.winner === 'jester') {
      for (const round of this.voteHistory) {
        if (round.ejectedId && players[round.ejectedId]?.specialRole === 'jester') {
          // Find the last voter who voted for the jester (deciding vote)
          const jesterVoters = Object.entries(round.votes)
            .filter(([, votedForId]) => votedForId === round.ejectedId);
          if (jesterVoters.length > 0) {
            // The "deciding" vote = last one cast (they tipped the scale)
            const lastVoter = jesterVoters[jesterVoters.length - 1];
            addAward(lastVoter[0], 'JESTER\'S FOOL', 'Played right into their hands');
          }
        }
      }
    }

    return awards;
  }

  private getConnectedPlayerCount(): number {
    const connectedPlayerIds = new Set(this.connectionToPlayer.values());
    if (!this.gameState) return 0;
    return Object.keys(this.gameState.players).filter(id => connectedPlayerIds.has(id)).length;
  }

  private autoRestart() {
    if (!this.gameState || this.gameState.phase !== 'gameOver') return;

    // Check if enough connected players to auto-start
    const connectedCount = this.getConnectedPlayerCount();
    if (connectedCount < GAME_CONFIG.MIN_PLAYERS) {
      // Fall back to lobby — not enough players
      this.resetToLobby();
      this.broadcastFiltered();
      return;
    }

    // Remove disconnected players before restarting
    this.removeDisconnectedPlayers();

    // Go to preGame phase
    this.enterPreGame();
  }

  private removeDisconnectedPlayers() {
    if (!this.gameState) return;
    const connectedPlayerIds = new Set(this.connectionToPlayer.values());
    for (const id of Object.keys(this.gameState.players)) {
      if (!connectedPlayerIds.has(id)) {
        delete this.gameState.players[id];
      }
    }
  }

  private enterPreGame() {
    if (!this.gameState) return;

    // Reset players for new game, keep names/icons/colors
    for (const player of Object.values(this.gameState.players)) {
      player.role = 'innocent';
      player.specialRole = undefined;
      player.status = 'alive';
      player.location = 'speyer';
      player.tasksCompleted = 0;
      player.totalTasks = GAME_CONFIG.TASKS_PER_PLAYER;
      player.powerup = undefined;
      player.ghostVoteUsed = false;
      player.disguise = undefined;
      player.survivorShields = undefined;
    }

    // Reset game state fields
    this.gameState.tasks = [];
    this.gameState.chat = [];
    this.gameState.ghostChat = [];
    this.gameState.votes = {};
    this.gameState.deadBodies = [];
    this.gameState.timer = undefined;
    this.gameState.winner = undefined;
    this.gameState.commsJam = undefined;
    this.gameState.blackout = undefined;
    this.gameState.secretRoomMethod = undefined;
    this.gameState.secretRoomEntrance = undefined;
    this.gameState.scrambled = undefined;
    this.gameState.phantomGlitch = undefined;
    this.gameState.survivorWin = undefined;
    this.gameState.eventLog = undefined;
    this.gameState.awards = undefined;
    this.gameState.restartCountdown = undefined;
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
    this.lastChatTimes = {};
    this.lastInvestigateTime = {};
    this.lastShapeshiftTime = {};
    this.phantomGlitchKillerId = null;
    this.gameEventLog = [];
    this.gameStartTime = 0;
    this.voteHistory = [];
    this.disconnectTimers.forEach(t => clearTimeout(t));
    this.disconnectTimers.clear();

    // Enter preGame phase with 8-second timer
    const preGameUntil = Date.now() + 8000;
    this.gameState.phase = 'preGame';
    this.gameState.preGameTimer = { until: preGameUntil };
    this.gameState.connectedCount = Object.keys(this.gameState.players).length;

    if (this.preGameTimer) clearTimeout(this.preGameTimer);
    this.preGameTimer = setTimeout(() => {
      this.preGameTimer = null;
      if (!this.gameState || this.gameState.phase !== 'preGame') return;

      // Final check: still enough players?
      const count = this.getConnectedPlayerCount();
      if (count < GAME_CONFIG.MIN_PLAYERS) {
        this.resetToLobby();
        this.broadcastFiltered();
        return;
      }

      // Auto-start the game
      this.handleStartGame();
      this.broadcastFiltered();
    }, 8000);

    this.broadcastFiltered();
  }

  private resetToLobby() {
    if (!this.gameState) return;

    // Clear countdown/preGame timers
    if (this.restartCountdownTimer) {
      clearTimeout(this.restartCountdownTimer);
      this.restartCountdownTimer = null;
    }
    if (this.preGameTimer) {
      clearTimeout(this.preGameTimer);
      this.preGameTimer = null;
    }

    // Clear all other timers
    this.meetingTimers.forEach(t => clearTimeout(t));
    this.meetingTimers = [];
    this.ephemeralTimers.forEach(t => clearTimeout(t));
    this.ephemeralTimers = [];
    if (this.gameTimerHandle) {
      clearTimeout(this.gameTimerHandle);
      this.gameTimerHandle = null;
    }

    // Reset all players to lobby state
    for (const player of Object.values(this.gameState.players)) {
      player.role = 'innocent';
      player.specialRole = undefined;
      player.status = 'alive';
      player.location = 'speyer';
      player.tasksCompleted = 0;
      player.totalTasks = GAME_CONFIG.TASKS_PER_PLAYER;
      player.powerup = undefined;
      player.ghostVoteUsed = false;
      player.disguise = undefined;
      player.survivorShields = undefined;
    }

    this.gameState.phase = 'lobby';
    this.gameState.tasks = [];
    this.gameState.chat = [];
    this.gameState.ghostChat = [];
    this.gameState.votes = {};
    this.gameState.deadBodies = [];
    this.gameState.timer = undefined;
    this.gameState.winner = undefined;
    this.gameState.commsJam = undefined;
    this.gameState.blackout = undefined;
    this.gameState.secretRoomMethod = undefined;
    this.gameState.secretRoomEntrance = undefined;
    this.gameState.scrambled = undefined;
    this.gameState.phantomGlitch = undefined;
    this.gameState.survivorWin = undefined;
    this.gameState.eventLog = undefined;
    this.gameState.awards = undefined;
    this.gameState.restartCountdown = undefined;
    this.gameState.preGameTimer = undefined;
    this.gameState.connectedCount = undefined;
    this.gameState.locations = LOCATIONS.map(l => ({ ...l, connectedTo: [...l.connectedTo] }));

    this.lastKillTimes = {};
    this.lastMeetingTime = 0;
    this.lastSabotageTime = 0;
    this.lastEjection = undefined;
    this.gameTimeRemaining = 0;
    this._gameTimerStartedAt = 0;
    this.meetingsCalled = new Set();
    this.meetingLocations = {};
    this.reportedBody = undefined;
    this.lastChatTimes = {};
    this.lastInvestigateTime = {};
    this.lastShapeshiftTime = {};
    this.phantomGlitchKillerId = null;
    this.gameEventLog = [];
    this.gameStartTime = 0;
    this.voteHistory = [];
    this.disconnectTimers.forEach(t => clearTimeout(t));
    this.disconnectTimers.clear();
  }

  handleRestartGame() {
    if (!this.gameState) return;
    // Only allow during gameOver (host can skip countdown)
    if (this.gameState.phase !== 'gameOver') return;

    // Cancel the auto-restart countdown
    if (this.restartCountdownTimer) {
      clearTimeout(this.restartCountdownTimer);
      this.restartCountdownTimer = null;
    }

    // Check if enough connected players
    const connectedCount = this.getConnectedPlayerCount();
    if (connectedCount < GAME_CONFIG.MIN_PLAYERS) {
      this.resetToLobby();
      this.broadcastFiltered();
      return;
    }

    // Remove disconnected players
    this.removeDisconnectedPlayers();

    // Go to preGame
    this.enterPreGame();
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
    if (gs.phase === 'gameOver' || gs.phase === 'preGame') return gs; // Roles revealed at game over, no roles during preGame
    const filteredPlayers: Record<string, Player> = {};
    for (const [id, p] of Object.entries(gs.players)) {
      filteredPlayers[id] = { ...p, role: 'innocent', specialRole: undefined, powerup: undefined };
    }
    return { ...gs, players: filteredPlayers, tasks: [], ghostChat: [] };
  }

  // Filter state for a specific player — hide what they shouldn't see
  filterStateForPlayer(playerId: string): GameState {
    if (!this.gameState) return this.gameState!;

    const gs = this.gameState;
    const player = gs.players[playerId];
    if (!player) return this.maskRoles(gs);

    // During game over, reveal everything (eventLog and awards are already on gs)
    if (gs.phase === 'gameOver') return gs;

    // During preGame, send full state (no roles assigned yet)
    if (gs.phase === 'preGame') return gs;

    const isImpostor = player.role === 'impostor';
    const isDead = player.status === 'dead';

    // Filter players — hide roles, specialRoles, and powerups of others
    const filteredPlayers: Record<string, Player> = {};
    for (const [id, p] of Object.entries(gs.players)) {
      if (id === playerId) {
        filteredPlayers[id] = p; // Full info for yourself (including your own specialRole)
        continue;
      }
      const fp = { ...p };

      if (isDead) {
        // Dead players see EVERYTHING: true roles, real locations, powerups, specialRoles
        // Dead players see through disguises
        // (no masking needed)
      } else {
        // Roles: impostors see each other, innocents see everyone as innocent
        if (!isImpostor) {
          fp.role = 'innocent';
        }

        // Special roles: always hidden from other living players (no one knows the Jester)
        fp.specialRole = undefined;

        // Shadow Walk: hide shadow-walking impostors from innocent players
        // by spoofing their location so they don't appear in "You see:" lists
        if (!isImpostor && p.role === 'impostor' &&
            p.powerup?.type === 'shadowWalk' && p.powerup.until > Date.now()) {
          fp.location = '__shadow__';
        }

        // Blackout: hide player locations from innocents (impostors have night vision)
        if (!isImpostor && gs.blackout && gs.blackout.until > Date.now()) {
          // Innocents can't see who's in their room — hide other player locations
          fp.location = '__blackout__';
        }

        // Shapeshifter disguise: innocents see the disguised identity
        // Impostors see through the disguise (real identity shown)
        if (!isImpostor && p.disguise && p.disguise.until > Date.now()) {
          fp.name = p.disguise.asName;
          fp.color = p.disguise.asColor;
          // Keep disguise info so client knows this is a disguised player (but don't reveal real identity)
          fp.disguise = undefined;
        }

        // Hide powerups on other players
        fp.powerup = undefined;
      }

      // Hide survivor shield count from other players (alive non-dead)
      if (!isDead && id !== playerId) {
        fp.survivorShields = undefined;
      }

      filteredPlayers[id] = fp;
    }

    // Tasks: only your own (innocents get real tasks, impostors get fake tasks)
    let filteredTasks: Task[];
    if (isImpostor && !isDead) {
      // Generate deterministic fake tasks for impostors based on playerId + roomCode
      filteredTasks = this.generateFakeTasksForImpostor(playerId);
    } else {
      filteredTasks = gs.tasks.filter(t => t.id.startsWith(playerId));
    }

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
    // Exclude Jester from task counts (they have no tasks)
    const allInnocents = Object.values(gs.players).filter(p => p.role === 'innocent' && p.specialRole !== 'jester');
    const totalTasks = allInnocents.length * GAME_CONFIG.TASKS_PER_PLAYER;
    const completedTasks = allInnocents.reduce((sum, p) => sum + p.tasksCompleted, 0);
    const taskProgress = totalTasks > 0 ? { completed: completedTasks, total: totalTasks } : undefined;

    // Cooldowns (only during playing phase)
    let cooldowns: { kill?: number; sabotage?: number; meeting?: number; meetingUsed?: boolean; investigate?: number; shapeshift?: number } | undefined;
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
      // Sheriff investigate cooldown
      if (player.specialRole === 'sheriff') {
        const invEnd = (this.lastInvestigateTime[playerId] || 0) + 45000;
        if (invEnd > Date.now()) cooldowns.investigate = invEnd;
      }
      // Shapeshifter cooldown
      if (player.specialRole === 'shapeshifter') {
        const ssEnd = (this.lastShapeshiftTime[playerId] || 0) + 60000;
        if (ssEnd > Date.now()) cooldowns.shapeshift = ssEnd;
      }
    }

    // Game time remaining (for non-playing phases to show game clock)
    let gameTimeRemaining: number | undefined;
    if (['meeting', 'voting', 'voteReveal', 'results'].includes(gs.phase) && this.gameTimeRemaining > 0) {
      gameTimeRemaining = Math.ceil(this.gameTimeRemaining / 1000);
    }

    // Strip secret room's connectedTo to prevent anti-cheat leak
    // Dead players can see the secret room entrance; alive players only if they're in it
    const filteredLocations = gs.locations.map(l =>
      l.id === 'secret' ? { ...l, connectedTo: (isDead || player.location === 'secret') ? l.connectedTo : [] } : l
    );

    return {
      ...gs,
      players: filteredPlayers,
      tasks: filteredTasks,
      locations: filteredLocations,
      // Ghost chat: dead players see it, living players get empty array
      ghostChat: isDead ? gs.ghostChat : [],
      sixthSenseWarning: sixthSenseWarning || undefined,
      bloodhoundTarget,
      taskProgress,
      cooldowns,
      gameTimeRemaining,
      // Dead players see secret room info; alive players only at entrance
      secretRoomMethod: isDead ? gs.secretRoomMethod : (player.location === gs.secretRoomEntrance ? gs.secretRoomMethod : undefined),
      secretRoomEntrance: isDead ? gs.secretRoomEntrance : undefined,
      atSecretEntrance: player.location === gs.secretRoomEntrance || undefined,
      // Ghost vote availability
      ghostVoteAvailable: isDead ? !player.ghostVoteUsed : undefined,
      // Player locations at meeting start (shown during meeting/voting)
      meetingLocations: (gs.phase === 'meeting' || gs.phase === 'voting') ? this.meetingLocations : undefined,
      // Body report info (shown during meeting/voting)
      reportedBody: (gs.phase === 'meeting' || gs.phase === 'voting') ? this.reportedBody : undefined,
      // Include ejection result during results phase so clients can show the true role
      ejectionResult: gs.phase === 'results' && this.lastEjection
        ? { playerId: this.lastEjection.playerId, role: this.lastEjection.role, specialRole: this.lastEjection.specialRole, name: gs.players[this.lastEjection.playerId]?.name || '???' }
        : undefined,
      // Vote reveal data during voteReveal phase
      voteRevealData: gs.phase === 'voteReveal' ? gs.voteRevealData : undefined,
      // Phantom glitch: visible to all living players (don't show killerId — that's server-only)
      phantomGlitch: gs.phantomGlitch && gs.phantomGlitch.until > Date.now() ? gs.phantomGlitch : undefined,
    };
  }

  onClose(connection: Party.Connection) {
    const playerId = this.connectionToPlayer.get(connection.id);
    this.connectionToPlayer.delete(connection.id);

    if (!playerId || !this.gameState) return;

    // If host left, pass to next player — prefer players with active connections
    if (this.hostId === playerId) {
      const remaining = Object.keys(this.gameState.players).filter(id => id !== playerId);
      const connectedPlayerIds = new Set(this.connectionToPlayer.values());
      const connectedRemaining = remaining.filter(id => connectedPlayerIds.has(id));
      const newHost = connectedRemaining.length > 0 ? connectedRemaining[0]
        : remaining.length > 0 ? remaining[0] : null;
      this.hostId = newHost;
      this.gameState.hostId = this.hostId || undefined;
    }

    // In lobby or preGame: remove the player entirely
    if (this.gameState.phase === 'lobby' || this.gameState.phase === 'preGame') {
      delete this.gameState.players[playerId];
      // If preGame and now below MIN_PLAYERS, fall back to lobby
      if (this.gameState.phase === 'preGame' && Object.keys(this.gameState.players).length < GAME_CONFIG.MIN_PLAYERS) {
        this.resetToLobby();
      }
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
      if (this.gameState.phase === 'lobby' || this.gameState.phase === 'gameOver' || this.gameState.phase === 'preGame') return;
      this.gameState.players[playerId].status = 'dead';
      this.disconnectTimers.delete(playerId);
      this.checkWinCondition();
      this.broadcastFiltered();
    }, 300000);
    this.disconnectTimers.set(playerId, timer);
  }
}

GameServer satisfies Party.Worker;
