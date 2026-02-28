'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import usePartySocket from 'partysocket/react';
import { GameState } from '@/types/game';
import {
  NarrativeTemplate,
  getTravelNarrative,
  getTaskNarrative,
  getKillNarrative,
  getReportNarrative,
  getDiscoveryNarrative,
  getMeetingNarrative,
  getIdleFlavor,
  getSecretRoomNarrative,
  getPowerupDescription,
} from '@/lib/narrative';

// ── Narrative state ──────────────────────────────

interface ActiveNarrative {
  lines: string[];
  choiceA: { label: string; result: string; action: () => void };
  choiceB: { label: string; result: string; action: () => void };
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

  // Idle flavor
  const [flavorLines, setFlavorLines] = useState<string[]>([]);

  // Body discovery tracking
  const discoveredBodyRef = useRef<string | null>(null);

  // Konami code (keyboard) + secret tap (mobile)
  const [showKonamiConfirm, setShowKonamiConfirm] = useState(false);
  const konamiRef = useRef<string[]>([]);
  const tapCountRef = useRef({ count: 0, lastTap: 0 });

  // Grue tracking
  const [grueWarning, setGrueWarning] = useState(0); // 0=none, 1=dark, 2=grue
  const grueTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Secret room discovery
  const [secretRoomFound, setSecretRoomFound] = useState(false);
  const secretTapRef = useRef({ count: 0, lastTap: 0 });

  // Track pending kill to detect shield block
  const pendingKillRef = useRef<string | null>(null);
  const [shieldBlockMsg, setShieldBlockMsg] = useState<string | null>(null);

  // Powerup countdown tick (forces re-render for live timer)
  const [, setTick] = useState(0);

  const socketRef = useRef<ReturnType<typeof usePartySocket> | null>(null);
  const socket = usePartySocket({
    host: process.env.NEXT_PUBLIC_PARTYKIT_HOST || 'localhost:1999',
    room: roomCode,
    onMessage(event) {
      const msg = JSON.parse(event.data);
      if (msg.type === 'gameState') {
        // Check if a pending kill was blocked by shield
        const victimId = pendingKillRef.current;
        if (victimId && msg.data.players?.[victimId]?.status === 'alive') {
          const victimName = msg.data.players[victimId]?.name || 'them';
          setShieldBlockMsg(`Something protected ${victimName}. Your attack failed.`);
          setTimeout(() => setShieldBlockMsg(null), 3000);
        }
        pendingKillRef.current = null;
        setGameState(msg.data);
      }
    },
  });
  socketRef.current = socket;

  // Re-identify on every connection (including reconnects after WiFi drop)
  // Done in a separate effect because socket isn't available inside its own onOpen
  useEffect(() => {
    const handleOpen = () => {
      const pid = sessionStorage.getItem('playerId');
      if (pid && socketRef.current) {
        socketRef.current.send(JSON.stringify({ type: 'identify', playerId: pid }));
      }
    };
    socket.addEventListener('open', handleOpen);
    // If already connected, identify now
    if (socket.readyState === WebSocket.OPEN) {
      handleOpen();
    }
    return () => socket.removeEventListener('open', handleOpen);
  }, [socket]);

  useEffect(() => {
    const persistentId = sessionStorage.getItem('playerId');
    if (persistentId) setPlayerId(persistentId);
  }, []);

  // Identify ourselves to the server for per-player filtered state
  useEffect(() => {
    if (playerId) {
      socket.send(JSON.stringify({ type: 'identify', playerId }));
    }
  }, [playerId]);

  // ── Konami code detection ─────────────────────
  // Keyboard: ↑↑↓↓←→←→BA  |  Mobile: tap ROLE header 10x fast

