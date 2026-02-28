'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import usePartySocket from 'partysocket/react';
import { GameState, Location } from '@/types/game';
import {
  NarrativeTemplate,
  getTravelNarrative,
  getTaskNarrative,
  getKillNarrative,
  getDiscoveryNarrative,
  getMeetingNarrative,
  getIdleFlavor,
  getSecretRoomNarrative,
  getPowerupDescription,
} from '@/lib/narrative';

// ── Mini-map layout ──────────────────────────────

const MAP_ROWS: ({ id: string; abbr: string } | null)[][] = [
  [{ id: 'lobby', abbr: 'LOB' }, { id: 'speyer', abbr: 'SPY' }, null],
  [null, { id: 'suib', abbr: 'SUI' }, { id: 'meyers', abbr: 'MEY' }],
  [{ id: 'boulevard', abbr: 'BLV' }, null, null],
  [null, { id: 'cafeteria', abbr: 'CAF' }, { id: 'mj', abbr: 'MJ' }],
  [{ id: 'cvs', abbr: 'CVS' }, { id: 'music', abbr: 'MUS' }, null],
  [{ id: 'terrace', abbr: 'TER' }, null, { id: 'deard', abbr: 'DEA' }],
];

// ── BFS next step ────────────────────────────────

function bfsNextStep(locations: Location[], fromId: string, toId: string): { hops: number; nextRoom: string } | null {
  if (fromId === toId) return { hops: 0, nextRoom: fromId };
  const queue: { id: string; path: string[] }[] = [{ id: fromId, path: [] }];
  const visited = new Set([fromId]);
  while (queue.length > 0) {
    const { id, path } = queue.shift()!;
    const loc = locations.find(l => l.id === id);
    if (!loc) continue;
    for (const neighbor of loc.connectedTo) {
      if (visited.has(neighbor)) continue;
      const newPath = [...path, neighbor];
      if (neighbor === toId) return { hops: newPath.length, nextRoom: newPath[0] };
      visited.add(neighbor);
      queue.push({ id: neighbor, path: newPath });
    }
  }
  return null;
}

// ── Narrative state ──────────────────────────────

interface ActiveNarrative {
  lines: string[];
  choiceA: { label: string; result: string; action: () => void };
  choiceB: { label: string; result: string; action: () => void };
  autoResolve?: boolean; // Skip choices, auto-show result of A then dismiss
}

