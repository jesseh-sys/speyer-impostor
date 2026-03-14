'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import usePartySocket from 'partysocket/react';
import { GameState, Location, MiniGameType } from '@/types/game';
import { HackTerminal, DefragDrive, DecodeSignal, CrackPassword } from '../components/MiniGames';
import { audio } from '../lib/audio';
import { haptics } from '../lib/haptics';
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

// ── Mini-map layout with connection lines ──────────────────

const ROOM_ABBRS: Record<string, string> = {
  lobby: 'CLS', speyer: 'LOB', boulevard: 'BLV',
  suib: 'SUI', meyers: 'MEY', cvs: 'CVS',
  mj: 'M.J', cafeteria: 'CAF', terrace: 'TER',
  deard: 'DEA', music: 'MUS',
};

type MapEl = string | { id: string };
const MAP_LINES: MapEl[][] = [
  [{ id: 'lobby' }, '\u2500', { id: 'speyer' }, '\u2500', { id: 'boulevard' }],
  [' \u2502    \u2502    \u2502  '],
  [{ id: 'suib' }, '\u2500', { id: 'meyers' }, ' ', { id: 'cvs' }],
  [' \u2502         \u2502  '],
  [{ id: 'mj' }, ' ', { id: 'cafeteria' }, '\u2500', { id: 'terrace' }],
  [' \u2502    \u2502       '],
  [{ id: 'deard' }, '\u2500', { id: 'music' }, '       '],
  ['LOB also \u2192 CAF'],
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

// ── DECLASSIFIED Log + Awards (post-game reveal) ──────────

function DeclassifiedLog({ gameState }: { gameState: GameState }) {
  const [revealedCount, setRevealedCount] = useState(0);
  const [showAwards, setShowAwards] = useState(false);
  const logEntries = gameState.eventLog || [];
  const awards = gameState.awards || [];
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRevealedCount(0);
    setShowAwards(false);

    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < logEntries.length; i++) {
      timers.push(setTimeout(() => {
        setRevealedCount(i + 1);
      }, 400 + i * 400));
    }
    // Show awards after all log entries
    if (awards.length > 0) {
      timers.push(setTimeout(() => {
        setShowAwards(true);
      }, 400 + logEntries.length * 400 + 600));
    }

    return () => timers.forEach(t => clearTimeout(t));
  }, [logEntries.length, awards.length]);

  // Auto-scroll as entries reveal
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [revealedCount, showAwards]);

  const getEventColor = (event: string): string => {
    if (event.includes('eliminated')) return 'var(--red)';
    if (event.includes('reported') || event.includes('meeting') || event.includes('ejected') || event.includes('No one was ejected')) return 'var(--cyan)';
    if (event.includes('WIN')) return event.includes('INNOCENTS') ? 'var(--green)' : event.includes('JESTER') ? 'var(--amber)' : 'var(--red)';
    if (event.includes('sabotage')) return 'var(--amber)';
    if (event.includes('shield blocked')) return 'var(--amber)';
    if (event.includes('disguised')) return 'var(--red)';
    if (event.includes('phantom glitch')) return '#ff00ff';
    return 'var(--dim)';
  };

  if (logEntries.length === 0) return null;

  return (
    <div className="mt-4">
      <div className="text-[var(--dim)]">{'═'.repeat(36)}</div>
      <p className="text-[var(--green)] glow-green text-lg tracking-widest">DECLASSIFIED</p>
      <p className="text-[var(--dim)] text-sm mb-2">TERMINAL LOG — AUTHORIZED EYES ONLY</p>

      <div ref={scrollRef} className="max-h-60 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--dim) transparent' }}>
        {logEntries.slice(0, revealedCount).map((entry, i) => (
          <p key={i} className="text-sm mb-0.5" style={{ color: getEventColor(entry.event), animation: 'fadeIn 0.3s ease-in' }}>
            <span className="text-[var(--dim)]">{entry.time}  </span>
            {entry.event}
          </p>
        ))}
        {revealedCount < logEntries.length && (
          <span className="cursor-blink text-base">&#9612;</span>
        )}
      </div>
      <div className="text-[var(--dim)]">{'═'.repeat(36)}</div>

      {showAwards && awards.length > 0 && (
        <div className="mt-3" style={{ animation: 'fadeIn 0.5s ease-in' }}>
          <div className="text-[var(--dim)]">{'═'.repeat(36)}</div>
          <p className="text-[var(--amber)] text-lg tracking-widest" style={{ textShadow: '0 0 8px var(--amber)' }}>AWARDS</p>
          <div className="text-[var(--dim)]">{'═'.repeat(36)}</div>

          <div className="mt-2 space-y-3">
            {awards.map((award, i) => (
              <div key={i}>
                <p className="text-base">
                  <span className="text-[var(--amber)]" style={{ textShadow: '0 0 6px var(--amber)' }}>{'\u2605'} {award.title}</span>
                  <span className="text-[var(--dim)]"> — </span>
                  <span style={{ color: award.playerColor }}>{award.playerName}</span>
                </p>
                <p className="text-[var(--dim)] text-sm ml-4">{'"'}{award.description}{'"'}</p>
              </div>
            ))}
          </div>

          <div className="text-[var(--dim)] mt-2">{'═'.repeat(36)}</div>
        </div>
      )}
    </div>
  );
}

// ── Vote Reveal Screen (dramatic vote-by-vote animation) ──────────

function VoteRevealScreen({ gameState, gameClockSeconds, divider }: {
  gameState: GameState;
  gameClockSeconds: number;
  divider: () => React.ReactElement;
}) {
  const data = gameState.voteRevealData!;
  const [revealedCount, setRevealedCount] = useState(0);
  const [showVerdict, setShowVerdict] = useState(false);
  const totalVotes = data.votes.length;

  useEffect(() => {
    // Reset when entering this phase
    setRevealedCount(0);
    setShowVerdict(false);

    // Reveal votes one at a time with 600ms delay
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < totalVotes; i++) {
      timers.push(setTimeout(() => {
        setRevealedCount(i + 1);
        audio.voteReveal();
      }, 800 + i * 600));
    }
    // Show verdict after all votes revealed + a dramatic pause
    timers.push(setTimeout(() => {
      setShowVerdict(true);
      audio.verdict();
      haptics.heavy();
    }, 800 + totalVotes * 600 + 1000));

    return () => timers.forEach(t => clearTimeout(t));
  }, [totalVotes]);

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <div className="min-h-screen p-4 max-w-lg mx-auto">
      <div className="mt-4">
        {gameClockSeconds > 0 && (
          <p className="text-[var(--green)] text-sm text-right opacity-60">Game: [{formatTime(gameClockSeconds)}]</p>
        )}
        {divider()}
        <p className="text-[var(--green)] glow-green text-center text-xl tracking-widest">PROCESSING VOTES...</p>
        <p className="text-[var(--dim)] text-center text-base mt-1">DECRYPTING BALLOTS...</p>
        {divider()}

        <div className="mt-4 space-y-1">
          {data.votes.slice(0, revealedCount).map((vote, i) => (
            <p key={i} className="text-base" style={{ animation: 'fadeIn 0.3s ease-in' }}>
              <span className="text-[var(--dim)]">{'> '}</span>
              {vote.isGhost && <span className="text-[var(--dim)]">[GHOST] </span>}
              <span className="text-[var(--green)]">{vote.voterName}</span>
              <span className="text-[var(--dim)]"> voted for </span>
              {vote.votedForId === 'skip' ? (
                <span className="text-[var(--amber)]">SKIP</span>
              ) : (
                <span style={{ color: gameState.players[vote.votedForId]?.color || 'var(--green)' }}>
                  {vote.votedForName}
                </span>
              )}
            </p>
          ))}
        </div>

        {showVerdict && (
          <div className="mt-6">
            {divider()}
            {data.noEjection ? (
              <p className="text-[var(--dim)] text-center text-lg tracking-wider">
                NO CONSENSUS REACHED. THE DARKNESS PERSISTS.
              </p>
            ) : data.ejectedSpecialRole === 'jester' ? (
              <p className="text-[var(--amber)] text-center text-lg tracking-wider" style={{ textShadow: '0 0 10px var(--amber)' }}>
                {data.ejectedName} WAS THE JESTER. YOU{"'"}VE BEEN FOOLED.
              </p>
            ) : data.ejectedRole === 'impostor' ? (
              <p className="text-[var(--green)] glow-green text-center text-lg tracking-wider">
                {data.ejectedName} WAS THE IMPOSTOR. SYSTEM INTEGRITY RESTORED.
              </p>
            ) : (
              <p className="text-[var(--red)] glow-red text-center text-lg tracking-wider">
                WRONGFUL TERMINATION. {data.ejectedName} WAS NOT THE IMPOSTOR.
              </p>
            )}
          </div>
        )}

        {!showVerdict && (
          <span className="cursor-blink text-xl mt-4 inline-block">&#9612;</span>
        )}
      </div>
    </div>
  );
}