  useEffect(() => {
    const KONAMI = ['up','up','down','down','left','right','left','right','b','a'];
    const seq = konamiRef.current;

    const checkKonami = () => {
      if (seq.length >= KONAMI.length) {
        const last = seq.slice(-KONAMI.length);
        if (last.every((v, i) => v === KONAMI[i])) {
          seq.length = 0;
          setShowKonamiConfirm(true);
        }
      }
    };

    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, string> = {
        ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
        b: 'b', B: 'b', a: 'a', A: 'a',
      };
      if (map[e.key]) { seq.push(map[e.key]); checkKonami(); }
      if (seq.length > 20) seq.splice(0, seq.length - 20);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Mobile: tap the role header 10 times within 4 seconds
  const handleRoleTap = useCallback(() => {
    const now = Date.now();
    const ref = tapCountRef.current;
    if (now - ref.lastTap > 4000) ref.count = 0; // reset if too slow
    ref.count++;
    ref.lastTap = now;
    if (ref.count >= 10) {
      ref.count = 0;
      setShowKonamiConfirm(true);
    }
  }, []);

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

  // ── Auto-scroll chat ─────────────────────────

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [gameState?.chat?.length]);

  // ── Narrative line reveal ─────────────────────

  useEffect(() => {
    if (!narrative) return;
    if (resultText) return; // don't reveal during result

    if (revealedLines >= narrative.lines.length) {
      const t = setTimeout(() => setShowChoices(true), 400);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setRevealedLines(r => r + 1), 600);
    return () => clearTimeout(t);
  }, [narrative, revealedLines, resultText]);

  // ── Idle flavor text ──────────────────────────

  useEffect(() => {
    if (gameState?.phase !== 'playing' || narrative) return;
    setFlavorLines([]);
    const interval = setInterval(() => {
      setFlavorLines(prev => [...prev.slice(-2), getIdleFlavor(currentPlayer?.location)]);
    }, 12000 + Math.random() * 8000);
    return () => clearInterval(interval);
  }, [gameState?.phase, !!narrative]);

  // Clear flavor when moving
  useEffect(() => {
    setFlavorLines([]);
  }, [gameState?.players?.[playerId]?.location]);

  // ── Grue mechanic ──────────────────────────
  // Stay in one room 60s+: warnings then forced teleport

  useEffect(() => {
    if (gameState?.phase !== 'playing') return;
    const player = gameState?.players?.[playerId];
    if (!player || player.status === 'dead') return;
    const loc = gameState?.locations.find(l => l.id === player.location);

    // Reset grue on location change
    setGrueWarning(0);
    if (grueTimerRef.current) clearTimeout(grueTimerRef.current);

    // 40s: first warning
    const t1 = setTimeout(() => {
      setGrueWarning(1);
      setFlavorLines(prev => [...prev.slice(-1), 'It is getting dark...']);
    }, 40000);

    // 55s: second warning
    const t2 = setTimeout(() => {
      setGrueWarning(2);
      setFlavorLines(prev => [...prev.slice(-1), 'You are likely to be eaten by a grue.']);
    }, 55000);

    // 65s: grue strikes — teleport to random connected room
    const t3 = setTimeout(() => {
      if (!loc?.connectedTo.length) return;
      const randomExit = loc.connectedTo[
        Math.floor(Math.random() * loc.connectedTo.length)
      ];
      setGrueWarning(0);
      setFlavorLines(['A grue has found you! You flee in terror.']);
      socket.send(JSON.stringify({ type: 'move', playerId, data: { location: randomExit } }));
    }, 65000);

    grueTimerRef.current = t3;
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [gameState?.phase, gameState?.players?.[playerId]?.location, gameState?.players?.[playerId]?.status]);

  // ── Powerup countdown tick ─────────────────────
  useEffect(() => {
    const player = gameState?.players?.[playerId];
    if (!player?.powerup || player.powerup.until <= Date.now()) return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [gameState?.players?.[playerId]?.powerup?.until]);

  // ── Derived values (needed by effects below) ──
  const currentPlayer = gameState ? gameState.players[playerId] : null;
  const currentLocation = gameState?.locations.find(l => l.id === currentPlayer?.location);

  // ── Body discovery ──────────────────────────

  // Clear discovery tracking when bodies are cleared (after meeting)
  useEffect(() => {
    if (!gameState?.deadBodies?.length) {
      discoveredBodyRef.current = null;
    }
  }, [gameState?.deadBodies?.length]);

  // Auto-trigger discovery narrative when entering a room with a body
  useEffect(() => {
    if (narrative) return;
    if (!gameState?.deadBodies?.length || !currentPlayer) return;
    if (currentPlayer.status === 'dead') return;

    // Find a body in our room that we haven't discovered yet
    const bodyHere = gameState.deadBodies.find(
      b => b.location === currentPlayer.location && b.playerId !== discoveredBodyRef.current
    );
    if (!bodyHere) return;

    discoveredBodyRef.current = bodyHere.playerId;
    const bodyPlayer = gameState.players[bodyHere.playerId];
    const template = getDiscoveryNarrative(bodyPlayer?.name || 'someone');
    startNarrative(
      template,
      () => socket.send(JSON.stringify({ type: 'reportBody', playerId })),
      () => {}, // back away — body stays, report button still available
    );
  }, [narrative, currentPlayer?.location, gameState?.deadBodies?.length, currentPlayer?.status]);

  // ── Helpers ───────────────────────────────────

  const playersHere = gameState && currentPlayer
    ? Object.values(gameState.players).filter(
        p => p.location === currentPlayer.location && p.status === 'alive'
      )
    : [];

  const myTasks = gameState && currentPlayer
    ? gameState.tasks.filter(t =>
        t.id.startsWith(playerId) && t.location === currentPlayer.location
      )
    : [];

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // ── Start a narrative ─────────────────────────

  const startNarrative = useCallback((
    template: NarrativeTemplate,
    onA: () => void,
    onB: () => void,
  ) => {
    setNarrative({
      lines: template.lines,
      choiceA: { ...template.choiceA, action: onA },
      choiceB: { ...template.choiceB, action: onB },
    });
    setRevealedLines(0);
    setShowChoices(false);
    setResultText(null);
    setFlavorLines([]);
  }, []);

  const handleNarrativeChoice = (choice: 'a' | 'b') => {
    if (!narrative) return;
    const chosen = choice === 'a' ? narrative.choiceA : narrative.choiceB;
    setResultText(chosen.result);
    setShowChoices(false);

    setTimeout(() => {
      chosen.action();
      setNarrative(null);
      setResultText(null);
    }, 1800);
  };

  // ── Action handlers (with narrative) ──────────

  const handleMove = (locationId: string) => {
    const dest = gameState?.locations.find(l => l.id === locationId);
    const template = getTravelNarrative(dest?.name || 'somewhere', locationId);
    startNarrative(
      template,
      () => socket.send(JSON.stringify({ type: 'move', playerId, data: { location: locationId } })),
      () => socket.send(JSON.stringify({ type: 'move', playerId, data: { location: locationId } })),
    );
  };

  const handleKill = (victimId: string) => {
    const victim = gameState?.players[victimId];
    const template = getKillNarrative(victim?.name || 'them');
    startNarrative(
      template,
      () => {
        discoveredBodyRef.current = victimId; // Don't trigger discovery for own kill
        pendingKillRef.current = victimId; // Track to detect shield block
        socket.send(JSON.stringify({ type: 'kill', playerId, data: { victimId } }));
      },
      () => {}, // choice B: back out, do nothing
    );
  };

  const handleCompleteTask = (taskId: string) => {
    const task = gameState?.tasks.find(t => t.id === taskId);
    const template = getTaskNarrative(task?.title || 'Task', task?.description || '');
    startNarrative(
      template,
      () => socket.send(JSON.stringify({ type: 'completeTask', playerId, data: { taskId } })),
      () => socket.send(JSON.stringify({ type: 'completeTask', playerId, data: { taskId } })),
    );
  };

  const handleReportBody = () => {
    const bodyHere = gameState?.deadBodies?.find(b => b.location === currentPlayer?.location);
    const bodyPlayer = bodyHere ? gameState?.players[bodyHere.playerId] : null;
    const template = getReportNarrative(bodyPlayer?.name || 'someone');
    startNarrative(
      template,
      () => socket.send(JSON.stringify({ type: 'reportBody', playerId })),
      () => {}, // choice B: walk away
    );
  };

  // Secret room: tap the Music Room description to discover the hidden exit
  // The trigger text changes each game based on the active method
  const handleSecretTap = useCallback(() => {
    if (secretRoomFound) return;
    const now = Date.now();
    const ref = secretTapRef.current;
    if (now - ref.lastTap > 3000) ref.count = 0;
    ref.count++;
    ref.lastTap = now;
    if (ref.count >= 5) {
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
      () => {}, // back away
    );
  };

  const handleCallMeeting = () => {
    const template = getMeetingNarrative();
    startNarrative(
      template,
      () => socket.send(JSON.stringify({ type: 'callMeeting', playerId })),
      () => {}, // choice B: not yet
    );
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim()) return;

    // Secret command — classic text adventure cheat from Colossal Cave (1976)
    if (chatMessage.trim().toLowerCase() === 'xyzzy') {
      // Send the hollow voice message so everyone sees it
      socket.send(JSON.stringify({ type: 'chat', playerId, data: { message: "xyzzy" } }));
      setChatMessage('');
      // Small delay so they see the message before the confirm
      setTimeout(() => setShowKonamiConfirm(true), 800);
      return;
    }

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

  // ── KONAMI CONFIRMATION ──────────────────────

  const konamiOverlay = showKonamiConfirm && (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4">
      <div className="max-w-sm w-full">
        <p className="text-[var(--red)] glow-red text-xl text-center mb-2">
          ⚠ WARNING ⚠
        </p>
        <div className="text-[var(--dim)] text-center mb-1">{'═'.repeat(28)}</div>
        <p className="text-lg text-center mb-1">KONAMI CODE DETECTED.</p>
        <p className="text-lg text-center mb-1">This will crash reality.</p>
        <p className="text-lg text-center mb-4">Everyone dies. No survivors.</p>
        <div className="text-[var(--dim)] text-center mb-4">{'═'.repeat(28)}</div>
        <p className="text-[var(--amber)] glow-amber text-center mb-6">
          ARE YOU SURE?
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => {
              socket.send(JSON.stringify({ type: 'konamiKill', playerId }));
              setShowKonamiConfirm(false);
            }}
            className="term-btn term-btn-red text-xl"
          >
            {'> '}YES. CRASH REALITY.
          </button>
          <button
            onClick={() => setShowKonamiConfirm(false)}
            className="term-btn text-xl text-[var(--dim)]"
          >
            {'> '}No. I'm not ready.
          </button>
        </div>
      </div>
    </div>
  );

  // ── NARRATIVE SCREEN ──────────────────────────

  if (narrative) {
    return (
      <div className="min-h-screen p-4 max-w-lg mx-auto flex flex-col justify-center">
        {konamiOverlay}
        <div>
          {narrative.lines.slice(0, revealedLines).map((line, i) => (
            <p key={i} className="text-xl mb-2 glow">{line}</p>
          ))}

          {revealedLines < narrative.lines.length && (
            <span className="cursor-blink text-xl">&#9612;</span>
          )}

          {showChoices && !resultText && (
            <div className="mt-6">
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
        </div>
      </div>
    );
  }

  // ── GAME OVER ─────────────────────────────────

  if (gameState.phase === 'gameOver') {
    const allPlayers = Object.values(gameState.players);
    return (
      <div className="min-h-screen p-4 max-w-lg mx-auto">
        {konamiOverlay}
        <div className="mt-8">
          {divider()}
          {gameState.winner === 'konami' ? (
            <div>
              <pre className="text-[var(--red)] glow-red text-xs sm:text-sm text-center leading-tight">{`
 ██╗  ██╗ ██████╗ ███╗   ██╗ █████╗ ███╗   ███╗██╗
 ██║ ██╔╝██╔═══██╗████╗  ██║██╔══██╗████╗ ████║██║
 █████╔╝ ██║   ██║██╔██╗ ██║███████║██╔████╔██║██║
 ██╔═██╗ ██║   ██║██║╚██╗██║██╔══██║██║╚██╔╝██║██║
 ██║  ██╗╚██████╔╝██║ ╚████║██║  ██║██║ ╚═╝ ██║██║
 ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝`}</pre>
              <p className="text-[var(--red)] glow-red text-xl text-center mt-4">
                ↑ ↑ ↓ ↓ ← → ← → B A
              </p>
              <p className="text-[var(--amber)] glow-amber text-center mt-2">
                REALITY.EXE HAS CRASHED
              </p>
              <p className="text-[var(--dim)] text-center mt-1">
                Everyone is dead. Nobody wins. The school is empty now.
              </p>
            </div>
          ) : gameState.winner === 'innocents' ? (
            <div>
              <pre className="text-[var(--green)] glow text-xs sm:text-sm text-center leading-tight">{`
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
              <pre className="text-[var(--red)] glow-red text-xs sm:text-sm text-center leading-tight">{`
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
            {playerId === gameState.hostId ? (
              <button
                onClick={() => {
                  socket.send(JSON.stringify({ type: 'restartGame', playerId }));
                  setSecretRoomFound(false);
                }}
                className="term-btn glow text-xl"
              >
                [PLAY AGAIN — SAME GROUP]
              </button>
            ) : (
              <p className="text-[var(--dim)] text-lg">Waiting for host to restart...</p>
            )}
            <button onClick={() => window.location.href = '/'} className="term-btn text-xl text-[var(--dim)]">
              [NEW ROOM]
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── RESULTS ───────────────────────────────────

  if (gameState.phase === 'results') {
    const ejection = gameState.ejectionResult;
    return (
      <div className="min-h-screen p-4 max-w-lg mx-auto">
        {konamiOverlay}
        <div className="mt-8">
          {divider()}
          <pre className="text-[var(--green)] glow text-center text-xs sm:text-sm leading-tight">{`
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

          <p className="text-[var(--dim)] text-center mt-8">Returning to game...</p>
          <span className="cursor-blink text-xl">&#9612;</span>
        </div>
      </div>
    );
  }

  // ── VOTING ────────────────────────────────────

  if (gameState.phase === 'voting') {
    const alivePlayers = Object.values(gameState.players).filter(p => p.status === 'alive');
    const hasVoted = gameState.votes[playerId] !== undefined;

    return (
      <div className="min-h-screen p-4 max-w-lg mx-auto">
        {konamiOverlay}
        <div className="mt-8">
          {divider()}
          <pre className="text-[var(--amber)] glow-amber text-xs sm:text-sm text-center leading-tight">{`
 ██╗   ██╗ ██████╗ ████████╗███████╗
 ██║   ██║██╔═══██╗╚══██╔══╝██╔════╝
 ██║   ██║██║   ██║   ██║   █████╗
 ╚██╗ ██╔╝██║   ██║   ██║   ██╔══╝
  ╚████╔╝ ╚██████╔╝   ██║   ███████╗
   ╚═══╝   ╚═════╝    ╚═╝   ╚══════╝`}</pre>
          <p className="text-[var(--amber)] text-center glow-amber">[{formatTime(timeLeft)}]</p>
          {divider()}

          {currentPlayer.status === 'dead' ? (
            <p className="text-[var(--dim)] mt-4">(You are dead. Observing.)</p>
          ) : hasVoted ? (
            <div className="mt-4">
              <p className="text-[var(--dim)]">Vote cast. Waiting for others...</p>
              <span className="cursor-blink text-xl">&#9612;</span>
            </div>
          ) : (
            <div className="mt-4">
              {alivePlayers.map(p => (
                <button
                  key={p.id}
                  onClick={() => handleVote(p.id)}
                  className={`term-btn text-lg ${p.id === playerId ? 'text-[var(--dim)]' : ''}`}
                >
                  {'> '}
                  <span style={{ color: p.id === playerId ? undefined : p.color }}>
                    {p.name} ({p.icon})
                  </span>
                  {p.id === playerId && <span> (you)</span>}
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
      </div>
    );
  }

  // ── MEETING ───────────────────────────────────

  if (gameState.phase === 'meeting') {
    return (
      <div className="min-h-screen p-4 max-w-lg mx-auto flex flex-col">
        {konamiOverlay}
        <div className="mt-8">
          {divider()}
          {gameState.deadBodies?.some(b => b.reportedBy) ? (
            <pre className="text-[var(--red)] glow-red text-xs sm:text-sm text-center leading-tight">{`
 ██████╗  ██████╗ ██████╗ ██╗   ██╗
 ██╔══██╗██╔═══██╗██╔══██╗╚██╗ ██╔╝
 ██████╔╝██║   ██║██║  ██║ ╚████╔╝
 ██╔══██╗██║   ██║██║  ██║  ╚██╔╝
 ██████╔╝╚██████╔╝██████╔╝   ██║
 ╚═════╝  ╚═════╝ ╚═════╝    ╚═╝
    R E P O R T E D`}</pre>
          ) : (
            <pre className="text-[var(--amber)] glow-amber text-xs sm:text-sm text-center leading-tight">{`
 ███╗   ███╗███████╗███████╗████████╗██╗███╗   ██╗ ██████╗
 ████╗ ████║██╔════╝██╔════╝╚══██╔══╝██║████╗  ██║██╔════╝
 ██╔████╔██║█████╗  █████╗     ██║   ██║██╔██╗ ██║██║  ███╗
 ██║╚██╔╝██║██╔══╝  ██╔══╝     ██║   ██║██║╚██╗██║██║   ██║
 ██║ ╚═╝ ██║███████╗███████╗   ██║   ██║██║ ╚████║╚██████╔╝
 ╚═╝     ╚═╝╚══════╝╚══════╝   ╚═╝   ╚═╝╚═╝  ╚═══╝ ╚═════╝`}</pre>
          )}
          <p className="text-[var(--amber)] text-center">[{formatTime(timeLeft)}]</p>
          {divider()}
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
          <form onSubmit={handleSendChat} className="flex gap-2 pb-4">
            <span className="text-[var(--dim)] text-xl mt-1">{'>'}</span>
            <input
              type="text"
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              className="term-input flex-1"
              placeholder="speak..."
              maxLength={200}
              autoFocus
            />
          </form>
        ) : (
          <p className="text-[var(--dim)] pb-4">(You are dead. You can only listen.)</p>
        )}
      </div>
    );
  }

  // ── MAIN PLAYING PHASE ────────────────────────

  const othersHere = playersHere.filter(p => p.id !== playerId);
  const isLightsOut = gameState.lightsOut ? Date.now() < gameState.lightsOut.until : false;

  // Shadow Walk is handled server-side — shadow-walking impostors have
  // their location set to '__shadow__' so they naturally don't appear in othersHere
  const visibleOthers = othersHere;

  const killTargets = currentPlayer.role === 'impostor'
    ? othersHere.filter(p => p.role !== 'impostor')
    : [];

  // Sixth Sense: computed server-side, sent as gameState.sixthSenseWarning
  const impostorNearby = !!gameState.sixthSenseWarning;

  // Radar (innocent) or Tracker (impostor): see all player locations
  const hasLocationPower = currentPlayer.powerup &&
    (currentPlayer.powerup.type === 'radar' || currentPlayer.powerup.type === 'tracker') &&
    currentPlayer.powerup.until > Date.now();

  // Bloodhound: computed server-side, sent as gameState.bloodhoundTarget
  const bloodhoundTarget = gameState.bloodhoundTarget || null;

  // Doors locked
  const isDoorsLocked = gameState.doorsLocked ? Date.now() < gameState.doorsLocked.until : false;

  return (
    <div className="min-h-screen p-4 max-w-lg mx-auto pb-16">
      {konamiOverlay}
      {/* Header */}
      <div className="mt-4">
        <div className="text-[var(--dim)]">{'═'.repeat(30)}</div>
        {currentPlayer.role === 'impostor' ? (
          <div onClick={handleRoleTap}>
            <pre className="text-[var(--red)] glow-red text-xs leading-tight">{`  _____
 /     \\
| () () |  ROLE: IMPOSTOR
 \\ ___ /
  |||||`}</pre>
          </div>
        ) : (
          <p className="text-xl" onClick={handleRoleTap}>
            {' '}ROLE: INNOCENT {'  '}TASKS: {currentPlayer.tasksCompleted}/{currentPlayer.totalTasks}
          </p>
        )}
        {currentPlayer.status === 'dead' && (
          <div>
            <pre className="text-[var(--red)] glow-red text-xs leading-tight">{`
  ██████╗ ███████╗ █████╗ ██████╗
  ██╔══██╗██╔════╝██╔══██╗██╔══██╗
  ██║  ██║█████╗  ███████║██║  ██║
  ██║  ██║██╔══╝  ██╔══██║██║  ██║
  ██████╔╝███████╗██║  ██║██████╔╝
  ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═════╝`}</pre>
            <p className="text-[var(--dim)] text-sm"> INSERT COIN TO CONTINUE.</p>
          </div>
        )}
        {/* Global task progress bar */}
        {gameState.taskProgress && (
          <div className="mt-1">
            <div className="flex items-center gap-2">
              <span className="text-[var(--dim)] text-sm">TASKS</span>
              <div className="flex-1 h-3 border border-[var(--dim)]">
                <div
                  className="h-full bg-[var(--green)]"
                  style={{ width: `${Math.round((gameState.taskProgress.completed / gameState.taskProgress.total) * 100)}%` }}
                />
              </div>
              <span className="text-[var(--dim)] text-sm">{gameState.taskProgress.completed}/{gameState.taskProgress.total}</span>
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
        {/* Subtle hint for the secret room — only in the entrance room */}
        {gameState.atSecretEntrance && !secretRoomFound && gameState.secretRoomMethod && (
          <p className="text-[var(--dim)] text-sm mt-1 opacity-60">
            {gameState.secretRoomMethod === 'piano' && 'Something in the corner catches your eye...'}
            {gameState.secretRoomMethod === 'shelves' && 'A faint hum comes from behind the shelves...'}
            {gameState.secretRoomMethod === 'cases' && 'Something rattles in the back of the room...'}
          </p>
        )}
      </div>

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
        <p className="text-[var(--red)] glow-red text-lg mb-2">
          &#128274; DOORS LOCKED &#128274; — You can't move.
        </p>
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
            {isLightsOut && currentPlayer.role !== 'impostor' ? (
              <span className="text-[var(--dim)]">
                {visibleOthers.map((_, i) => (i > 0 ? ', ' : '') + '???').join('')}
              </span>
            ) : (
              visibleOthers.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ', '}
                  <span style={{ color: p.color }}>{p.name} ({p.icon})</span>
                </span>
              ))
            )}
          </p>
        ) : (
          <p className="text-[var(--dim)] text-lg">
            {isLightsOut ? "You can't tell if you're alone." : "You are alone here."}
          </p>
        )}
      </div>

      {/* Radar / Tracker — see all player locations */}
      {hasLocationPower && (
        <div className="mb-4">
          <p className="text-[var(--cyan)] text-lg">SCANNING ALL LOCATIONS:</p>
          {Object.values(gameState.players)
            .filter(p => p.status === 'alive' && p.id !== playerId)
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
          {/* Dead bodies — only visible at the body's location */}
          {gameState.deadBodies?.filter(b => b.location === currentPlayer.location).map(body => (
            <div key={body.playerId} className="mb-4">
              <p className="text-[var(--red)] glow-red text-lg">
                {isLightsOut && currentPlayer.role !== 'impostor'
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

          {/* Kill targets (impostor) */}
          {killTargets.length > 0 && (
            <div className="mb-4">
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
            </div>
          )}

          {/* Sabotage (impostor) */}
          {currentPlayer.role === 'impostor' && !isLightsOut && !isDoorsLocked && (
            <div className="mb-4">
              <p className="text-[var(--red)] text-lg">SABOTAGE:</p>
              <button
                className="term-btn term-btn-amber text-lg"
                onClick={() => socket.send(JSON.stringify({ type: 'sabotage', playerId, data: { type: 'lightsOut' } }))}
              >
                {'> '}Kill the lights
              </button>
              <button
                className="term-btn term-btn-amber text-lg"
                onClick={() => socket.send(JSON.stringify({ type: 'sabotage', playerId, data: { type: 'doorsLocked' } }))}
              >
                {'> '}Lock the doors
              </button>
              <button
                className="term-btn term-btn-amber text-lg"
                onClick={() => socket.send(JSON.stringify({ type: 'sabotage', playerId, data: { type: 'scramble' } }))}
              >
                {'> '}Scramble everyone
              </button>
            </div>
          )}

          {/* Tasks (innocent) */}
          {currentPlayer.role === 'innocent' && myTasks.length > 0 && (
            <div className="mb-4">
              <p className="text-lg">TASKS HERE:</p>
              {myTasks.map(task => (
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
              .filter(locId => locId !== 'secret') // Hide secret room from normal exits
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
            {/* Secret room exit — only in the entrance room after discovery */}
            {secretRoomFound && gameState.atSecretEntrance && (
              <button
                className="term-btn text-lg text-[var(--cyan)]"
                onClick={handleEnterSecretRoom}
              >
                {'> '}??? Room 404
              </button>
            )}
          </div>

          {/* Actions */}
          <div className="mb-4">
            <button
              className="term-btn term-btn-amber text-lg"
              onClick={handleCallMeeting}
            >
              {'> '}Call emergency meeting
            </button>
          </div>
        </>
      ) : (
        <p className="text-[var(--dim)] mt-6 text-lg">(You are dead. You can only observe.)</p>
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