export default function Game() {
  const params = useParams();
  const router = useRouter();
  const roomCode = params.roomCode as string;
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerId, setPlayerId] = useState('');
  const [chatMessage, setChatMessage] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Narrative state
  const [narrative, setNarrative] = useState<ActiveNarrative | null>(null);
  const [revealedLines, setRevealedLines] = useState(0);
  const [showChoices, setShowChoices] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);
  const resultTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingNarrativeActionRef = useRef<(() => void) | null>(null);

  // Idle flavor
  const [flavorLines, setFlavorLines] = useState<string[]>([]);

  // Body discovery tracking (Set to prevent re-triggers when other kills happen)
  const discoveredBodiesRef = useRef<Set<string>>(new Set());

  // Grue tracking
  const [grueWarning, setGrueWarning] = useState(0);
  const grueTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Secret room discovery
  const [secretRoomFound, setSecretRoomFound] = useState(false);
  const secretTapRef = useRef({ count: 0, lastTap: 0 });

  // Track pending kill to detect shield block / silent rejection
  const pendingKillRef = useRef<string | null>(null);
  const [killPending, setKillPending] = useState(false);
  const [shieldBlockMsg, setShieldBlockMsg] = useState<string | null>(null);

  // Powerup countdown tick (forces re-render for live timer)
  const [, setTick] = useState(0);

  // Role reveal overlay
  const [showRoleReveal, setShowRoleReveal] = useState(false);
  const roleRevealShownRef = useRef(false);

  // Mini-map toggle
  const [showMap, setShowMap] = useState(false);

  // Restart delay (prevent rage-restart before others read results)
  const [restartReady, setRestartReady] = useState(false);

  // Task completion banner
  const [taskCompleteBanner, setTaskCompleteBanner] = useState(false);
  const prevTaskCountRef = useRef<number | null>(null);

  const socketRef = useRef<ReturnType<typeof usePartySocket> | null>(null);
  const socket = usePartySocket({
    host: process.env.NEXT_PUBLIC_PARTYKIT_HOST || 'localhost:1999',
    room: roomCode,
    onMessage(event) {
      const msg = JSON.parse(event.data);
      if (msg.type === 'gameState') {
        // Check if a pending kill failed (not shield — that has its own message)
        const victimId = pendingKillRef.current;
        if (victimId && msg.data.players?.[victimId]?.status === 'alive') {
          setShieldBlockMsg('Kill failed. Try again.');
          setTimeout(() => setShieldBlockMsg(null), 3000);
        }
        pendingKillRef.current = null;
        setKillPending(false);
        setGameState(msg.data);
      }
      if (msg.type === 'shieldBlocked') {
        pendingKillRef.current = null;
        setKillPending(false);
        setShieldBlockMsg(`Something protected ${msg.data?.victimName || 'them'}. Your attack failed.`);
        setTimeout(() => setShieldBlockMsg(null), 3000);
      }
    },
  });
  socketRef.current = socket;

  // Re-identify on every connection (including reconnects after WiFi drop)
  useEffect(() => {
    const handleOpen = () => {
      const pid = sessionStorage.getItem('playerId');
      if (pid && socketRef.current) {
        socketRef.current.send(JSON.stringify({ type: 'identify', playerId: pid }));
      }
    };
    socket.addEventListener('open', handleOpen);
    if (socket.readyState === WebSocket.OPEN) {
      handleOpen();
    }
    return () => socket.removeEventListener('open', handleOpen);
  }, [socket]);

  useEffect(() => {
    // Try sessionStorage first (survives refresh), then localStorage (survives tab close)
    const persistentId = sessionStorage.getItem('playerId')
      || localStorage.getItem(`playerId-${roomCode}`);
    if (persistentId) {
      setPlayerId(persistentId);
      sessionStorage.setItem('playerId', persistentId);
      localStorage.setItem(`playerId-${roomCode}`, persistentId);
    }
  }, [roomCode]);

  // Note: identify is handled by the handleOpen listener above (fires on connect + reconnect).
  // No separate effect needed — avoids double-send race.

  // ── Timer countdown ──────────────────────────

  useEffect(() => {
    if (!gameState?.timer) { setTimeLeft(0); return; }
    const update = () => {
      const elapsed = Math.floor((Date.now() - gameState.timer!.startTime) / 1000);
      setTimeLeft(Math.max(0, gameState.timer!.duration - elapsed));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [gameState?.timer?.startTime, gameState?.timer?.duration]);

  // ── Redirect to lobby on restart ─────────────
  useEffect(() => {
    if (gameState?.phase === 'lobby') {
      router.push(`/lobby/${roomCode}`);
    }
  }, [gameState?.phase]);

  // ── Auto-dismiss narrative on phase change ────
  // If a meeting/vote/results/gameOver starts while player is in a narrative,
  // dismiss it immediately so they can participate
  useEffect(() => {
    if (!narrative) return;
    if (gameState?.phase && gameState.phase !== 'playing') {
      if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
      pendingNarrativeActionRef.current = null;
      setNarrative(null);
      setResultText(null);
      setShowChoices(false);
    }
  }, [gameState?.phase]);

  // ── Auto-scroll chat ─────────────────────────

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [gameState?.chat?.length]);

  // ── Narrative line reveal ─────────────────────

  useEffect(() => {
    if (!narrative) return;
    if (resultText) return;

    if (revealedLines >= narrative.lines.length) {
      if (narrative.autoResolve) {
        // Auto-resolve: show result of A directly, skip choices
        const t = setTimeout(() => {
          setResultText(narrative.choiceA.result);
          resultTimerRef.current = setTimeout(() => {
            setNarrative(null);
            setResultText(null);
          }, 800);
        }, 200);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setShowChoices(true), 400);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setRevealedLines(r => r + 1), 600);
    return () => clearTimeout(t);
  }, [narrative, revealedLines, resultText]);

  // ── Idle flavor text ──────────────────────────

  const playerLocationRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (gameState?.phase !== 'playing' || narrative) return;
    setFlavorLines([]);
    let timer: NodeJS.Timeout;
    const schedule = () => {
      timer = setTimeout(() => {
        setFlavorLines(prev => [...prev.slice(-2), getIdleFlavor(playerLocationRef.current)]);
        schedule();
      }, 12000 + Math.random() * 8000);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [gameState?.phase, !!narrative]);

  // Clear flavor when moving
  useEffect(() => {
    setFlavorLines([]);
  }, [gameState?.players?.[playerId]?.location]);

  // ── Grue mechanic ──────────────────────────
  // Uses gameState ref to read fresh location data at timeout-fire time

  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;

  useEffect(() => {
    if (gameState?.phase !== 'playing') return;
    const player = gameState?.players?.[playerId];
    if (!player || player.status === 'dead') return;

    setGrueWarning(0);
    if (grueTimerRef.current) clearTimeout(grueTimerRef.current);

    const t1 = setTimeout(() => {
      setGrueWarning(1);
      setFlavorLines(prev => [...prev.slice(-1), 'The shadows are closing in...']);
    }, 50000);

    const t2 = setTimeout(() => {
      setGrueWarning(2);
      setFlavorLines(prev => [...prev.slice(-1), 'Something is watching you. MOVE.']);
    }, 75000);

    const t3 = setTimeout(() => {
      // Read fresh state at fire time to avoid stale closure
      const gs = gameStateRef.current;
      const p = gs?.players?.[playerId];
      if (!p || p.status !== 'alive') return;
      // Don't grue-move during doors locked
      if (gs?.doorsLocked && gs.doorsLocked.until > Date.now()) return;
      const loc = gs?.locations.find(l => l.id === p.location);
      if (!loc?.connectedTo.length) return;
      const exits = loc.connectedTo.filter(id => id !== 'secret');
      if (!exits.length) return;
      const randomExit = exits[Math.floor(Math.random() * exits.length)];
      setGrueWarning(0);
      setFlavorLines(['Something grabbed you! You stumble into another room.']);
      socket.send(JSON.stringify({ type: 'move', playerId, data: { location: randomExit } }));
    }, 90000);

    grueTimerRef.current = t3;
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [gameState?.phase, gameState?.players?.[playerId]?.location, gameState?.players?.[playerId]?.status]);

  // ── Countdown tick (powerups + cooldowns) ─────────────────────
  useEffect(() => {
    const player = gameState?.players?.[playerId];
    const hasPowerup = player?.powerup && player.powerup.until > Date.now();
    const hasCooldown = gameState?.cooldowns?.kill || gameState?.cooldowns?.sabotage || gameState?.cooldowns?.meeting;
    if (!hasPowerup && !hasCooldown) return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [gameState?.players?.[playerId]?.powerup?.until, gameState?.cooldowns?.kill, gameState?.cooldowns?.sabotage, gameState?.cooldowns?.meeting]);

  // ── Derived values ────────────────────────────
  const currentPlayer = gameState ? gameState.players[playerId] : null;
  const currentLocation = gameState?.locations.find(l => l.id === currentPlayer?.location);

  // Keep refs fresh for use in setTimeout closures
  playerLocationRef.current = currentPlayer?.location;

  // ── Restart delay on game over ─────────────────
  useEffect(() => {
    if (gameState?.phase === 'gameOver') {
      setRestartReady(false);
      const t = setTimeout(() => setRestartReady(true), 3000);
      return () => clearTimeout(t);
    }
  }, [gameState?.phase]);

  // ── Role reveal overlay ────────────────────────
  useEffect(() => {
    if (gameState?.phase === 'playing' && gameState.timer && !roleRevealShownRef.current) {
      const elapsed = Date.now() - gameState.timer.startTime;
      if (elapsed < 10000) {
        roleRevealShownRef.current = true;
        setShowRoleReveal(true);
        setTimeout(() => setShowRoleReveal(false), 4000);
      }
    }
  }, [gameState?.phase, gameState?.timer?.startTime]);

  // ── Task completion banner ─────────────────────
  useEffect(() => {
    const count = currentPlayer?.tasksCompleted ?? 0;
    if (prevTaskCountRef.current !== null && count > prevTaskCountRef.current) {
      setTaskCompleteBanner(true);
      setTimeout(() => setTaskCompleteBanner(false), 2000);
    }
    prevTaskCountRef.current = count;
  }, [currentPlayer?.tasksCompleted]);

  // ── Body discovery ──────────────────────────

  // Clear discovered bodies only when all bodies are cleared (after meeting)
  useEffect(() => {
    if (!gameState?.deadBodies?.length) {
      discoveredBodiesRef.current = new Set();
    }
  }, [!gameState?.deadBodies?.length]);

  useEffect(() => {
    if (narrative) return;
    if (!gameState?.deadBodies?.length || !currentPlayer) return;
    if (currentPlayer.status === 'dead') return;

    const bodyHere = gameState.deadBodies.find(
      b => b.location === currentPlayer.location && !discoveredBodiesRef.current.has(b.playerId)
    );
    if (!bodyHere) return;

    discoveredBodiesRef.current.add(bodyHere.playerId);
    const bodyPlayer = gameState.players[bodyHere.playerId];
    const template = getDiscoveryNarrative(bodyPlayer?.name || 'someone');
    startNarrative(
      template,
      () => socket.send(JSON.stringify({ type: 'reportBody', playerId })),
      () => {},
      false,
    );
  }, [narrative, currentPlayer?.location, gameState?.deadBodies?.length, currentPlayer?.status]);

  // ── Helpers ───────────────────────────────────

  const playersHere = gameState && currentPlayer
    ? Object.values(gameState.players).filter(
        p => p.location === currentPlayer.location && p.status === 'alive'
      )
    : [];

  const ghostsHere = gameState && currentPlayer && currentPlayer.status === 'dead'
    ? Object.values(gameState.players).filter(
        p => p.location === currentPlayer.location && p.status === 'dead' && p.id !== playerId
      )
    : [];

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // Game clock: during playing phase use local countdown, otherwise use frozen server value
  const gameClockSeconds = gameState?.phase === 'playing'
    ? timeLeft
    : (gameState?.gameTimeRemaining ?? 0);

  // ── Start a narrative ─────────────────────────

  const startNarrative = useCallback((
    template: NarrativeTemplate,
    onA: () => void,
    onB: () => void,
    autoResolve?: boolean,
  ) => {
    // Clear any pending result timer
    if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    setNarrative({
      lines: template.lines,
      choiceA: { ...template.choiceA, action: onA },
      choiceB: { ...template.choiceB, action: onB },
      autoResolve: autoResolve ?? false,
    });
    setRevealedLines(0);
    setShowChoices(false);
    setResultText(null);
    setFlavorLines([]);
    pendingNarrativeActionRef.current = null;
  }, []);

  const handleNarrativeChoice = (choice: 'a' | 'b') => {
    if (!narrative) return;
    const chosen = choice === 'a' ? narrative.choiceA : narrative.choiceB;
    setResultText(chosen.result);
    setShowChoices(false);
    pendingNarrativeActionRef.current = chosen.action;

    resultTimerRef.current = setTimeout(() => {
      chosen.action();
      setNarrative(null);
      setResultText(null);
      pendingNarrativeActionRef.current = null;
    }, 1200);
  };

  // Tap narrative to skip through
  const handleNarrativeSkip = useCallback(() => {
    if (!narrative) return;
    // If showing result text, skip the delay and finish
    if (resultText) {
      if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
      pendingNarrativeActionRef.current?.();
      setNarrative(null);
      setResultText(null);
      pendingNarrativeActionRef.current = null;
      return;
    }
    // If choices are showing, don't skip (let them pick)
    if (showChoices) return;
    // If lines still revealing, reveal all and proceed
    if (revealedLines < narrative.lines.length) {
      setRevealedLines(narrative.lines.length);
    }
  }, [narrative, resultText, showChoices, revealedLines]);

  // ── Action handlers ───────────────────────────

  const handleMove = (locationId: string) => {
    // Send move immediately
    socket.send(JSON.stringify({ type: 'move', playerId, data: { location: locationId } }));
    // Show narrative as flavor (autoResolve — both choices are no-ops)
    const dest = gameState?.locations.find(l => l.id === locationId);
    const template = getTravelNarrative(dest?.name || 'somewhere', locationId);
    startNarrative(template, () => {}, () => {}, true);
  };

  const handleGhostMove = (locationId: string) => {
    // Ghosts move instantly, no narrative
    socket.send(JSON.stringify({ type: 'move', playerId, data: { location: locationId } }));
  };

  const handleKill = (victimId: string) => {
    if (killPending) return; // Prevent double-fire
    // Send kill immediately — target can't escape during narrative
    discoveredBodiesRef.current.add(victimId);
    pendingKillRef.current = victimId;
    setKillPending(true);
    socket.send(JSON.stringify({ type: 'kill', playerId, data: { victimId } }));
    // Show kill narrative as flavor
    const victim = gameState?.players[victimId];
    const template = getKillNarrative(victim?.name || 'them');
    startNarrative(template, () => {}, () => {}, true);
  };

  const handleCompleteTask = (taskId: string) => {
    // Send task completion immediately
    socket.send(JSON.stringify({ type: 'completeTask', playerId, data: { taskId } }));
    // Show narrative as flavor
    const task = gameState?.tasks.find(t => t.id === taskId);
    const template = getTaskNarrative(task?.title || 'Task', task?.description || '');
    startNarrative(template, () => {}, () => {}, true);
  };

  const handleReportBody = () => {
    // Send report directly — no second narrative (discovery narrative already asked)
    socket.send(JSON.stringify({ type: 'reportBody', playerId }));
  };

  // Secret room: tap description to discover (3 taps)
  const handleSecretTap = useCallback(() => {
    if (secretRoomFound) return;
    const now = Date.now();
    const ref = secretTapRef.current;
    if (now - ref.lastTap > 3000) ref.count = 0;
    ref.count++;
    ref.lastTap = now;
    if (ref.count >= 3) {
      ref.count = 0;
      setSecretRoomFound(true);
    }
  }, [secretRoomFound]);

  const handleEnterSecretRoom = () => {
    if (!gameState?.secretRoomMethod) return;
    const template = getSecretRoomNarrative(gameState.secretRoomMethod);
    startNarrative(
      template,
      () => socket.send(JSON.stringify({ type: 'enterSecretRoom', playerId })),
      () => {},
      false,
    );
  };

  const handleCallMeeting = () => {
    // Keep functional — choice A calls meeting, choice B backs out
    const template = getMeetingNarrative();
    startNarrative(
      template,
      () => socket.send(JSON.stringify({ type: 'callMeeting', playerId })),
      () => {},
      false,
    );
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim()) return;

    socket.send(JSON.stringify({ type: 'chat', playerId, data: { message: chatMessage } }));
    setChatMessage('');
  };

  const handleVote = (votedForId: string) => {
    socket.send(JSON.stringify({ type: 'vote', playerId, data: { votedForId } }));
  };

  const divider = () => <div className="text-[var(--dim)] my-3">{'═'.repeat(30)}</div>;

  // ── Loading states ────────────────────────────

  if (!gameState) {
    return (
      <div className="min-h-screen p-4 max-w-lg mx-auto mt-8">
        <p className="text-xl glow">LOADING GAME DATA...</p>
        <span className="cursor-blink text-xl">&#9612;</span>
      </div>
    );
  }

  if (!currentPlayer) {
    return (
      <div className="min-h-screen p-4 max-w-lg mx-auto mt-8">
        <p className="text-xl text-[var(--red)] glow-red">ERROR: PLAYER NOT FOUND</p>
        <p className="text-[var(--dim)] mt-2">Session may have expired.</p>
        <button onClick={() => window.location.href = '/'} className="term-btn mt-4 text-xl">
          [RETURN TO MAIN MENU]
        </button>
      </div>
    );
  }

  // ── ROLE REVEAL OVERLAY ──────────────────────

  const roleRevealOverlay = showRoleReveal && currentPlayer && (
    <div className="fixed inset-0 z-40 bg-black flex items-center justify-center p-4">
      <div className="max-w-sm w-full text-center">
        {currentPlayer.role === 'impostor' ? (
          <>
            <pre className="text-[var(--red)] glow-red leading-tight">{`
  _____
 /     \\
| () () |
 \\ ___ /
  |||||`}</pre>
            <p className="text-[var(--red)] glow-red text-3xl mt-4 tracking-widest">
              IMPOSTOR
            </p>
            <p className="text-[var(--dim)] mt-3">Kill. Sabotage. Survive.</p>
            <p className="text-[var(--dim)] mt-1">You are not alone.</p>
          </>
        ) : (
          <>
            <pre className="text-[var(--green)] glow leading-tight">{`
   ___
  /   \\
 | o o |
  \\_^_/
   |||`}</pre>
            <p className="text-[var(--green)] glow text-3xl mt-4 tracking-widest">
              INNOCENT
            </p>
            <p className="text-[var(--dim)] mt-3">Complete ALL tasks to win. Report bodies.</p>
            <p className="text-[var(--dim)] mt-1">Trust no one.</p>
          </>
        )}
      </div>
    </div>
  );

  // ── TASK COMPLETE BANNER ─────────────────────

  const taskBanner = taskCompleteBanner && (
    <div className="fixed top-0 left-0 right-0 z-30 text-center py-3" style={{ background: 'rgba(0, 255, 65, 0.15)' }}>
      <p className="text-[var(--green)] glow text-xl tracking-widest">TASK COMPLETE</p>
    </div>
  );

  // ── NARRATIVE SCREEN ──────────────────────────

  if (narrative) {
    return (
      <div className="min-h-screen p-4 max-w-lg mx-auto flex flex-col justify-center" onClick={handleNarrativeSkip}>

        {roleRevealOverlay}
        {taskBanner}
        {/* Game clock during narrative */}
        {gameClockSeconds > 0 && (
          <p className="text-[var(--amber)] text-sm text-right mb-4 opacity-60">[{formatTime(gameClockSeconds)}]</p>
        )}
        <div>
          {narrative.lines.slice(0, revealedLines).map((line, i) => (
            <p key={i} className="text-xl mb-2 glow">{line}</p>
          ))}

          {revealedLines < narrative.lines.length && (
            <span className="cursor-blink text-xl">&#9612;</span>
          )}

          {showChoices && !resultText && (
            <div className="mt-6" onClick={e => e.stopPropagation()}>
              <button
                onClick={() => handleNarrativeChoice('a')}
                className="term-btn text-xl"
              >
                {'> '}{narrative.choiceA.label}
              </button>
              <button
                onClick={() => handleNarrativeChoice('b')}
                className="term-btn text-xl text-[var(--dim)]"
              >
                {'> '}{narrative.choiceB.label}
              </button>
            </div>
          )}

          {resultText && (
            <p className="text-lg text-[var(--dim)] mt-6 glow">{resultText}</p>
          )}

          {/* Skip hint */}
          {revealedLines < narrative.lines.length && (
            <p className="text-[var(--dim)] text-sm mt-8 text-center">tap to skip</p>
          )}
        </div>
      </div>
    );
  }

  // ── GAME OVER ─────────────────────────────────

  if (gameState.phase === 'gameOver') {
    const allPlayers = Object.values(gameState.players);
    return (
      <div className="min-h-screen p-4 max-w-lg mx-auto">

        <div className="mt-8">
          {divider()}
          {gameState.winner === 'innocents' ? (
            <div>
              <pre className="text-[var(--green)] glow text-center leading-tight">{`
 ██╗███╗   ██╗███╗   ██╗ ██████╗  ██████╗███████╗███╗   ██╗████████╗███████╗
 ██║████╗  ██║████╗  ██║██╔═══██╗██╔════╝██╔════╝████╗  ██║╚══██╔══╝██╔════╝
 ██║██╔██╗ ██║██╔██╗ ██║██║   ██║██║     █████╗  ██╔██╗ ██║   ██║   ███████╗
 ██║██║╚██╗██║██║╚██╗██║██║   ██║██║     ██╔══╝  ██║╚██╗██║   ██║   ╚════██║
 ██║██║ ╚████║██║ ╚████║╚██████╔╝╚██████╗███████╗██║ ╚████║   ██║   ███████║
 ╚═╝╚═╝  ╚═══╝╚═╝  ╚═══╝ ╚═════╝  ╚═════╝╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝
                        W   I   N`}</pre>
              <p className="text-[var(--dim)] text-center mt-2">The impostor has been stopped.</p>
              <p className="text-[var(--dim)] text-center text-sm">The school is safe. For now.</p>
            </div>
          ) : (
            <div>
              <pre className="text-[var(--red)] glow-red text-center leading-tight">{`
  ██████╗  █████╗ ███╗   ███╗███████╗
 ██╔════╝ ██╔══██╗████╗ ████║██╔════╝
 ██║  ███╗███████║██╔████╔██║█████╗
 ██║   ██║██╔══██║██║╚██╔╝██║██╔══╝
 ╚██████╔╝██║  ██║██║ ╚═╝ ██║███████╗
  ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝
          O   V   E   R`}</pre>
              <p className="text-[var(--red)] text-center mt-2">The impostors win.</p>
              <p className="text-[var(--dim)] text-center text-sm">The school has fallen. The halls are empty now.</p>
            </div>
          )}
          {divider()}

          <p className="text-lg mt-6 mb-3">ROLES REVEALED:</p>
          {allPlayers.map(p => (
            <p key={p.id} className="text-lg mb-1">
              <span style={{ color: p.color }}>{p.name} ({p.icon})</span>
              <span className="text-[var(--dim)]"> {'.'.repeat(Math.max(1, 20 - p.name.length))} </span>
              <span className={p.role === 'impostor' ? 'text-[var(--red)]' : 'text-[var(--green)]'}>
                {p.role === 'impostor' ? 'IMPOSTOR' : 'INNOCENT'}
              </span>
              {p.status === 'dead' && <span className="text-[var(--dim)]"> (dead)</span>}
            </p>
          ))}

          <div className="mt-8 flex flex-col gap-2">
            <button
              onClick={() => {
                if (!restartReady) return;
                socket.send(JSON.stringify({ type: 'restartGame', playerId }));
                setSecretRoomFound(false);
                roleRevealShownRef.current = false;
              }}
              className={`term-btn text-xl ${restartReady ? 'glow' : 'text-[var(--dim)]'}`}
            >
              {restartReady ? '[PLAY AGAIN — SAME GROUP]' : '[PLAY AGAIN — wait...]'}
            </button>
            <button onClick={() => window.location.href = '/'} className="term-btn text-xl text-[var(--dim)]">
              [NEW ROOM]
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── RESULTS (with vote breakdown) ──────────────

  if (gameState.phase === 'results') {
    const ejection = gameState.ejectionResult;

    // Build vote breakdown from gameState.votes
    const voteBreakdown: Record<string, string[]> = {};
    for (const [voterId, targetId] of Object.entries(gameState.votes)) {
      if (!voteBreakdown[targetId]) voteBreakdown[targetId] = [];
      const voterName = gameState.players[voterId]?.name || '???';
      voteBreakdown[targetId].push(voterName);
    }

    return (
      <div className="min-h-screen p-4 max-w-lg mx-auto">

        <div className="mt-8">
          {/* Game clock */}
          {gameClockSeconds > 0 && (
            <p className="text-[var(--amber)] text-sm text-right opacity-60">Game: [{formatTime(gameClockSeconds)}]</p>
          )}
          {divider()}
          <pre className="text-[var(--green)] glow text-center leading-tight">{`
 ╔═══════════════════════════╗
 ║   V O T E   R E S U L T  ║
 ╚═══════════════════════════╝`}</pre>
          {divider()}

          {ejection ? (
            <div className="mt-6 text-center">
              <p className="text-xl" style={{ color: gameState.players[ejection.playerId]?.color }}>
                {ejection.name} was ejected.
              </p>
              <p className={`text-lg mt-2 ${
                ejection.role === 'impostor' ? 'text-[var(--red)] glow-red' : 'text-[var(--green)]'
              }`}>
                {ejection.name} was {ejection.role === 'impostor' ? 'the IMPOSTOR.' : 'INNOCENT.'}
              </p>
            </div>
          ) : (
            <p className="text-xl text-center mt-6 text-[var(--dim)]">
              No one was ejected.
            </p>
          )}

          {/* Vote breakdown */}
          {Object.keys(voteBreakdown).length > 0 && (
            <div className="mt-6">
              <p className="text-[var(--dim)] text-base mb-2">VOTE BREAKDOWN:</p>
              {Object.entries(voteBreakdown).map(([targetId, voters]) => {
                const targetName = targetId === 'skip' ? 'SKIP' : (gameState.players[targetId]?.name || '???');
                const targetColor = targetId === 'skip' ? 'var(--amber)' : (gameState.players[targetId]?.color || 'var(--green)');
                return (
                  <p key={targetId} className="text-base mb-1">
                    <span style={{ color: targetColor }}>{targetName}</span>
                    <span className="text-[var(--dim)]"> ({voters.length}): {voters.join(', ')}</span>
                  </p>
                );
              })}
            </div>
          )}

          <p className="text-[var(--dim)] text-center mt-8">Returning to game...</p>
          <span className="cursor-blink text-xl">&#9612;</span>
        </div>
      </div>
    );
  }

  // ── VOTING (with self-vote prevention + progress) ──

  if (gameState.phase === 'voting') {
    const alivePlayers = Object.values(gameState.players).filter(p => p.status === 'alive');
    const hasVoted = gameState.votes[playerId] !== undefined;
    const votesCast = Object.keys(gameState.votes).length;
    const totalVoters = alivePlayers.length;

    return (
      <div className="min-h-screen p-4 max-w-lg mx-auto flex flex-col">

        <div className="mt-8">
          {/* Game clock */}
          {gameClockSeconds > 0 && (
            <p className="text-[var(--amber)] text-sm text-right opacity-60">Game: [{formatTime(gameClockSeconds)}]</p>
          )}
          {divider()}
          <pre className="text-[var(--amber)] glow-amber text-center leading-tight">{`
 ██╗   ██╗ ██████╗ ████████╗███████╗
 ██║   ██║██╔═══██╗╚══██╔══╝██╔════╝
 ██║   ██║██║   ██║   ██║   █████╗
 ╚██╗ ██╔╝██║   ██║   ██║   ██╔══╝
  ╚████╔╝ ╚██████╔╝   ██║   ███████╗
   ╚═══╝   ╚═════╝    ╚═╝   ╚══════╝`}</pre>
          <p className="text-[var(--amber)] text-center glow-amber">[{formatTime(timeLeft)}]</p>
          {/* Vote progress */}
          <p className="text-[var(--dim)] text-center text-base">Votes: {votesCast}/{totalVoters}</p>
          {divider()}

          {currentPlayer.status === 'dead' ? (
            <p className="text-[var(--dim)] mt-4">(You are dead. Observing.)</p>
          ) : hasVoted ? (
            <div className="mt-4">
              <p className="text-[var(--dim)]">Vote cast. Waiting for others... ({votesCast}/{totalVoters})</p>
            </div>
          ) : (
            <div className="mt-4">
              {/* Don't show self in vote targets */}
              {alivePlayers.filter(p => p.id !== playerId).map(p => (
                <button
                  key={p.id}
                  onClick={() => handleVote(p.id)}
                  className="term-btn text-lg"
                >
                  {'> '}
                  <span style={{ color: p.color }}>
                    {p.name} ({p.icon})
                  </span>
                </button>
              ))}
              <button
                onClick={() => handleVote('skip')}
                className="term-btn term-btn-amber text-lg mt-2"
              >
                {'> '}SKIP VOTE
              </button>
            </div>
          )}
        </div>

        {/* Chat during voting */}
        <div className="flex-1 overflow-y-auto my-4 min-h-[100px] max-h-[30vh]">
          {gameState.chat.map(msg => {
            const sender = gameState.players[msg.playerId];
            return (
              <p key={msg.id} className="text-base mb-1">
                <span style={{ color: sender?.color || 'var(--green)' }}>
                  {msg.playerName}:
                </span>
                {' '}{msg.message}
              </p>
            );
          })}
          <div ref={chatEndRef} />
        </div>

        {currentPlayer.status === 'alive' && (
          <div className="pb-4">
            <div className="flex flex-wrap gap-1 mb-2">
              {['Who?', 'Self-report?', 'Skip vote', 'They\'re sus'].map(phrase => (
                <button
                  key={phrase}
                  className="text-sm px-3 py-1.5 border border-[var(--dim)] text-[var(--dim)] bg-transparent"
                  onClick={() => socket.send(JSON.stringify({ type: 'chat', playerId, data: { message: phrase } }))}
                >
                  {phrase}
                </button>
              ))}
            </div>
            <form onSubmit={handleSendChat} className="flex gap-2">
              <span className="text-[var(--dim)] text-xl mt-1">{'>'}</span>
              <input
                type="text"
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                className="term-input flex-1"
                placeholder="speak..."
                maxLength={200}
              />
            </form>
          </div>
        )}
      </div>
    );
  }

  // ── MEETING (with game clock) ──────────────────

  if (gameState.phase === 'meeting') {
    return (
      <div className="min-h-screen p-4 max-w-lg mx-auto flex flex-col">

        <div className="mt-8">
          {/* Game clock */}
          {gameClockSeconds > 0 && (
            <p className="text-[var(--amber)] text-sm text-right opacity-60">Game: [{formatTime(gameClockSeconds)}]</p>
          )}
          {divider()}
          {gameState.deadBodies?.some(b => b.reportedBy) ? (
            <pre className="text-[var(--red)] glow-red text-center leading-tight">{`
 ██████╗  ██████╗ ██████╗ ██╗   ██╗
 ██╔══██╗██╔═══██╗██╔══██╗╚██╗ ██╔╝
 ██████╔╝██║   ██║██║  ██║ ╚████╔╝
 ██╔══██╗██║   ██║██║  ██║  ╚██╔╝
 ██████╔╝╚██████╔╝██████╔╝   ██║
 ╚═════╝  ╚═════╝ ╚═════╝    ╚═╝
    R E P O R T E D`}</pre>
          ) : (
            <pre className="text-[var(--amber)] glow-amber text-center leading-tight">{`
 ███╗   ███╗███████╗███████╗████████╗██╗███╗   ██╗ ██████╗
 ████╗ ████║██╔════╝██╔════╝╚══██╔══╝██║████╗  ██║██╔════╝
 ██╔████╔██║█████╗  █████╗     ██║   ██║██╔██╗ ██║██║  ███╗
 ██║╚██╔╝██║██╔══╝  ██╔══╝     ██║   ██║██║╚██╗██║██║   ██║
 ██║ ╚═╝ ██║███████╗███████╗   ██║   ██║██║ ╚████║╚██████╔╝
 ╚═╝     ╚═╝╚══════╝╚══════╝   ╚═╝   ╚═╝╚═╝  ╚═══╝ ╚═════╝`}</pre>
          )}
          <p className="text-[var(--amber)] text-center">[{formatTime(timeLeft)}]</p>

          {/* Body report info */}
          {gameState.reportedBody && (
            <p className="text-[var(--red)] text-center text-base mt-1">
              {gameState.reportedBody.reportedBy} found {gameState.reportedBody.name} dead at {gameState.reportedBody.location}
            </p>
          )}
          {divider()}

          {/* Player locations at meeting start */}
          {gameState.meetingLocations && Object.keys(gameState.meetingLocations).length > 0 && (
            <div className="mb-3">
              <p className="text-[var(--dim)] text-base mb-1">LOCATIONS WHEN CALLED:</p>
              {Object.entries(gameState.meetingLocations).map(([pid, locName]) => {
                const p = gameState.players[pid];
                if (!p) return null;
                return (
                  <p key={pid} className="text-base ml-2">
                    <span style={{ color: p.color }}>{p.name}</span>
                    <span className="text-[var(--dim)]"> — {locName}</span>
                  </p>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto my-4 min-h-[200px] max-h-[50vh]">
          {gameState.chat.length === 0 && (
            <p className="text-[var(--dim)]">Silence. Someone needs to talk first.</p>
          )}
          {gameState.chat.map(msg => {
            const sender = gameState.players[msg.playerId];
            return (
              <p key={msg.id} className="text-lg mb-1">
                <span style={{ color: sender?.color || 'var(--green)' }}>
                  {msg.playerName}:
                </span>
                {' '}{msg.message}
              </p>
            );
          })}
          <div ref={chatEndRef} />
        </div>

        {currentPlayer.status === 'alive' ? (
          <div className="pb-4">
            {/* Quick-chat buttons */}
            <div className="flex flex-wrap gap-1 mb-2">
              {['I saw a body', 'I was doing tasks', 'They\'re sus', 'Who?', 'Self-report?', 'Where was everyone?', 'I was with them', 'I\'m innocent'].map(phrase => (
                <button
                  key={phrase}
                  className="text-sm px-3 py-1.5 border border-[var(--dim)] text-[var(--dim)] bg-transparent"
                  onClick={() => socket.send(JSON.stringify({ type: 'chat', playerId, data: { message: phrase } }))}
                >
                  {phrase}
                </button>
              ))}
            </div>
            <form onSubmit={handleSendChat} className="flex gap-2">
              <span className="text-[var(--dim)] text-xl mt-1">{'>'}</span>
              <input
                type="text"
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                className="term-input flex-1"
                placeholder="speak..."
                maxLength={200}
              />
            </form>
          </div>
        ) : (
          <p className="text-[var(--dim)] pb-4">(You are dead. You can only listen.)</p>
        )}
      </div>
    );
  }

  // ── MAIN PLAYING PHASE ────────────────────────

  const othersHere = playersHere.filter(p => p.id !== playerId);
  const isLightsOut = gameState.lightsOut ? Date.now() < gameState.lightsOut.until : false;
  const visibleOthers = othersHere;
  const isImpostor = currentPlayer.role === 'impostor';

  const killTargets = isImpostor
    ? othersHere.filter(p => p.role !== 'impostor')
    : [];

  const impostorNearby = !!gameState.sixthSenseWarning;

  const hasLocationPower = currentPlayer.powerup &&
    (currentPlayer.powerup.type === 'radar' || currentPlayer.powerup.type === 'tracker') &&
    currentPlayer.powerup.until > Date.now();

  const bloodhoundTarget = gameState.bloodhoundTarget || null;
  const isDoorsLocked = gameState.doorsLocked ? Date.now() < gameState.doorsLocked.until : false;

  // Cooldown computations
  const now = Date.now();
  const killCooldownLeft = gameState.cooldowns?.kill ? Math.max(0, Math.ceil((gameState.cooldowns.kill - now) / 1000)) : 0;
  const sabotageCooldownLeft = gameState.cooldowns?.sabotage ? Math.max(0, Math.ceil((gameState.cooldowns.sabotage - now) / 1000)) : 0;
  const meetingCooldownLeft = gameState.cooldowns?.meeting ? Math.max(0, Math.ceil((gameState.cooldowns.meeting - now) / 1000)) : 0;

  // Tasks in current room
  const myTasksHere = gameState.tasks.filter(t =>
    t.id.startsWith(playerId) && t.location === currentPlayer.location
  );

  // All tasks (for persistent task list)
  const allMyTasks = gameState.tasks.filter(t => t.id.startsWith(playerId));

  return (
    <div className="min-h-screen p-4 max-w-lg mx-auto pb-16">
      {roleRevealOverlay}
      {taskBanner}

      {/* Header */}
      <div className="mt-4">
        <div className="text-[var(--dim)]">{'═'.repeat(30)}</div>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            {isImpostor ? (
              <div>
                <pre className="text-[var(--red)] glow-red leading-tight">{`  _____
 /     \\
| () () |  ROLE: IMPOSTOR
 \\ ___ /
  |||||`}</pre>
              </div>
            ) : (
              <p className="text-xl">
                {' '}ROLE: INNOCENT {'  '}TASKS: {currentPlayer.tasksCompleted}/{currentPlayer.totalTasks}
              </p>
            )}
          </div>
          {/* Game clock — always visible */}
          {gameClockSeconds > 0 && (
            <p className="text-[var(--amber)] glow-amber text-lg ml-2 whitespace-nowrap">
              [{formatTime(gameClockSeconds)}]
            </p>
          )}
        </div>
        {currentPlayer.status === 'dead' && (
          <div>
            <pre className="text-[var(--red)] glow-red leading-tight">{`
  ██████╗ ███████╗ █████╗ ██████╗
  ██╔══██╗██╔════╝██╔══██╗██╔══██╗
  ██║  ██║█████╗  ███████║██║  ██║
  ██║  ██║██╔══╝  ██╔══██║██║  ██║
  ██████╔╝███████╗██║  ██║██████╔╝
  ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═════╝`}</pre>
            <p className="text-[var(--dim)] text-base"> GHOST MODE — You drift unseen.</p>
          </div>
        )}
        {/* Global task progress bar */}
        {gameState.taskProgress && (
          <div className="mt-1">
            <div className="flex items-center gap-2">
              <span className="text-[var(--dim)] text-base">TASKS (fill to win)</span>
              <div className="flex-1 h-4 border border-[var(--dim)]">
                <div
                  className="h-full bg-[var(--green)]"
                  style={{ width: `${Math.round((gameState.taskProgress.completed / gameState.taskProgress.total) * 100)}%` }}
                />
              </div>
              <span className="text-[var(--dim)] text-base">{gameState.taskProgress.completed}/{gameState.taskProgress.total}</span>
            </div>
          </div>
        )}
        <div className="text-[var(--dim)]">{'═'.repeat(30)}</div>
      </div>

      {/* Location */}
      <div className="mt-4 mb-3">
        <h2 className="text-2xl glow">{currentLocation?.name.toUpperCase()}</h2>
        <p
          className="text-[var(--dim)] mt-1 text-lg"
          onClick={gameState.atSecretEntrance ? handleSecretTap : undefined}
        >
          {currentLocation?.description}
        </p>
        {/* Secret room hint — gets more visible after 2 minutes */}
        {gameState.atSecretEntrance && !secretRoomFound && gameState.secretRoomMethod && (() => {
          const gameElapsed = gameState.timer ? (Date.now() - gameState.timer.startTime) / 1000 : 0;
          const isUrgent = gameElapsed > 120;
          return (
            <p className={`text-[var(--cyan)] mt-1 ${isUrgent ? 'text-lg glow' : 'text-base'}`}>
              {gameState.secretRoomMethod === 'piano' && (isUrgent
                ? 'A hidden panel glows near the piano. TAP THE DESCRIPTION ABOVE.'
                : 'Something in the corner catches your eye... (tap the description)')}
              {gameState.secretRoomMethod === 'shelves' && (isUrgent
                ? 'The shelves are vibrating. Something is behind them. TAP THE DESCRIPTION ABOVE.'
                : 'A faint hum comes from behind the shelves... (tap the description)')}
              {gameState.secretRoomMethod === 'cases' && (isUrgent
                ? 'A case in the back is rattling violently. TAP THE DESCRIPTION ABOVE.'
                : 'Something rattles in the back of the room... (tap the description)')}
            </p>
          );
        })()}
      </div>

      {/* Mini-map toggle */}
      <button onClick={() => setShowMap(!showMap)} className="text-[var(--dim)] text-base mb-2 bg-transparent border-none cursor-pointer">
        [{showMap ? '-' : '+'}] MAP
      </button>
      {showMap && (
        <div className="mb-4 font-mono text-base leading-relaxed">
          {MAP_ROWS.map((row, ri) => (
            <div key={ri} className="flex">
              {row.map((cell, ci) => {
                if (!cell) return <span key={ci} className="w-20 inline-block">&nbsp;</span>;
                const isCurrent = cell.id === currentPlayer.location;
                const hasTask = allMyTasks.some(t => t.location === cell.id);
                return (
                  <span
                    key={ci}
                    className={`w-20 inline-block ${isCurrent ? 'text-[var(--green)] glow' : hasTask ? 'text-[var(--amber)]' : 'text-[var(--dim)]'}`}
                  >
                    {isCurrent ? `[${cell.abbr}]` : ` ${cell.abbr} `}
                    {hasTask && !isCurrent && '*'}
                  </span>
                );
              })}
            </div>
          ))}
          <p className="text-[var(--dim)] text-xs mt-1">[ ] = you {'  '} * = task</p>
        </div>
      )}

      {/* Persistent task list */}
      {currentPlayer.role === 'innocent' && allMyTasks.length > 0 && (
        <div className="mb-4">
          <p className="text-[var(--dim)] text-base mb-1">YOUR TASKS:</p>
          {allMyTasks.map(task => {
            const loc = gameState.locations.find(l => l.id === task.location);
            const isHere = task.location === currentPlayer.location;
            const nav = !isHere && currentPlayer.location
              ? bfsNextStep(gameState.locations, currentPlayer.location, task.location)
              : null;
            const nextLoc = nav ? gameState.locations.find(l => l.id === nav.nextRoom) : null;
            return (
              <p key={task.id} className={`text-base ml-2 ${isHere ? 'text-[var(--green)]' : 'text-[var(--dim)]'}`}>
                {isHere ? '>' : ' '} {task.title} — {loc?.name || '???'}
                {isHere && ' [HERE]'}
                {!isHere && nav && (
                  <span className="text-[var(--amber)]"> ({nav.hops}{nav.hops === 1 ? ' room' : ' rooms'}, go: {nextLoc?.name || '???'})</span>
                )}
              </p>
            );
          })}
        </div>
      )}

      {/* Active powerup */}
      {currentPlayer.powerup && currentPlayer.powerup.until > Date.now() && (
        <p className="text-[var(--cyan)] glow text-lg mb-2">
          &#9889; {getPowerupDescription(currentPlayer.powerup.type)} [{Math.max(0, Math.ceil((currentPlayer.powerup.until - Date.now()) / 1000))}s]
        </p>
      )}

      {/* Sabotage banners */}
      {isLightsOut && (
        <p className="text-[var(--amber)] glow-amber text-lg mb-2">
          ⚡ LIGHTS OUT ⚡ — You can barely see anything.
        </p>
      )}
      {gameState.scrambled && Date.now() < gameState.scrambled.until && (
        <p className="text-[var(--amber)] glow-amber text-lg mb-2">
          &#9889; SCRAMBLE &#9889; — Everyone has been teleported!
        </p>
      )}
      {isDoorsLocked && (
        <div className="mb-2">
          <p className="text-[var(--red)] glow-red text-lg">
            &#128274; DOORS LOCKED &#128274; — You can't move.
          </p>
          {othersHere.length > 0 && (
            <p className="text-[var(--dim)] text-base">
              Trapped with: {othersHere.map(p => p.name).join(', ')}
            </p>
          )}
        </div>
      )}

      {/* Shield block message (impostor only) */}
      {shieldBlockMsg && (
        <p className="text-[var(--cyan)] glow text-lg mb-2">
          &#9876; {shieldBlockMsg}
        </p>
      )}

      {/* Sixth Sense warning */}
      {impostorNearby && (
        <p className="text-[var(--red)] glow-red text-lg mb-2">
          &#9888; Your sixth sense tingles. Something is wrong here.
        </p>
      )}

      {/* Players here */}
      <div className="mb-4">
        {visibleOthers.length > 0 ? (
          <p className="text-lg">
            <span className="text-[var(--dim)]">You see: </span>
            {isLightsOut && !isImpostor ? (
              <span className="text-[var(--dim)]">
                Shadows move around you...
              </span>
            ) : (
              visibleOthers.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ', '}
                  <span style={{ color: p.color }}>{p.name} ({p.icon})</span>
                  {/* Co-impostor ALLY tag */}
                  {isImpostor && p.role === 'impostor' && (
                    <span className="text-[var(--red)]"> [ALLY]</span>
                  )}
                </span>
              ))
            )}
          </p>
        ) : (
          <p className="text-[var(--dim)] text-lg">
            {isLightsOut ? "You can't tell if you're alone." : "You are alone here."}
          </p>
        )}
        {/* Ghosts visible to other ghosts */}
        {currentPlayer.status === 'dead' && ghostsHere.length > 0 && (
          <p className="text-[var(--dim)] text-base mt-1">
            Ghosts: {ghostsHere.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ', '}
                <span style={{ color: p.color, opacity: 0.5 }}>{p.name}</span>
              </span>
            ))}
          </p>
        )}
      </div>

      {/* Radar / Tracker — see all player locations */}
      {hasLocationPower && (
        <div className="mb-4">
          <p className="text-[var(--cyan)] text-lg">SCANNING ALL LOCATIONS:</p>
          {Object.values(gameState.players)
            .filter(p => p.status === 'alive' && p.id !== playerId && p.location !== '__shadow__')
            .map(p => {
              const loc = gameState.locations.find(l => l.id === p.location);
              return (
                <p key={p.id} className="text-base ml-2">
                  <span style={{ color: p.color }}>{p.name}</span>
                  <span className="text-[var(--dim)]"> — {loc?.name || '???'}</span>
                </p>
              );
            })}
        </div>
      )}

      {/* Bloodhound — most isolated player (computed server-side) */}
      {bloodhoundTarget && (
        <div className="mb-4">
          <p className="text-[var(--cyan)] text-lg">
            BLOODHOUND: <span style={{ color: bloodhoundTarget.color }}>{bloodhoundTarget.name}</span>
            <span className="text-[var(--dim)]"> is alone at {bloodhoundTarget.locationName}</span>
          </p>
        </div>
      )}

      {currentPlayer.status === 'alive' ? (
        <>
          {/* Dead bodies */}
          {gameState.deadBodies?.filter(b => b.location === currentPlayer.location).map(body => (
            <div key={body.playerId} className="mb-4">
              <p className="text-[var(--red)] glow-red text-lg">
                {isLightsOut && !isImpostor
                  ? 'You trip over something. A body.'
                  : `${gameState.players[body.playerId]?.name || 'Someone'} lies motionless on the ground.`}
              </p>
              {!body.reportedBy && (
                <button className="term-btn term-btn-red text-lg" onClick={handleReportBody}>
                  {'> '}Report body
                </button>
              )}
            </div>
          ))}

          {/* Kill targets (impostor) with cooldown */}
          {isImpostor && (
            <div className="mb-4">
              {killCooldownLeft > 0 ? (
                <p className="text-[var(--dim)] text-lg">KILL [{killCooldownLeft}s]</p>
              ) : killPending ? (
                <p className="text-[var(--dim)] text-lg">KILL [...]</p>
              ) : killTargets.length > 0 ? (
                <>
                  <p className="text-[var(--red)] text-lg">TARGETS:</p>
                  {killTargets.map(p => (
                    <button
                      key={p.id}
                      className="term-btn term-btn-red text-lg"
                      onClick={() => handleKill(p.id)}
                    >
                      {'> '}
                      <span style={{ color: p.color }}>{p.name}</span>
                    </button>
                  ))}
                </>
              ) : null}
            </div>
          )}

          {/* Sabotage (impostor) with cooldown */}
          {isImpostor && (
            <div className="mb-4">
              {sabotageCooldownLeft > 0 ? (
                <p className="text-[var(--dim)] text-lg">SABOTAGE [{sabotageCooldownLeft}s]</p>
              ) : !isLightsOut && !isDoorsLocked ? (
                <>
                  <p className="text-[var(--red)] text-lg">SABOTAGE:</p>
                  <button
                    className="term-btn term-btn-amber text-lg"
                    onClick={() => socket.send(JSON.stringify({ type: 'sabotage', playerId, data: { type: 'lightsOut' } }))}
                  >
                    {'> '}Kill the lights (30s)
                  </button>
                  <button
                    className="term-btn term-btn-amber text-lg"
                    onClick={() => socket.send(JSON.stringify({ type: 'sabotage', playerId, data: { type: 'doorsLocked' } }))}
                  >
                    {'> '}Lock the doors (25s)
                  </button>
                  <button
                    className="term-btn term-btn-amber text-lg"
                    onClick={() => socket.send(JSON.stringify({ type: 'sabotage', playerId, data: { type: 'scramble' } }))}
                  >
                    {'> '}Scramble everyone
                  </button>
                </>
              ) : null}
            </div>
          )}

          {/* Tasks here (innocent) */}
          {currentPlayer.role === 'innocent' && myTasksHere.length > 0 && (
            <div className="mb-4">
              <p className="text-lg">TASKS HERE:</p>
              {myTasksHere.map(task => (
                <button
                  key={task.id}
                  className="term-btn text-lg"
                  onClick={() => handleCompleteTask(task.id)}
                >
                  {'> '}{task.title}
                </button>
              ))}
            </div>
          )}

          {/* Exits */}
          <div className="mb-4">
            <p className="text-lg">EXITS:</p>
            {currentLocation?.connectedTo
              .filter(locId => locId !== 'secret')
              .map(locId => {
                const loc = gameState.locations.find(l => l.id === locId);
                return (
                  <button
                    key={locId}
                    className={`term-btn text-lg ${isDoorsLocked ? 'text-[var(--dim)]' : ''}`}
                    onClick={() => !isDoorsLocked && handleMove(locId)}
                    disabled={isDoorsLocked}
                  >
                    {'> '}{loc?.name}{isDoorsLocked ? ' [LOCKED]' : ''}
                  </button>
                );
              })}
            {/* Secret room exit */}
            {secretRoomFound && gameState.atSecretEntrance && (
              <button
                className="term-btn text-lg text-[var(--cyan)]"
                onClick={handleEnterSecretRoom}
              >
                {'> '}??? Room 404
              </button>
            )}
          </div>

          {/* Emergency meeting with cooldown (1 per game) */}
          <div className="mb-4">
            {gameState.cooldowns?.meetingUsed ? (
              <p className="text-[var(--dim)] text-lg">MEETING [used]</p>
            ) : meetingCooldownLeft > 0 ? (
              <p className="text-[var(--dim)] text-lg">MEETING [{meetingCooldownLeft}s]</p>
            ) : (
              <button
                className="term-btn term-btn-amber text-lg"
                onClick={handleCallMeeting}
              >
                {'> '}Call emergency meeting
              </button>
            )}
          </div>
        </>
      ) : (
        /* ── GHOST MODE (dead player) ─────────── */
        <div className="mt-4">
          <p className="text-[var(--dim)] text-lg mb-4">You drift through the halls, unseen by the living.</p>

          {/* Ghost tasks — can still complete tasks to help team */}
          {currentPlayer.role === 'innocent' && myTasksHere.length > 0 && (
            <div className="mb-4">
              <p className="text-[var(--dim)] text-lg">GHOST TASKS HERE:</p>
              {myTasksHere.map(task => (
                <button
                  key={task.id}
                  className="term-btn text-lg text-[var(--dim)]"
                  onClick={() => handleCompleteTask(task.id)}
                >
                  {'> '}{task.title}
                </button>
              ))}
            </div>
          )}

          {/* Ghost exits — instant movement, no narrative */}
          <div className="mb-4">
            <p className="text-[var(--dim)] text-lg">DRIFT TO:</p>
            {currentLocation?.connectedTo
              .filter(locId => locId !== 'secret')
              .map(locId => {
                const loc = gameState.locations.find(l => l.id === locId);
                return (
                  <button
                    key={locId}
                    className="term-btn text-lg text-[var(--dim)]"
                    onClick={() => handleGhostMove(locId)}
                  >
                    {'> '}{loc?.name}
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* Idle flavor text */}
      {flavorLines.length > 0 && (
        <div className="mt-4">
          {flavorLines.map((line, i) => {
            const isGrue = line.includes('grue') || line.includes('getting dark') || line.includes('flee in terror');
            return (
              <p key={i} className={`text-base italic ${isGrue ? 'text-[var(--amber)] glow-amber' : 'text-[var(--dim)]'}`}>{line}</p>
            );
          })}
        </div>
      )}

      {/* Cursor */}
      <p className="mt-4">
        <span className="text-[var(--dim)]">{'> '}</span>
        <span className="cursor-blink">&#9612;</span>
      </p>
    </div>
  );
}