export default function Game() {
  const params = useParams();
  const router = useRouter();
  const roomCode = params.roomCode as string;
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerId, setPlayerId] = useState('');
  const [chatMessage, setChatMessage] = useState('');
  const [ghostChatMessage, setGhostChatMessage] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const ghostChatEndRef = useRef<HTMLDivElement>(null);

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

  // Sabotage panel
  const [showSabotagePanel, setShowSabotagePanel] = useState(false);

  // Sheriff investigate result overlay
  const [investigateResult, setInvestigateResult] = useState<{ targetName: string; isImpostor: boolean } | null>(null);

  // Phantom reveal overlay
  const [phantomReveal, setPhantomReveal] = useState<{ killerName: string; killerColor: string } | null>(null);

  // Survivor shield used notification
  const [survivorShieldMsg, setSurvivorShieldMsg] = useState<string | null>(null);

  // Shapeshifter target picker
  const [showShapeshiftPicker, setShowShapeshiftPicker] = useState(false);

  // Mini-game state
  const [activeMiniGame, setActiveMiniGame] = useState<{ type: MiniGameType; taskId: string } | null>(null);

  // Fake tasks for impostors (client-side completion tracking)
  const [completedFakeTasks, setCompletedFakeTasks] = useState<Set<string>>(new Set());

  // Powerup countdown tick (forces re-render for live timer)
  const [, setTick] = useState(0);

  // Track player death for sound
  const prevStatusRef = useRef<string | undefined>(undefined);

  // Role reveal overlay
  const [showRoleReveal, setShowRoleReveal] = useState(false);
  const roleRevealShownRef = useRef(false);

  // Mini-map toggle
  const [showMap, setShowMap] = useState(false);

  // Task completion banner
  const [taskCompleteBanner, setTaskCompleteBanner] = useState(false);
  const prevTaskCountRef = useRef<number | null>(null);

  // Track if player has been in a game this session (for redirect logic)
  const hasPlayedRef = useRef(false);

  // Restart countdown timer
  const [restartCountdown, setRestartCountdown] = useState(0);

  // Audio toggle
  const [audioOn, setAudioOn] = useState(false);
  const [showAudioPrompt, setShowAudioPrompt] = useState(false);

  // Session stats
  interface SessionStats {
    gamesPlayed: number;
    wins: number;
    losses: number;
    kills: number;
    tasksCompleted: number;
    timesImpostor: number;
    timesEjected: number;
    currentStreak: number;
  }
  const [sessionStats, setSessionStats] = useState<SessionStats>(() => {
    if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem(`sessionStats-${roomCode}`);
      if (stored) {
        try { return JSON.parse(stored); } catch { /* ignore */ }
      }
    }
    return { gamesPlayed: 0, wins: 0, losses: 0, kills: 0, tasksCompleted: 0, timesImpostor: 0, timesEjected: 0, currentStreak: 0 };
  });
  const sessionStatsUpdatedRef = useRef(false);

  // Audio initialization
  useEffect(() => {
    audio.loadPreference();
    const isOn = audio.isEnabled();
    setAudioOn(isOn);
    if (!audio.hasPreference()) {
      setShowAudioPrompt(true);
      const t = setTimeout(() => setShowAudioPrompt(false), 3000);
      return () => clearTimeout(t);
    }
  }, []);

  const toggleAudio = useCallback(() => {
    if (audio.isEnabled()) {
      audio.disable();
      setAudioOn(false);
    } else {
      audio.enable();
      setAudioOn(true);
    }
    setShowAudioPrompt(false);
    haptics.light();
  }, []);

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
      if (msg.type === 'investigateResult') {
        setInvestigateResult({ targetName: msg.data.targetName, isImpostor: msg.data.isImpostor });
        setTimeout(() => setInvestigateResult(null), 3000);
      }
      if (msg.type === 'phantomReveal') {
        setPhantomReveal({ killerName: msg.data.killerName, killerColor: msg.data.killerColor });
        setTimeout(() => setPhantomReveal(null), 5000);
      }
      if (msg.type === 'survivorShieldUsed') {
        const remaining = msg.data?.shieldsRemaining ?? 0;
        setSurvivorShieldMsg(`SHIELD ABSORBED — ${remaining} REMAINING`);
        setTimeout(() => setSurvivorShieldMsg(null), 3000);
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
    const interval = setInterval(() => {
      update();
      // Timer tick for last 10 seconds
      if (gameState?.timer) {
        const elapsed = Math.floor((Date.now() - gameState.timer.startTime) / 1000);
        const remaining = Math.max(0, gameState.timer.duration - elapsed);
        if (remaining > 0 && remaining <= 10) {
          audio.timerTick();
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [gameState?.timer?.startTime, gameState?.timer?.duration]);

  // ── Redirect to lobby (only if player hasn't been in a game) ─────────────
  useEffect(() => {
    if (gameState?.phase === 'lobby' && !hasPlayedRef.current) {
      router.push(`/lobby/${roomCode}`);
    }
  }, [gameState?.phase]);

  // Mark as "has played" when game starts + game start sound
  useEffect(() => {
    if (gameState?.phase === 'playing') {
      hasPlayedRef.current = true;
      audio.gameStart();
    }
  }, [gameState?.phase]);

  // ── Auto-dismiss narrative + kill state on phase change ────
  // If a meeting/vote/results/gameOver starts while player is in a narrative,
  // dismiss it immediately so they can participate
  useEffect(() => {
    if (gameState?.phase === 'meeting') {
      audio.meetingAlarm();
      haptics.alarm();
    }
    if (gameState?.phase === 'voteReveal') {
      // Sound handled per-vote in VoteRevealScreen
    }
    if (gameState?.phase && gameState.phase !== 'playing') {
      // Clear pending kill state so "Kill failed" doesn't show during meetings
      pendingKillRef.current = null;
      setKillPending(false);
      setShieldBlockMsg(null);
      setActiveMiniGame(null);

      if (narrative) {
        if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
        pendingNarrativeActionRef.current = null;
        setNarrative(null);
        setResultText(null);
        setShowChoices(false);
      }
    }
  }, [gameState?.phase]);

  // ── Auto-scroll chat ─────────────────────────

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [gameState?.chat?.length]);

  useEffect(() => {
    ghostChatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [gameState?.ghostChat?.length]);

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
          }, 400);
        }, 100);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setShowChoices(true), 200);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setRevealedLines(r => r + 1);
      audio.keyClick();
    }, 200);
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
    const hasCooldown = gameState?.cooldowns?.kill || gameState?.cooldowns?.sabotage || gameState?.cooldowns?.meeting || gameState?.cooldowns?.investigate || gameState?.cooldowns?.shapeshift;
    if (!hasPowerup && !hasCooldown) return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [gameState?.players?.[playerId]?.powerup?.until, gameState?.cooldowns?.kill, gameState?.cooldowns?.sabotage, gameState?.cooldowns?.meeting, gameState?.cooldowns?.investigate, gameState?.cooldowns?.shapeshift]);

  // ── Derived values ────────────────────────────
  const currentPlayer = gameState ? gameState.players[playerId] : null;
  const currentLocation = gameState?.locations.find(l => l.id === currentPlayer?.location);

  // Keep refs fresh for use in setTimeout closures
  playerLocationRef.current = currentPlayer?.location;

  // ── Restart countdown on game over ─────────────────
  useEffect(() => {
    if (gameState?.phase === 'gameOver' && gameState.restartCountdown) {
      const update = () => {
        const remaining = Math.max(0, Math.ceil((gameState.restartCountdown!.until - Date.now()) / 1000));
        setRestartCountdown(prev => {
          if (remaining !== prev && remaining > 0 && remaining <= 10) {
            audio.countdown();
          }
          return remaining;
        });
      };
      update();
      const interval = setInterval(update, 1000);
      return () => clearInterval(interval);
    }
  }, [gameState?.phase, gameState?.restartCountdown?.until]);

  // ── Game over sounds ─────────────────
  useEffect(() => {
    if (gameState?.phase === 'gameOver') {
      if (gameState.winner === 'jester') {
        audio.jesterReveal();
      } else {
        audio.verdict();
        haptics.heavy();
      }
    }
  }, [gameState?.phase, gameState?.winner]);

  // ── Session stats update on game over ─────────────────
  useEffect(() => {
    if (gameState?.phase === 'gameOver' && !sessionStatsUpdatedRef.current && playerId) {
      sessionStatsUpdatedRef.current = true;
      const player = gameState.players[playerId];
      if (!player) return;

      // Count kills from event log
      const myKills = (gameState.eventLog || []).filter(e =>
        e.event.startsWith(player.name + ' eliminated')
      ).length;

      // Was I ejected?
      const wasEjected = player.status === 'dead' && (gameState.eventLog || []).some(e =>
        e.event.includes(player.name + ' was ejected')
      );

      // Did I win?
      const isImpostor = player.role === 'impostor';
      const isJester = player.specialRole === 'jester';
      let won = false;
      if (isJester) {
        won = gameState.winner === 'jester';
      } else if (isImpostor) {
        won = gameState.winner === 'impostors';
      } else {
        won = gameState.winner === 'innocents';
      }
      // Survivor wins if alive at end
      if (player.specialRole === 'survivor' && player.status === 'alive') {
        won = true;
      }

      setSessionStats(prev => {
        const updated = {
          gamesPlayed: prev.gamesPlayed + 1,
          wins: prev.wins + (won ? 1 : 0),
          losses: prev.losses + (won ? 0 : 1),
          kills: prev.kills + myKills,
          tasksCompleted: prev.tasksCompleted + player.tasksCompleted,
          timesImpostor: prev.timesImpostor + (isImpostor ? 1 : 0),
          timesEjected: prev.timesEjected + (wasEjected ? 1 : 0),
          currentStreak: won ? prev.currentStreak + 1 : 0,
        };
        sessionStorage.setItem(`sessionStats-${roomCode}`, JSON.stringify(updated));
        return updated;
      });
    }
    if (gameState?.phase !== 'gameOver') {
      sessionStatsUpdatedRef.current = false;
    }
  }, [gameState?.phase, playerId]);

  // ── Role reveal overlay ────────────────────────
  useEffect(() => {
    if (gameState?.phase === 'playing' && gameState.timer && !roleRevealShownRef.current) {
      const elapsed = Date.now() - gameState.timer.startTime;
      if (elapsed < 10000) {
        roleRevealShownRef.current = true;
        setShowRoleReveal(true);
        const isImp = currentPlayer?.role === 'impostor';
        audio.roleReveal(isImp || currentPlayer?.specialRole === 'jester');
        setTimeout(() => setShowRoleReveal(false), 4000);
      }
    }
  }, [gameState?.phase, gameState?.timer?.startTime]);

  // Reset role reveal flag on preGame so it shows again next round
  useEffect(() => {
    if (gameState?.phase === 'preGame') {
      roleRevealShownRef.current = false;
      setSecretRoomFound(false);
      setCompletedFakeTasks(new Set());
      setActiveMiniGame(null);
    }
  }, [gameState?.phase]);

  // ── Task completion banner ─────────────────────
  useEffect(() => {
    const count = currentPlayer?.tasksCompleted ?? 0;
    if (prevTaskCountRef.current !== null && count > prevTaskCountRef.current) {
      setTaskCompleteBanner(true);
      audio.taskComplete();
      haptics.success();
      setTimeout(() => setTaskCompleteBanner(false), 2000);
    }
    prevTaskCountRef.current = count;
  }, [currentPlayer?.tasksCompleted]);

  // ── Player death detection (sound + haptics) ──────────
  useEffect(() => {
    const status = currentPlayer?.status;
    if (prevStatusRef.current === 'alive' && status === 'dead') {
      audio.killed();
      haptics.death();
      audio.ghostAmbient();
    }
    prevStatusRef.current = status;
  }, [currentPlayer?.status]);

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
    }, 600);
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
    haptics.light();
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
    audio.kill();
    haptics.double();
    socket.send(JSON.stringify({ type: 'kill', playerId, data: { victimId } }));
    // Show kill narrative as flavor
    const victim = gameState?.players[victimId];
    const template = getKillNarrative(victim?.name || 'them');
    startNarrative(template, () => {}, () => {}, true);
  };

  const handleCompleteTask = (taskId: string) => {
    const task = gameState?.tasks.find(t => t.id === taskId);
    if (!task) return;
    const isFake = !!task.isFake;
    const isMiniGame = task.type === 'mini-game' && !!task.miniGameType;

    const template = getTaskNarrative(task.title || 'Task', task.description || '');

    if (isMiniGame) {
      // Narrative first, then mini-game on choice A
      startNarrative(
        template,
        () => {
          // After narrative choice A, show the mini-game
          setActiveMiniGame({ type: task.miniGameType!, taskId });
        },
        () => {}, // Choice B: walk away (no-op)
        false,
      );
    } else if (isFake) {
      // Fake quick task: show narrative, mark as completed client-side
      startNarrative(template, () => {
        setCompletedFakeTasks(prev => new Set(prev).add(taskId));
      }, () => {}, true);
    } else {
      // Real quick task: send to server immediately, show narrative as flavor
      socket.send(JSON.stringify({ type: 'completeTask', playerId, data: { taskId } }));
      startNarrative(template, () => {}, () => {}, true);
    }
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

  const handleSendGhostChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ghostChatMessage.trim()) return;

    socket.send(JSON.stringify({ type: 'chat', playerId, data: { message: ghostChatMessage } }));
    setGhostChatMessage('');
  };

  const handleVote = (votedForId: string) => {
    haptics.medium();
    audio.keyClick();
    socket.send(JSON.stringify({ type: 'vote', playerId, data: { votedForId } }));
  };

  const divider = () => <div className="text-[var(--dim)] my-3">{'═'.repeat(30)}</div>;

  // ── Loading states ────────────────────────────

  if (!gameState) {
    return (
      <div className="min-h-screen p-4 max-w-lg mx-auto mt-4">
        <p className="text-xl glow">LOADING GAME DATA...</p>
        <span className="cursor-blink text-xl">&#9612;</span>
      </div>
    );
  }

  if (!currentPlayer) {
    return (
      <div className="min-h-screen p-4 max-w-lg mx-auto mt-4">
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
        {currentPlayer.specialRole === 'jester' ? (
          <>
            <pre className="text-[var(--amber)] text-xs leading-tight font-mono" style={{ textShadow: '0 0 10px var(--amber)' }}>{`
     ██╗███████╗███████╗████████╗
     ██║██╔════╝██╔════╝╚══██╔══╝
     ██║█████╗  ███████╗   ██║
██   ██║██╔══╝  ╚════██║   ██║
╚█████╔╝███████╗███████║   ██║
 ╚════╝ ╚══════╝╚══════╝   ╚═╝
            `.trim()}</pre>
            <p className="text-[var(--amber)] text-2xl tracking-widest mt-3" style={{ textShadow: '0 0 10px var(--amber)' }}>
              YOU ARE THE JESTER
            </p>
            <p className="text-[var(--dim)] mt-3">Get yourself voted out to win.</p>
            <p className="text-[var(--dim)] mt-1">Trust no one — not even the truth.</p>
          </>
        ) : currentPlayer.specialRole === 'sheriff' ? (
          <>
            <pre className="text-[var(--cyan)] text-xs leading-tight font-mono" style={{ textShadow: '0 0 10px var(--cyan)' }}>{`
███████╗██╗  ██╗██████╗ ██╗███████╗
██╔════╝██║  ██║██╔══██╗██║██╔════╝
███████╗███████║██████╔╝██║█████╗
╚════██║██╔══██║██╔══██╗██║██╔══╝
███████║██║  ██║██║  ██║██║██║
╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝
            `.trim()}</pre>
            <p className="text-[var(--cyan)] text-2xl tracking-widest mt-3" style={{ textShadow: '0 0 10px var(--cyan)' }}>
              YOU ARE THE SHERIFF
            </p>
            <p className="text-[var(--dim)] mt-3">Investigate players to detect impostors.</p>
            <p className="text-[var(--dim)] mt-1">Stay in the same room to scan.</p>
          </>
        ) : currentPlayer.specialRole === 'phantom' ? (
          <>
            <pre className="text-[var(--magenta,#ff00ff)] text-xs leading-tight font-mono" style={{ textShadow: '0 0 10px #ff00ff', color: '#ff00ff' }}>{`
██████╗ ██╗  ██╗████████╗███╗   ███╗
██╔══██╗██║  ██║╚══██╔══╝████╗ ████║
██████╔╝███████║   ██║   ██╔████╔██║
██╔═══╝ ██╔══██║   ██║   ██║╚██╔╝██║
██║     ██║  ██║   ██║   ██║ ╚═╝ ██║
╚═╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝
            `.trim()}</pre>
            <p className="text-2xl tracking-widest mt-3" style={{ textShadow: '0 0 10px #ff00ff', color: '#ff00ff' }}>
              YOU ARE THE PHANTOM
            </p>
            <p className="text-[var(--dim)] mt-3">If killed, your ghost lingers briefly.</p>
            <p className="text-[var(--dim)] mt-1">If reported, your killer is exposed.</p>
          </>
        ) : currentPlayer.specialRole === 'survivor' ? (
          <>
            <pre className="text-[var(--amber)] text-xs leading-tight font-mono" style={{ textShadow: '0 0 10px var(--amber)' }}>{`
███████╗██╗   ██╗██████╗ ██╗   ██╗
██╔════╝██║   ██║██╔══██╗██║   ██║
███████╗██║   ██║██████╔╝██║   ██║
╚════██║██║   ██║██╔══██╗╚██╗ ██╔╝
███████║╚██████╔╝██║  ██║ ╚████╔╝
╚══════╝ ╚═════╝ ╚═╝  ╚═╝  ╚═══╝
            `.trim()}</pre>
            <p className="text-[var(--amber)] text-2xl tracking-widest mt-3" style={{ textShadow: '0 0 10px var(--amber)' }}>
              YOU ARE THE SURVIVOR
            </p>
            <p className="text-[var(--dim)] mt-3">Stay alive until the end. You have 2 shields.</p>
            <p className="text-[var(--dim)] mt-1">You win with whoever wins — as long as you{"'"}re breathing.</p>
          </>
        ) : currentPlayer.specialRole === 'shapeshifter' ? (
          <>
            <pre className="text-[var(--red)] text-xs leading-tight font-mono" style={{ textShadow: '0 0 10px var(--red)' }}>{`
███████╗██╗  ██╗██████╗ ████████╗
██╔════╝██║  ██║██╔══██╗╚══██╔══╝
███████╗███████║██████╔╝   ██║
╚════██║██╔══██║██╔═══╝    ██║
███████║██║  ██║██║        ██║
╚══════╝╚═╝  ╚═╝╚═╝        ╚═╝
            `.trim()}</pre>
            <p className="text-[var(--red)] glow-red text-2xl tracking-widest mt-3">
              YOU ARE THE SHAPESHIFTER
            </p>
            <p className="text-[var(--dim)] mt-3">Disguise yourself as other players.</p>
            <p className="text-[var(--dim)] mt-1">Frame the innocent.</p>
          </>
        ) : currentPlayer.role === 'impostor' ? (
          <>
            <p className="text-[var(--red)] glow-red text-4xl tracking-widest">
              IMPOSTOR
            </p>
            <p className="text-[var(--dim)] mt-3">Kill. Sabotage. Survive.</p>
            <p className="text-[var(--dim)] mt-1">You are not alone.</p>
          </>
        ) : (
          <>
            <p className="text-[var(--green)] glow-green text-4xl tracking-widest">
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
    <div className="fixed top-0 left-0 right-0 z-30 text-center py-3" style={{ background: 'rgba(51, 255, 102, 0.15)' }}>
      <p className="text-[var(--green)] glow-green text-xl tracking-widest">TASK COMPLETE</p>
    </div>
  );

  // ── MINI-GAME SCREEN ──────────────────────────

  if (activeMiniGame) {
    const miniGameTask = gameState?.tasks.find(t => t.id === activeMiniGame.taskId);
    const isFakeTask = !!miniGameTask?.isFake;

    const handleMiniGameComplete = () => {
      if (isFakeTask) {
        // Impostor: mark fake task as completed client-side
        setCompletedFakeTasks(prev => new Set(prev).add(activeMiniGame.taskId));
      } else {
        // Innocent: send real completion to server
        socket.send(JSON.stringify({ type: 'completeTask', playerId, data: { taskId: activeMiniGame.taskId } }));
      }
      setActiveMiniGame(null);
    };

    const handleMiniGameCancel = () => {
      setActiveMiniGame(null);
    };

    const miniGameProps = { onComplete: handleMiniGameComplete, onCancel: handleMiniGameCancel };

    return (
      <>
        {roleRevealOverlay}
        {taskBanner}
        {activeMiniGame.type === 'hack' && <HackTerminal {...miniGameProps} />}
        {activeMiniGame.type === 'defrag' && <DefragDrive {...miniGameProps} />}
        {activeMiniGame.type === 'decode' && <DecodeSignal {...miniGameProps} />}
        {activeMiniGame.type === 'password' && <CrackPassword {...miniGameProps} />}
      </>
    );
  }

  // ── NARRATIVE SCREEN ──────────────────────────

  if (narrative) {
    return (
      <div className="min-h-screen p-4 max-w-lg mx-auto flex flex-col justify-center" onClick={handleNarrativeSkip}>

        {roleRevealOverlay}
        {taskBanner}
        {/* Game clock during narrative */}
        {gameClockSeconds > 0 && (
          <p className="text-[var(--green)] text-sm text-right mb-4 opacity-60">[{formatTime(gameClockSeconds)}]</p>
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
    const jesterPlayer = allPlayers.find(p => p.specialRole === 'jester');
    const specialRoleLabel = (p: typeof allPlayers[0]) => {
      if (p.specialRole === 'jester') return 'JESTER';
      if (p.specialRole === 'sheriff') return 'SHERIFF';
      if (p.specialRole === 'phantom') return 'PHANTOM';
      if (p.specialRole === 'shapeshifter') return 'SHAPESHIFTER';
      if (p.specialRole === 'survivor') return 'SURVIVOR';
      return null;
    };
    const specialRoleColor = (p: typeof allPlayers[0]) => {
      if (p.specialRole === 'jester') return 'var(--amber)';
      if (p.specialRole === 'sheriff') return 'var(--cyan)';
      if (p.specialRole === 'phantom') return '#ff00ff';
      if (p.specialRole === 'shapeshifter') return 'var(--red)';
      if (p.specialRole === 'survivor') return 'var(--amber)';
      return null;
    };
    return (
      <div className="min-h-screen p-4 max-w-lg mx-auto">
        <button onClick={toggleAudio} className="fixed top-2 right-2 z-50 text-[var(--dim)] text-xs px-2 py-1 border border-[var(--dim)] bg-black opacity-60 hover:opacity-100">{audioOn ? '\u266A ON' : '\u266A OFF'}</button>

        <div className="mt-4">
          {divider()}
          {gameState.winner === 'jester' ? (
            <div className="text-center">
              <p className="text-[var(--amber)] text-2xl tracking-widest" style={{ textShadow: '0 0 15px var(--amber)' }}>
                THE JESTER WINS
              </p>
              {jesterPlayer && (
                <p className="text-[var(--amber)] text-lg mt-2" style={{ textShadow: '0 0 10px var(--amber)' }}>
                  {jesterPlayer.name} PLAYED YOU ALL.
                </p>
              )}
            </div>
          ) : gameState.winner === 'innocents' ? (
            <div className="text-center">
              <p className="text-[var(--green)] glow-green text-2xl tracking-widest">INNOCENTS WIN</p>
              <p className="text-[var(--dim)] text-sm">The impostor has been stopped. The school is safe. For now.</p>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-[var(--red)] glow-red text-2xl tracking-widest">GAME OVER</p>
              <p className="text-[var(--dim)] text-sm">The impostors win. The school has fallen.</p>
            </div>
          )}
          {gameState.survivorWin && (
            <div className="text-center mt-2">
              <p className="text-[var(--amber)] text-lg" style={{ textShadow: '0 0 8px var(--amber)' }}>
                SURVIVOR {gameState.survivorWin.name} ALSO WINS — STAYED ALIVE
              </p>
            </div>
          )}
          {divider()}

          <p className="text-lg mt-3 mb-2">DECLASSIFIED — ROLES REVEALED:</p>
          {allPlayers.map(p => {
            const srLabel = specialRoleLabel(p);
            const srColor = specialRoleColor(p);
            return (
              <p key={p.id} className="text-lg mb-1">
                <span style={{ color: p.color }}>{p.name}</span>
                <span className="text-[var(--dim)]"> {'.'.repeat(Math.max(1, 20 - p.name.length))} </span>
                {srLabel ? (
                  <span style={{ color: srColor || undefined }}>{srLabel}</span>
                ) : (
                  <span className={p.role === 'impostor' ? 'text-[var(--red)]' : 'text-[var(--green)]'}>
                    {p.role === 'impostor' ? 'IMPOSTOR' : 'INNOCENT'}
                  </span>
                )}
                {p.status === 'dead' && <span className="text-[var(--dim)]"> (dead)</span>}
              </p>
            );
          })}

          <DeclassifiedLog gameState={gameState} />

          {/* Session Stats */}
          {sessionStats.gamesPlayed > 0 && (
            <div className="mt-4">
              <div className="text-[var(--dim)]">{'═'.repeat(36)}</div>
              <p className="text-[var(--green)] text-base tracking-widest">SESSION LOG</p>
              <p className="text-[var(--dim)] text-base">
                GAMES: {sessionStats.gamesPlayed}  |  W: {sessionStats.wins}  L: {sessionStats.losses}
                {sessionStats.currentStreak > 1 && `  |  STREAK: ${sessionStats.currentStreak}`}
              </p>
              <p className="text-[var(--dim)] text-base">
                KILLS: {sessionStats.kills}  |  TASKS: {sessionStats.tasksCompleted}
                {sessionStats.timesImpostor > 0 && `  |  IMPOSTOR: ${sessionStats.timesImpostor}x`}
              </p>
              <div className="text-[var(--dim)]">{'═'.repeat(36)}</div>
            </div>
          )}

          {/* Revenge text */}
          {(() => {
            const player = currentPlayer;
            const isImpostor = player.role === 'impostor';
            const isJester = player.specialRole === 'jester';
            const wasKilled = player.status === 'dead' && !isImpostor;
            const impostorWon = gameState.winner === 'impostors';
            const innocentsWon = gameState.winner === 'innocents';
            const jesterWon = gameState.winner === 'jester';

            let revengeText = '';
            if (isJester && jesterWon) {
              revengeText = 'THEY FELL FOR IT. BEAUTIFUL.';
            } else if (isJester && !jesterWon) {
              revengeText = "THEY DIDN'T TAKE THE BAIT. NEXT TIME.";
            } else if (isImpostor && impostorWon) {
              revengeText = 'THEY NEVER SUSPECTED A THING. CAN YOU DO IT AGAIN?';
            } else if (isImpostor && !impostorWon) {
              revengeText = 'YOUR COVER WAS BLOWN. TRY AGAIN?';
            } else if (wasKilled && impostorWon) {
              revengeText = 'THE IMPOSTOR STILL WALKS FREE. WILL YOU STOP THEM?';
            } else if (innocentsWon) {
              revengeText = 'YOU SURVIVED. BUT THE DARKNESS ALWAYS RETURNS.';
            } else {
              revengeText = 'THE DARKNESS ALWAYS RETURNS.';
            }

            return revengeText ? (
              <p className="text-[var(--dim)] italic text-base mt-3">{revengeText}</p>
            ) : null;
          })()}

          {/* Countdown & buttons */}
          <div className="mt-4 flex flex-col gap-2">
            <p className="text-[var(--green)] glow-green text-lg text-center tracking-widest">
              NEXT ROUND IN: {restartCountdown}s
            </p>
            {gameState.hostId === playerId && restartCountdown > 0 && (
              <button
                onClick={() => {
                  socket.send(JSON.stringify({ type: 'restartGame', playerId }));
                }}
                className="term-btn text-xl glow"
              >
                [START NOW]
              </button>
            )}
            <button onClick={() => window.location.href = '/'} className="term-btn text-xl text-[var(--dim)]">
              [LEAVE GAME]
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── PRE-GAME (dramatic role assignment sequence) ──────────

  if (gameState.phase === 'preGame') {
    const connectedCount = gameState.connectedCount || Object.keys(gameState.players).length;
    return (
      <div className="min-h-screen p-4 max-w-lg mx-auto flex flex-col justify-center">
        <div className="text-center">
          {divider()}
          <p className="text-[var(--green)] glow-green text-2xl tracking-widest" style={{ animation: 'fadeIn 0.5s ease-in' }}>
            REINITIALIZING SYSTEM...
          </p>
          <p className="text-[var(--dim)] text-lg mt-3" style={{ animation: 'fadeIn 1s ease-in' }}>
            SCANNING PLAYERS... {connectedCount} CONNECTED
          </p>
          <p className="text-[var(--green)] glow-green text-lg mt-3" style={{ animation: 'fadeIn 2s ease-in' }}>
            ASSIGNING ROLES...
          </p>
          {divider()}
          <span className="cursor-blink text-xl mt-4 inline-block">&#9612;</span>
        </div>
      </div>
    );
  }

  // ── LOBBY FALLBACK (when hasPlayed but dropped to lobby) ──────────

  if (gameState.phase === 'lobby' && hasPlayedRef.current) {
    return (
      <div className="min-h-screen p-4 max-w-lg mx-auto flex flex-col justify-center">
        <div className="text-center">
          {divider()}
          <p className="text-[var(--dim)] text-xl tracking-widest">
            WAITING FOR PLAYERS...
          </p>
          <p className="text-[var(--dim)] text-base mt-2">
            Not enough players to auto-restart. {Object.keys(gameState.players).length} connected.
          </p>
          {divider()}
          <div className="mt-4 flex flex-col gap-2">
            <button onClick={() => router.push(`/lobby/${roomCode}`)} className="term-btn text-xl">
              [GO TO LOBBY]
            </button>
            <button onClick={() => window.location.href = '/'} className="term-btn text-xl text-[var(--dim)]">
              [LEAVE GAME]
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── VOTE REVEAL (dramatic animation) ──────────────

  if (gameState.phase === 'voteReveal' && gameState.voteRevealData) {
    return <VoteRevealScreen gameState={gameState} gameClockSeconds={gameClockSeconds} divider={divider} />;
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

        <div className="mt-4">
          {/* Game clock */}
          {gameClockSeconds > 0 && (
            <p className="text-[var(--green)] text-sm text-right opacity-60">Game: [{formatTime(gameClockSeconds)}]</p>
          )}
          {divider()}
          <p className="text-[var(--green)] glow-green text-center text-xl tracking-widest">VOTE RESULT</p>
          {divider()}

          {ejection ? (
            ejection.specialRole === 'jester' ? (
              <p className="text-[var(--amber)] text-center text-lg mt-3 tracking-wider" style={{ textShadow: '0 0 10px var(--amber)' }}>
                {ejection.name} WAS THE JESTER. YOU{"'"}VE BEEN FOOLED.
              </p>
            ) : ejection.role === 'impostor' ? (
              <p className="text-[var(--green)] glow-green text-center text-lg mt-3 tracking-wider">
                {ejection.name} WAS THE IMPOSTOR. SYSTEM INTEGRITY RESTORED.
              </p>
            ) : (
              <p className="text-[var(--red)] glow-red text-center text-lg mt-3 tracking-wider">
                WRONGFUL TERMINATION. {ejection.name} WAS NOT THE IMPOSTOR.
              </p>
            )
          ) : (
            <p className="text-[var(--dim)] text-center text-lg mt-3 tracking-wider">
              NO CONSENSUS REACHED. THE DARKNESS PERSISTS.
            </p>
          )}

          {/* Vote breakdown */}
          {Object.keys(voteBreakdown).length > 0 && (
            <div className="mt-3">
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

          <p className="text-[var(--dim)] text-center mt-4">Returning to game...</p>
          <span className="cursor-blink text-xl">&#9612;</span>
        </div>
      </div>
    );
  }

  // ── VOTING (clean vote-only screen, no chat) ──

  if (gameState.phase === 'voting') {
    const alivePlayers = Object.values(gameState.players).filter(p => p.status === 'alive');
    const hasVoted = gameState.votes[playerId] !== undefined;
    const votesCast = Object.keys(gameState.votes).length;
    const totalVoters = alivePlayers.length;
    const commsJamDuringVoting = gameState.commsJam && Date.now() < gameState.commsJam.until;

    return (
      <div className={`min-h-screen p-4 max-w-lg mx-auto ${commsJamDuringVoting ? 'comms-static' : ''}`}>
        <button onClick={toggleAudio} className="fixed top-2 right-2 z-50 text-[var(--dim)] text-xs px-2 py-1 border border-[var(--dim)] bg-black opacity-60 hover:opacity-100">{audioOn ? '\u266A ON' : '\u266A OFF'}</button>

        {/* Comms Jam warning banner */}
        {commsJamDuringVoting && (
          <div className="fixed top-0 left-0 right-0 z-30 text-center py-2" style={{ background: 'rgba(255, 194, 51, 0.15)' }}>
            <p className="text-[var(--amber)] text-lg tracking-widest" style={{ textShadow: '0 0 10px var(--amber)', animation: 'blink 2s step-end infinite' }}>
              {'\u26A0'} COMMS JAMMED — TRANSMISSIONS CORRUPTED {'\u26A0'}
            </p>
          </div>
        )}

        <div className={`mt-4 ${commsJamDuringVoting ? 'pt-8' : ''}`}>
          {/* Game clock */}
          {gameClockSeconds > 0 && (
            <p className="text-[var(--green)] text-sm text-right opacity-60">Game: [{formatTime(gameClockSeconds)}]</p>
          )}
          {divider()}
          <p className="text-[var(--green)] glow-green text-center text-2xl tracking-widest">V O T E</p>
          <p className="text-[var(--green)] text-center glow-green">[{formatTime(timeLeft)}]</p>
          {/* Vote progress */}
          <p className="text-[var(--dim)] text-center text-base">Votes: {votesCast}/{totalVoters}</p>
          {divider()}

          {currentPlayer.status === 'dead' ? (
            gameState.ghostVoteAvailable ? (
              hasVoted ? (
                <div className="mt-4">
                  <p className="text-[var(--dim)]">GHOST VOTE CAST. Waiting for others... ({votesCast}/{totalVoters})</p>
                </div>
              ) : (
                <div className="mt-4">
                  <p className="text-[var(--red)] glow-red text-lg mb-1">GHOST VOTE</p>
                  <p className="text-[var(--dim)] text-base mb-3">You only get ONE. Choose wisely.</p>
                  {alivePlayers.filter(p => p.id !== playerId).map(p => (
                    <button
                      key={p.id}
                      onClick={() => handleVote(p.id)}
                      className="term-btn text-lg text-[var(--dim)]"
                    >
                      {'> '}
                      <span style={{ color: p.color }}>
                        {p.name}
                      </span>
                      {p.role === 'impostor' && <span className="text-[var(--red)]"> [IMP]</span>}
                    </button>
                  ))}
                  <button
                    onClick={() => handleVote('skip')}
                    className="term-btn text-lg text-[var(--dim)] mt-2 opacity-60"
                  >
                    {'> '}<span className="text-[var(--dim)]">SKIP VOTE</span>
                  </button>
                </div>
              )
            ) : (
              <p className="text-[var(--dim)] mt-4">GHOST VOTE EXPENDED</p>
            )
          ) : hasVoted ? (
            <div className="mt-4">
              <p className="text-[var(--dim)]">Vote cast. Waiting for others... ({votesCast}/{totalVoters})</p>
            </div>
          ) : (
            <div className="mt-4">
              <p className="text-[var(--green)] text-lg mb-3">Who is the impostor?</p>
              {/* Don't show self in vote targets */}
              {alivePlayers.filter(p => p.id !== playerId).map(p => (
                <button
                  key={p.id}
                  onClick={() => handleVote(p.id)}
                  className="term-btn text-lg"
                >
                  {'> '}
                  <span style={{ color: p.color }}>
                    {p.name}
                  </span>
                </button>
              ))}
              <button
                onClick={() => handleVote('skip')}
                className="term-btn text-lg text-[var(--dim)] mt-2 opacity-60"
              >
                {'> '}<span className="text-[var(--dim)]">SKIP VOTE</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── MEETING (with game clock) ──────────────────

  if (gameState.phase === 'meeting') {
    const commsJamDuringMeeting = gameState.commsJam && Date.now() < gameState.commsJam.until;
    return (
      <div className={`min-h-screen p-4 max-w-lg mx-auto flex flex-col ${commsJamDuringMeeting ? 'comms-static' : ''}`}>
        <button onClick={toggleAudio} className="fixed top-2 right-2 z-50 text-[var(--dim)] text-xs px-2 py-1 border border-[var(--dim)] bg-black opacity-60 hover:opacity-100">{audioOn ? '\u266A ON' : '\u266A OFF'}</button>

        {/* Comms Jam warning banner */}
        {commsJamDuringMeeting && (
          <div className="fixed top-0 left-0 right-0 z-30 text-center py-2" style={{ background: 'rgba(255, 194, 51, 0.15)' }}>
            <p className="text-[var(--amber)] text-lg tracking-widest" style={{ textShadow: '0 0 10px var(--amber)', animation: 'blink 2s step-end infinite' }}>
              {'\u26A0'} COMMS JAMMED — TRANSMISSIONS CORRUPTED {'\u26A0'}
            </p>
          </div>
        )}

        <div className={`mt-4 ${commsJamDuringMeeting ? 'pt-8' : ''}`}>
          {/* Game clock */}
          {gameClockSeconds > 0 && (
            <p className="text-[var(--green)] text-sm text-right opacity-60">Game: [{formatTime(gameClockSeconds)}]</p>
          )}
          {divider()}
          {gameState.deadBodies?.some(b => b.reportedBy) ? (
            <p className="text-[var(--red)] glow-red text-center text-2xl tracking-widest">BODY REPORTED</p>
          ) : (
            <p className="text-[var(--green)] glow-green text-center text-2xl tracking-widest">EMERGENCY MEETING</p>
          )}
          <p className="text-[var(--green)] text-center">[{formatTime(timeLeft)}]</p>

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

        <div className="flex-1 overflow-y-auto my-2 min-h-[120px] max-h-[40vh]">
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
            {/* Player accusation buttons — tap a name then SUS or SAFE */}
            <div className="mb-2">
              <div className="flex flex-wrap gap-1 mb-1">
                {Object.values(gameState.players)
                  .filter(p => p.status === 'alive' && p.id !== playerId)
                  .map(p => (
                    <span key={p.id} className="inline-flex gap-0.5">
                      <button
                        className="text-xs px-2 py-1 border border-[var(--red)] text-[var(--red)] bg-transparent"
                        onClick={() => socket.send(JSON.stringify({ type: 'chat', playerId, data: { message: `${p.name} is sus` } }))}
                      >
                        {p.name} SUS
                      </button>
                      <button
                        className="text-xs px-2 py-1 border border-[var(--green)] text-[var(--green)] bg-transparent"
                        onClick={() => socket.send(JSON.stringify({ type: 'chat', playerId, data: { message: `${p.name} is safe` } }))}
                      >
                        SAFE
                      </button>
                    </span>
                  ))}
              </div>
              {/* Quick phrases */}
              <div className="flex flex-wrap gap-1">
                {['I saw a body', 'I was doing tasks', 'Where was everyone?', 'Self-report?'].map(phrase => (
                  <button
                    key={phrase}
                    className="text-xs px-2 py-1 border border-[var(--dim)] text-[var(--dim)] bg-transparent"
                    onClick={() => socket.send(JSON.stringify({ type: 'chat', playerId, data: { message: phrase } }))}
                  >
                    {phrase}
                  </button>
                ))}
              </div>
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
          <div className="pb-4">
            <p className="text-[var(--dim)] mb-2">(You are dead. Meeting chat is read-only.)</p>
            {/* Ghost chat during meetings */}
            <div className="border-t border-[var(--dim)] pt-2 mt-2">
              <p className="text-[var(--dim)] text-base mb-1 italic">GHOST CHANNEL:</p>
              <div className="max-h-[20vh] overflow-y-auto mb-2">
                {(gameState.ghostChat || []).length === 0 && (
                  <p className="text-[var(--dim)] italic text-sm">No ghost messages yet.</p>
                )}
                {(gameState.ghostChat || []).map(msg => {
                  const sender = gameState.players[msg.playerId];
                  return (
                    <p key={msg.id} className="text-base mb-1 italic opacity-60">
                      <span style={{ color: sender?.color || 'var(--dim)' }}>
                        {msg.playerName}:
                      </span>
                      {' '}{msg.message}
                    </p>
                  );
                })}
                <div ref={ghostChatEndRef} />
              </div>
              <form onSubmit={handleSendGhostChat} className="flex gap-2">
                <span className="text-[var(--dim)] text-xl mt-1 opacity-60">{'>'}</span>
                <input
                  type="text"
                  value={ghostChatMessage}
                  onChange={(e) => setGhostChatMessage(e.target.value)}
                  className="term-input flex-1 opacity-60"
                  placeholder="Ghost chat... (only dead players see this)"
                  maxLength={200}
                />
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── MAIN PLAYING PHASE ────────────────────────

  const othersHere = playersHere.filter(p => p.id !== playerId);
  const isImpostor = currentPlayer.role === 'impostor';
  const isBlackout = gameState.blackout ? Date.now() < gameState.blackout.until : false;
  const isCommsJamActive = gameState.commsJam ? Date.now() < gameState.commsJam.until : false;
  const visibleOthers = othersHere;

  const killTargets = isImpostor
    ? othersHere.filter(p => p.role !== 'impostor')
    : [];

  const impostorNearby = !!gameState.sixthSenseWarning;

  const hasLocationPower = currentPlayer.powerup &&
    (currentPlayer.powerup.type === 'radar' || currentPlayer.powerup.type === 'tracker') &&
    currentPlayer.powerup.until > Date.now();

  const bloodhoundTarget = gameState.bloodhoundTarget || null;

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
    <div className={`min-h-screen p-4 max-w-lg mx-auto pb-16 ${isBlackout && !isImpostor && currentPlayer.status === 'alive' ? 'blackout-active' : ''}`}>
      {roleRevealOverlay}
      {taskBanner}

      {/* Audio toggle */}
      <button
        onClick={toggleAudio}
        className="fixed top-2 right-2 z-50 text-[var(--dim)] text-xs px-2 py-1 border border-[var(--dim)] bg-black opacity-60 hover:opacity-100"
      >
        {audioOn ? '\u266A ON' : '\u266A OFF'}
      </button>

      {/* Audio prompt */}
      {showAudioPrompt && (
        <div className="fixed top-10 right-2 z-50 text-[var(--dim)] text-xs px-2 py-1 border border-[var(--dim)] bg-black" style={{ animation: 'fadeIn 0.3s ease-in' }}>
          AUDIO SYSTEMS OFFLINE
        </div>
      )}

      {/* Blackout overlay for innocents */}
      {isBlackout && !isImpostor && currentPlayer.status === 'alive' && (
        <div className="fixed inset-0 z-30 flex items-center justify-center pointer-events-none blackout-overlay">
          <p className="text-[var(--red)] text-2xl tracking-widest" style={{ animation: 'blink 1s step-end infinite', textShadow: '0 0 20px var(--red)' }}>
            BLACKOUT — SYSTEMS OFFLINE
          </p>
        </div>
      )}

      {/* Sabotage activation flash — brief "SYSTEM BREACH DETECTED" */}

      {/* Header */}
      <div className="mt-4">
        <div className="text-[var(--dim)]">{'═'.repeat(30)}</div>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            {currentPlayer.specialRole === 'shapeshifter' ? (
              <p className="text-xl text-[var(--red)] glow-red">
                {' '}ROLE: SHAPESHIFTER {'  '}TASKS: {completedFakeTasks.size}/{currentPlayer.totalTasks}
              </p>
            ) : isImpostor ? (
              <p className="text-xl text-[var(--red)] glow-red">
                {' '}ROLE: IMPOSTOR {'  '}TASKS: {completedFakeTasks.size}/{currentPlayer.totalTasks}
              </p>
            ) : currentPlayer.specialRole === 'jester' ? (
              <p className="text-xl text-[var(--amber)]" style={{ textShadow: '0 0 8px var(--amber)' }}>
                {' '}ROLE: JESTER
              </p>
            ) : currentPlayer.specialRole === 'sheriff' ? (
              <p className="text-xl text-[var(--cyan)]" style={{ textShadow: '0 0 8px var(--cyan)' }}>
                {' '}ROLE: SHERIFF {'  '}TASKS: {currentPlayer.tasksCompleted}/{currentPlayer.totalTasks}
              </p>
            ) : currentPlayer.specialRole === 'phantom' ? (
              <p className="text-xl" style={{ textShadow: '0 0 8px #ff00ff', color: '#ff00ff' }}>
                {' '}ROLE: PHANTOM {'  '}TASKS: {currentPlayer.tasksCompleted}/{currentPlayer.totalTasks}
              </p>
            ) : currentPlayer.specialRole === 'survivor' ? (
              <p className="text-xl text-[var(--amber)]" style={{ textShadow: '0 0 8px var(--amber)' }}>
                {' '}ROLE: SURVIVOR {'  '}TASKS: {currentPlayer.tasksCompleted}/{currentPlayer.totalTasks}
              </p>
            ) : (
              <p className="text-xl">
                {' '}ROLE: INNOCENT {'  '}TASKS: {currentPlayer.tasksCompleted}/{currentPlayer.totalTasks}
              </p>
            )}
          </div>
          {/* Game clock — always visible */}
          {gameClockSeconds > 0 && (
            <p className="text-[var(--green)] glow-green text-lg ml-2 whitespace-nowrap">
              [{formatTime(gameClockSeconds)}]
            </p>
          )}
        </div>
        {currentPlayer.status === 'dead' && (
          <div className="border border-[var(--dim)] px-3 py-2 mt-1 mb-1">
            <p className="text-[var(--dim)] glow text-lg tracking-widest text-center">TERMINAL: SPECTATOR MODE</p>
            <p className="text-[var(--dim)] text-sm text-center">You drift unseen. Complete tasks. Chat with the dead.</p>
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
      <div className="mt-3 mb-2">
        <h2 className="text-2xl glow">{currentLocation?.name.toUpperCase()}</h2>
        <p
          className="text-[var(--dim)] mt-1 text-base"
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
        <div className="mb-4 font-mono text-base leading-tight">
          {MAP_LINES.map((line, li) => (
            <div key={li} className="whitespace-pre">
              {line.map((el, ei) => {
                if (typeof el === 'string') {
                  return <span key={ei} className="text-[var(--dim)]">{el}</span>;
                }
                const label = ROOM_ABBRS[el.id] || el.id;
                const padded = ` ${label}${label.length < 3 ? ' ' : ''}`;
                const isCurrent = el.id === currentPlayer.location;
                const hasTask = allMyTasks.some(t => t.location === el.id && !completedFakeTasks.has(t.id));
                const cls = isCurrent ? 'text-[var(--green)] glow-green' : hasTask ? 'text-[var(--green)]' : 'text-[var(--dim)]';
                return <span key={ei} className={cls}>{isCurrent ? `[${label}]` : padded}</span>;
              })}
            </div>
          ))}
          <p className="text-[var(--dim)] text-xs mt-1">[ ] = you {'  '} amber = task</p>
        </div>
      )}

      {/* Jester mission */}
      {currentPlayer.specialRole === 'jester' && currentPlayer.status === 'alive' && (
        <div className="mb-4">
          <p className="text-[var(--amber)] text-base" style={{ textShadow: '0 0 6px var(--amber)' }}>
            MISSION: GET EJECTED. NO TASKS — JUST DECEPTION.
          </p>
        </div>
      )}

      {/* Survivor shields */}
      {currentPlayer.specialRole === 'survivor' && currentPlayer.status === 'alive' && (
        <div className="mb-4">
          <p className="text-[var(--amber)] text-base" style={{ textShadow: '0 0 6px var(--amber)' }}>
            SHIELDS: {currentPlayer.survivorShields === 2 ? '\u2588\u2588' : currentPlayer.survivorShields === 1 ? '\u2588\u2591' : '\u2591\u2591'} ({currentPlayer.survivorShields ?? 0})
          </p>
        </div>
      )}

      {/* Survivor shield consumed notification */}
      {survivorShieldMsg && (
        <p className="text-[var(--amber)] glow text-lg mb-2" style={{ textShadow: '0 0 10px var(--amber)' }}>
          {survivorShieldMsg}
        </p>
      )}

      {/* Shapeshifter disguise status */}
      {currentPlayer.specialRole === 'shapeshifter' && currentPlayer.disguise && currentPlayer.disguise.until > Date.now() && (
        <div className="mb-4">
          <p className="text-[var(--red)] text-base glow-red">
            DISGUISED AS <span style={{ color: currentPlayer.disguise.asColor }}>{currentPlayer.disguise.asName}</span> [{Math.max(0, Math.ceil((currentPlayer.disguise.until - Date.now()) / 1000))}s]
          </p>
        </div>
      )}

      {/* Phantom glitch — visible to all living players */}
      {gameState.phantomGlitch && gameState.phantomGlitch.until > Date.now() && currentPlayer.status === 'alive' && (
        <div className="mb-4" style={{ animation: 'glitch 0.3s infinite' }}>
          <p className="text-lg" style={{ color: '#ff00ff', textShadow: '0 0 15px #ff00ff, 2px 0 #00ffff, -2px 0 #ff0000' }}>
            A GLITCHING FIGURE MATERIALIZES...
          </p>
          <p className="text-lg" style={{ color: '#ff00ff', textShadow: '0 0 10px #ff00ff' }}>
            {gameState.phantomGlitch.playerName}{"'"}s ghost!
          </p>
          {currentPlayer.location === gameState.phantomGlitch.location && (
            <button
              className="term-btn text-lg"
              style={{ color: '#ff00ff', borderColor: '#ff00ff' }}
              onClick={() => socket.send(JSON.stringify({ type: 'reportPhantom', playerId }))}
            >
              {'> '}REPORT GLITCH
            </button>
          )}
        </div>
      )}

      {/* Sheriff investigate result overlay */}
      {investigateResult && (
        <div className="mb-4 p-3 border" style={{ borderColor: investigateResult.isImpostor ? 'var(--red)' : 'var(--green)' }}>
          <p className="text-[var(--cyan)] text-base">SCANNING {investigateResult.targetName}...</p>
          {investigateResult.isImpostor ? (
            <p className="text-[var(--red)] glow-red text-lg tracking-wider mt-1">
              RESULT: {'\u2588\u2588'}THREAT DETECTED{'\u2588\u2588'}
            </p>
          ) : (
            <p className="text-[var(--green)] glow-green text-lg tracking-wider mt-1">
              RESULT: CLEAR
            </p>
          )}
        </div>
      )}

      {/* Phantom reveal overlay (shown to reporter) */}
      {phantomReveal && (
        <div className="mb-4 p-3 border" style={{ borderColor: '#ff00ff' }}>
          <p style={{ color: '#ff00ff', textShadow: '0 0 10px #ff00ff' }} className="text-lg tracking-wider">
            GHOST ANALYSIS COMPLETE.
          </p>
          <p style={{ color: '#ff00ff', textShadow: '0 0 10px #ff00ff' }} className="text-lg tracking-wider mt-1">
            KILLER IDENTIFIED: <span style={{ color: phantomReveal.killerColor }}>{phantomReveal.killerName}</span>
          </p>
        </div>
      )}

      {/* Persistent task list (innocents + impostors with fake tasks) */}
      {currentPlayer.specialRole !== 'jester' && (() => {
        const tasksToShow = allMyTasks.filter(t => !completedFakeTasks.has(t.id));
        if (tasksToShow.length === 0) return null;
        return (
          <div className="mb-4">
            <p className="text-[var(--dim)] text-base mb-1">{currentPlayer.status === 'dead' ? 'GHOST TASKS:' : 'YOUR TASKS:'}</p>
            {tasksToShow.map(task => {
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
                    <span className="text-[var(--green)]"> ({nav.hops}{nav.hops === 1 ? ' room' : ' rooms'}, go: {nextLoc?.name || '???'})</span>
                  )}
                </p>
              );
            })}
          </div>
        );
      })()}

      {/* Active powerup */}
      {currentPlayer.powerup && currentPlayer.powerup.until > Date.now() && (
        <p className="text-[var(--cyan)] glow text-lg mb-2">
          &#9889; {getPowerupDescription(currentPlayer.powerup.type)} [{Math.max(0, Math.ceil((currentPlayer.powerup.until - Date.now()) / 1000))}s]
        </p>
      )}

      {/* Sabotage banners */}
      {isCommsJamActive && (
        <p className="text-[var(--amber)] text-lg mb-2" style={{ textShadow: '0 0 8px var(--amber)' }}>
          COMMS JAM ACTIVE — NEXT MEETING AFFECTED
        </p>
      )}
      {gameState.scrambled && Date.now() < gameState.scrambled.until && (
        <div className="mb-2 screen-glitch">
          <p className="text-[var(--red)] glow-red text-lg">
            SPATIAL ANOMALY DETECTED
          </p>
          <p className="text-[var(--green)] glow-green text-lg">
            Everyone has been teleported!
          </p>
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
            {visibleOthers.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ', '}
                <span style={{ color: currentPlayer.status === 'dead' && p.role === 'impostor' ? 'var(--red)' : p.color }}>{p.name}</span>
                {/* Co-impostor ALLY tag */}
                {isImpostor && p.role === 'impostor' && (
                  <span className="text-[var(--red)]"> [ALLY]</span>
                )}
                {/* Ghost sees impostors */}
                {currentPlayer.status === 'dead' && p.role === 'impostor' && (
                  <span className="text-[var(--red)]"> [IMP]</span>
                )}
              </span>
            ))}
          </p>
        ) : (
          <p className="text-[var(--dim)] text-lg">
            You are alone here.
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
                {`${gameState.players[body.playerId]?.name || 'Someone'} lies motionless on the ground.`}
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
              ) : (
                <>
                  <button
                    className="term-btn term-btn-red text-lg"
                    onClick={() => setShowSabotagePanel(!showSabotagePanel)}
                  >
                    {'> '}SABOTAGE {showSabotagePanel ? '\u25BC' : '\u25B6'}
                  </button>
                  {showSabotagePanel && (
                    <div className="ml-2 border border-[var(--red)] p-2 mt-1" style={{ borderColor: 'rgba(255, 0, 64, 0.4)' }}>
                      <p className="text-[var(--red)] text-base mb-2 tracking-widest">{'═'.repeat(3)} SABOTAGE {'═'.repeat(12)}</p>
                      <button
                        className="term-btn term-btn-red text-base"
                        onClick={() => {
                          audio.sabotageAlert();
                          haptics.alarm();
                          socket.send(JSON.stringify({ type: 'sabotage', playerId, data: { type: 'commsJam' } }));
                          setShowSabotagePanel(false);
                        }}
                      >
                        {'> '}[COMMS JAM] <span className="text-[var(--dim)]">Corrupt next meeting{"'"}s chat</span>
                      </button>
                      <button
                        className="term-btn term-btn-red text-base"
                        onClick={() => {
                          audio.sabotageAlert();
                          haptics.alarm();
                          socket.send(JSON.stringify({ type: 'sabotage', playerId, data: { type: 'blackout' } }));
                          setShowSabotagePanel(false);
                        }}
                      >
                        {'> '}[BLACKOUT] <span className="text-[var(--dim)]">10s darkness — blind the crew</span>
                      </button>
                      <button
                        className="term-btn term-btn-red text-base"
                        onClick={() => {
                          audio.sabotageAlert();
                          haptics.alarm();
                          socket.send(JSON.stringify({ type: 'sabotage', playerId, data: { type: 'scramble' } }));
                          setShowSabotagePanel(false);
                        }}
                      >
                        {'> '}[SCRAMBLE] <span className="text-[var(--dim)]">Teleport everyone randomly</span>
                      </button>
                      <p className="text-[var(--red)] text-base mt-2 tracking-widest">{'═'.repeat(22)}</p>
                      <button
                        className="term-btn text-[var(--dim)] text-base"
                        onClick={() => setShowSabotagePanel(false)}
                      >
                        {'> '}[CANCEL]
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Sheriff investigate */}
          {currentPlayer.specialRole === 'sheriff' && currentPlayer.status === 'alive' && (() => {
            const investigateCooldownLeft = gameState.cooldowns?.investigate ? Math.max(0, Math.ceil((gameState.cooldowns.investigate - Date.now()) / 1000)) : 0;
            const investigateTargets = othersHere.filter(p => p.id !== playerId);
            return (
              <div className="mb-4">
                {investigateCooldownLeft > 0 ? (
                  <p className="text-[var(--dim)] text-lg">INVESTIGATE [{investigateCooldownLeft}s]</p>
                ) : investigateTargets.length > 0 ? (
                  <>
                    <p className="text-[var(--cyan)] text-lg" style={{ textShadow: '0 0 6px var(--cyan)' }}>INVESTIGATE:</p>
                    {investigateTargets.map(p => (
                      <button
                        key={p.id}
                        className="term-btn text-lg"
                        style={{ color: 'var(--cyan)' }}
                        onClick={() => socket.send(JSON.stringify({ type: 'investigate', playerId, data: { targetId: p.id } }))}
                      >
                        {'> '}SCAN <span style={{ color: p.color }}>{p.name}</span>
                      </button>
                    ))}
                  </>
                ) : (
                  <p className="text-[var(--dim)] text-lg">INVESTIGATE [no targets in room]</p>
                )}
              </div>
            );
          })()}

          {/* Shapeshifter disguise */}
          {currentPlayer.specialRole === 'shapeshifter' && currentPlayer.status === 'alive' && (() => {
            const shapeshiftCooldownLeft = gameState.cooldowns?.shapeshift ? Math.max(0, Math.ceil((gameState.cooldowns.shapeshift - Date.now()) / 1000)) : 0;
            const isDisguised = currentPlayer.disguise && currentPlayer.disguise.until > Date.now();
            const alivePlayers = Object.values(gameState.players).filter(p => p.status === 'alive' && p.id !== playerId);
            return (
              <div className="mb-4">
                {isDisguised ? (
                  <p className="text-[var(--dim)] text-lg">SHAPESHIFT [active]</p>
                ) : shapeshiftCooldownLeft > 0 ? (
                  <p className="text-[var(--dim)] text-lg">SHAPESHIFT [{shapeshiftCooldownLeft}s]</p>
                ) : (
                  <>
                    <button
                      className="term-btn term-btn-red text-lg"
                      onClick={() => setShowShapeshiftPicker(!showShapeshiftPicker)}
                    >
                      {'> '}SHAPESHIFT {showShapeshiftPicker ? '\u25BC' : '\u25B6'}
                    </button>
                    {showShapeshiftPicker && (
                      <div className="ml-6">
                        {alivePlayers.map(p => (
                          <button
                            key={p.id}
                            className="term-btn term-btn-red text-base"
                            onClick={() => {
                              socket.send(JSON.stringify({ type: 'shapeshift', playerId, data: { targetId: p.id } }));
                              setShowShapeshiftPicker(false);
                            }}
                          >
                            {'  > '}Disguise as <span style={{ color: p.color }}>{p.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })()}

          {/* Tasks here (all roles except jester) */}
          {currentPlayer.specialRole !== 'jester' && (() => {
            const tasksHere = myTasksHere.filter(t => !completedFakeTasks.has(t.id));
            if (tasksHere.length === 0) return null;
            return (
              <div className="mb-4">
                <p className="text-lg">TASKS HERE:</p>
                {tasksHere.map(task => (
                  <button
                    key={task.id}
                    className="term-btn text-lg"
                    onClick={() => handleCompleteTask(task.id)}
                  >
                    {'> '}{task.title}
                  </button>
                ))}
              </div>
            );
          })()}

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
                    className="term-btn text-lg"
                    onClick={() => handleMove(locId)}
                  >
                    {'> '}{loc?.name}
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
                className="term-btn term-btn-green text-lg"
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

          {/* Ghost tasks — innocents can still complete tasks to help team */}
          {currentPlayer.role === 'innocent' && (() => {
            const ghostTasksHere = myTasksHere.filter(t => !completedFakeTasks.has(t.id));
            if (ghostTasksHere.length === 0) return null;
            return (
              <div className="mb-4">
                <p className="text-[var(--dim)] text-lg">GHOST TASKS HERE:</p>
                {ghostTasksHere.map(task => (
                  <button
                    key={task.id}
                    className="term-btn text-lg text-[var(--dim)]"
                    onClick={() => handleCompleteTask(task.id)}
                  >
                    {'> '}{task.title}
                  </button>
                ))}
              </div>
            );
          })()}

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

          {/* Ghost chat panel — only during playing phase */}
          <div className="mb-4 border-t border-[var(--dim)] pt-3">
            <p className="text-[var(--dim)] text-base mb-1 italic">GHOST CHANNEL:</p>
            <div className="max-h-[25vh] overflow-y-auto mb-2">
              {(gameState.ghostChat || []).length === 0 && (
                <p className="text-[var(--dim)] italic text-sm">No ghost messages yet. Say something to the dead.</p>
              )}
              {(gameState.ghostChat || []).map(msg => {
                const sender = gameState.players[msg.playerId];
                return (
                  <p key={msg.id} className="text-base mb-1 italic opacity-60">
                    <span style={{ color: sender?.color || 'var(--dim)' }}>
                      {msg.playerName}:
                    </span>
                    {' '}{msg.message}
                  </p>
                );
              })}
              <div ref={ghostChatEndRef} />
            </div>
            <form onSubmit={handleSendGhostChat} className="flex gap-2">
              <span className="text-[var(--dim)] text-xl mt-1 opacity-60">{'>'}</span>
              <input
                type="text"
                value={ghostChatMessage}
                onChange={(e) => setGhostChatMessage(e.target.value)}
                className="term-input flex-1 opacity-60"
                placeholder="Ghost chat... (only dead players see this)"
                maxLength={200}
              />
            </form>
          </div>
        </div>
      )}

      {/* Idle flavor text */}
      {flavorLines.length > 0 && (
        <div className="mt-4">
          {flavorLines.map((line, i) => {
            const isGrue = line.includes('grue') || line.includes('getting dark') || line.includes('flee in terror');
            return (
              <p key={i} className={`text-base italic ${isGrue ? 'text-[var(--green)] glow-green' : 'text-[var(--dim)]'}`}>{line}</p>
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
