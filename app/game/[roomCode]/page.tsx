'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import usePartySocket from 'partysocket/react';
import { GameState, Player } from '@/types/game';
import {
  NarrativeTemplate,
  getTravelNarrative,
  getTaskNarrative,
  getKillNarrative,
  getReportNarrative,
  getMeetingNarrative,
  getIdleFlavor,
} from '@/lib/narrative';

// ── Narrative state ──────────────────────────────

interface ActiveNarrative {
  lines: string[];
  choiceA: { label: string; result: string; action: () => void };
  choiceB: { label: string; result: string; action: () => void };
}

export default function Game() {
  const params = useParams();
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

  const socket = usePartySocket({
    host: process.env.NEXT_PUBLIC_PARTYKIT_HOST || 'localhost:1999',
    room: roomCode,
    onMessage(event) {
      const msg = JSON.parse(event.data);
      if (msg.type === 'gameState') {
        setGameState(msg.data);
      }
    },
  });

  useEffect(() => {
    const persistentId = sessionStorage.getItem('playerId');
    if (persistentId) setPlayerId(persistentId);
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
      setFlavorLines(prev => [...prev.slice(-2), getIdleFlavor()]);
    }, 12000 + Math.random() * 8000);
    return () => clearInterval(interval);
  }, [gameState?.phase, !!narrative]);

  // Clear flavor when moving
  useEffect(() => {
    setFlavorLines([]);
  }, [gameState?.players?.[playerId]?.location]);

  // ── Helpers ───────────────────────────────────

  const currentPlayer = gameState ? gameState.players[playerId] : null;
  const currentLocation = gameState?.locations.find(l => l.id === currentPlayer?.location);

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
    const template = getTravelNarrative(dest?.name || 'somewhere');
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
      () => socket.send(JSON.stringify({ type: 'kill', playerId, data: { victimId } })),
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
    const bodyPlayer = gameState?.deadBody
      ? gameState.players[gameState.deadBody.playerId]
      : null;
    const template = getReportNarrative(bodyPlayer?.name || 'someone');
    startNarrative(
      template,
      () => socket.send(JSON.stringify({ type: 'reportBody', playerId })),
      () => {}, // choice B: walk away
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
    socket.send(JSON.stringify({ type: 'chat', playerId, data: { message: chatMessage } }));
    setChatMessage('');
  };

  const handleVote = (votedForId: string) => {
    socket.send(JSON.stringify({ type: 'vote', playerId, data: { votedForId } }));
  };

  const divider = () => <div className="text-[var(--dim)] my-3">{'═'.repeat(30)}</div>;

  const getEjectedPlayer = (): Player | null => {
    if (!gameState?.votes) return null;
    const voteCounts: Record<string, number> = {};
    Object.values(gameState.votes).forEach(votedForId => {
      voteCounts[votedForId] = (voteCounts[votedForId] || 0) + 1;
    });
    let maxVotes = 0;
    let ejectedId = '';
    Object.entries(voteCounts).forEach(([id, count]) => {
      if (count > maxVotes) { maxVotes = count; ejectedId = id; }
    });
    if (ejectedId && maxVotes >= 2) return gameState.players[ejectedId];
    return null;
  };

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

  // ── NARRATIVE SCREEN ──────────────────────────

  if (narrative) {
    return (
      <div className="min-h-screen p-4 max-w-lg mx-auto flex flex-col justify-center">
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
        <div className="mt-8">
          {divider()}
          {gameState.winner === 'innocents' ? (
            <div>
              <p className="text-2xl glow text-center">INNOCENTS WIN</p>
              <p className="text-[var(--dim)] text-center mt-1">The impostor has been stopped.</p>
            </div>
          ) : (
            <div>
              <p className="text-2xl text-[var(--red)] glow-red text-center">IMPOSTORS WIN</p>
              <p className="text-[var(--dim)] text-center mt-1">The school has fallen.</p>
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

          <div className="mt-8">
            <button onClick={() => window.location.href = '/'} className="term-btn glow text-xl">
              [PLAY AGAIN]
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── RESULTS ───────────────────────────────────

  if (gameState.phase === 'results') {
    const ejected = getEjectedPlayer();
    return (
      <div className="min-h-screen p-4 max-w-lg mx-auto">
        <div className="mt-8">
          {divider()}
          <p className="text-xl text-center">VOTE RESULTS</p>
          {divider()}

          {ejected ? (
            <div className="mt-6 text-center">
              <p className="text-xl" style={{ color: ejected.color }}>
                {ejected.name} was ejected.
              </p>
              <p className={`text-lg mt-2 ${
                ejected.role === 'impostor' ? 'text-[var(--red)] glow-red' : 'text-[var(--green)]'
              }`}>
                {ejected.name} was {ejected.role === 'impostor' ? 'the IMPOSTOR.' : 'INNOCENT.'}
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
        <div className="mt-8">
          {divider()}
          <p className="text-xl text-center">WHO IS THE IMPOSTOR?</p>
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
        <div className="mt-8">
          {divider()}
          <p className="text-xl text-center text-[var(--amber)] glow-amber">
            {gameState.deadBody ? '!! BODY REPORTED !!' : '!! EMERGENCY MEETING !!'}
          </p>
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
  const killTargets = currentPlayer.role === 'impostor'
    ? othersHere.filter(p => p.role !== 'impostor')
    : [];

  return (
    <div className="min-h-screen p-4 max-w-lg mx-auto pb-16">
      {/* Header */}
      <div className="mt-4">
        <div className="text-[var(--dim)]">{'═'.repeat(30)}</div>
        {currentPlayer.role === 'impostor' ? (
          <p className="text-[var(--red)] glow-red text-xl">
            {' '}ROLE: IMPOSTOR
          </p>
        ) : (
          <p className="text-xl">
            {' '}ROLE: INNOCENT {'  '}TASKS: {currentPlayer.tasksCompleted}/{currentPlayer.totalTasks}
          </p>
        )}
        {currentPlayer.status === 'dead' && (
          <p className="text-[var(--red)] glow-red"> &#9760; YOU ARE DEAD &#9760;</p>
        )}
        <div className="text-[var(--dim)]">{'═'.repeat(30)}</div>
      </div>

      {/* Location */}
      <div className="mt-4 mb-3">
        <h2 className="text-2xl glow">{currentLocation?.name.toUpperCase()}</h2>
        <p className="text-[var(--dim)] mt-1 text-lg">{currentLocation?.description}</p>
      </div>

      {/* Players here */}
      <div className="mb-4">
        {othersHere.length > 0 ? (
          <p className="text-lg">
            <span className="text-[var(--dim)]">You see: </span>
            {othersHere.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ', '}
                <span style={{ color: p.color }}>{p.name} ({p.icon})</span>
              </span>
            ))}
          </p>
        ) : (
          <p className="text-[var(--dim)] text-lg">You are alone here.</p>
        )}
      </div>

      {currentPlayer.status === 'alive' ? (
        <>
          {/* Dead body */}
          {gameState.deadBody && (
            <div className="mb-4">
              <p className="text-[var(--red)] glow-red text-lg">!! A BODY HAS BEEN FOUND !!</p>
              <button className="term-btn term-btn-red text-lg" onClick={handleReportBody}>
                {'> '}Report body
              </button>
            </div>
          )}

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
            {currentLocation?.connectedTo.map(locId => {
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
          {flavorLines.map((line, i) => (
            <p key={i} className="text-[var(--dim)] text-base italic">{line}</p>
          ))}
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
