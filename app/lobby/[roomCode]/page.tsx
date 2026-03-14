'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import usePartySocket from 'partysocket/react';
import { GameState, SpecialRole } from '@/types/game';
import { GAME_CONFIG, SPECIAL_ROLES } from '@/lib/gameConfig';

export default function Lobby() {
  const params = useParams();
  const router = useRouter();
  const roomCode = params.roomCode as string;
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerId, setPlayerId] = useState('');
  const [copied, setCopied] = useState(false);

  const socket = usePartySocket({
    host: process.env.NEXT_PUBLIC_PARTYKIT_HOST || 'localhost:1999',
    room: roomCode,
    onMessage(event) {
      const msg = JSON.parse(event.data);
      if (msg.type === 'gameState') {
        setGameState(msg.data);
        if (msg.data.phase !== 'lobby') {
          router.push(`/game/${roomCode}`);
        }
      }
    },
  });

  // Re-send join on reconnect so the server knows who we are
  useEffect(() => {
    const handleOpen = () => {
      const pid = sessionStorage.getItem('playerId');
      const name = localStorage.getItem('playerName') || 'Anonymous';
      const icon = localStorage.getItem('playerIcon') || '@';
      const color = localStorage.getItem('playerColor') || '#00ff41';
      if (pid) {
        socket.send(JSON.stringify({
          type: 'join', playerId: pid,
          data: { playerName: name, icon, color },
        }));
      }
    };
    socket.addEventListener('open', handleOpen);
    return () => socket.removeEventListener('open', handleOpen);
  }, [socket]);

  useEffect(() => {
    let persistentId = sessionStorage.getItem('playerId')
      || localStorage.getItem(`playerId-${roomCode}`);
    if (!persistentId) {
      persistentId = `player-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    sessionStorage.setItem('playerId', persistentId);
    localStorage.setItem(`playerId-${roomCode}`, persistentId);
    setPlayerId(persistentId);
  }, [roomCode]);

  useEffect(() => {
    if (!socket || !playerId) return;

    const name = localStorage.getItem('playerName') || 'Anonymous';
    const icon = localStorage.getItem('playerIcon') || '@';
    const color = localStorage.getItem('playerColor') || '#00ff41';

    const timer = setTimeout(() => {
      socket.send(JSON.stringify({
        type: 'join',
        playerId: playerId,
        data: { playerName: name, icon, color },
      }));
    }, 100);

    return () => clearTimeout(timer);
  }, [socket, playerId]);

  const handleStartGame = () => {
    if (!gameState) return;
    const playerCount = Object.keys(gameState.players).length;
    if (playerCount < GAME_CONFIG.MIN_PLAYERS) return;

    socket.send(JSON.stringify({
      type: 'startGame',
      playerId,
    }));
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!gameState) {
    return (
      <div className="min-h-screen p-4 max-w-lg mx-auto mt-4">
        <p className="text-xl glow">CONNECTING TO SERVER...</p>
        <span className="cursor-blink text-xl">&#9612;</span>
      </div>
    );
  }

  const players = Object.values(gameState.players);
  const needed = GAME_CONFIG.MIN_PLAYERS - players.length;

  return (
    <div className="min-h-screen p-4 max-w-lg mx-auto">
      <div className="mt-4 mb-3">
        <p className="text-[var(--dim)] text-sm">AFTER HOURS {'>'} GAME LOBBY</p>
        <div className="text-[var(--dim)] mt-1">{'═'.repeat(30)}</div>
      </div>

      {/* Room code */}
      <div className="mb-3">
        <p className="text-lg">ROOM CODE:</p>
        <button
          onClick={handleCopyCode}
          className="text-3xl glow tracking-widest mt-1 bg-transparent border-none cursor-pointer"
        >
          {roomCode}
        </button>
        <p className="text-sm text-[var(--dim)] mt-1">
          {copied ? '-- COPIED TO CLIPBOARD --' : '(tap to copy)'}
        </p>
      </div>

      <div className="text-[var(--dim)]">{'═'.repeat(30)}</div>

      {/* Players */}
      <div className="my-3">
        <p className="text-lg mb-1">CONNECTED PLAYERS ({players.length}/{GAME_CONFIG.MAX_PLAYERS}):</p>
        {players.map((player, i) => (
          <p key={player.id} className="text-lg mb-1">
            <span className="text-[var(--dim)]">{` ${i + 1}. `}</span>
            <span style={{ color: player.color }}>
              {player.name}
            </span>
            {player.id === gameState.hostId && (
              <span className="text-[var(--cyan)]"> [HOST]</span>
            )}
            {player.id === playerId && player.id !== gameState.hostId && (
              <span className="text-[var(--green)]"> {'<-- YOU'}</span>
            )}
          </p>
        ))}
        {players.length === 0 && (
          <p className="text-[var(--dim)]">  Waiting for players...</p>
        )}
      </div>

      <div className="text-[var(--dim)]">{'═'.repeat(30)}</div>

      {/* Role config */}
      {gameState.roleConfig && (
        <div className="my-3">
          <p className="text-lg mb-1 text-[var(--green)]">ROLE CONFIG:</p>
          {(Object.keys(SPECIAL_ROLES) as SpecialRole[]).map(role => {
            const info = SPECIAL_ROLES[role];
            const isEnabled = gameState.roleConfig![role];
            const isHost = playerId === gameState.hostId;
            const isLocked = role === 'jester';
            return (
              <div key={role} className="flex items-center gap-2 mb-1">
                {isHost && !isLocked ? (
                  <button
                    className="bg-transparent border-none cursor-pointer text-lg"
                    onClick={() => {
                      socket.send(JSON.stringify({
                        type: 'roleConfig',
                        playerId,
                        data: { role, enabled: !isEnabled },
                      }));
                    }}
                  >
                    <span className={isEnabled ? 'text-[var(--green)]' : 'text-[var(--dim)]'}>
                      {isEnabled ? '[ON] ' : '[OFF]'}
                    </span>
                    <span className={isEnabled ? 'text-[var(--green)]' : 'text-[var(--dim)]'}>
                      {info.name}
                    </span>
                  </button>
                ) : (
                  <span className="text-lg">
                    <span className={isEnabled ? 'text-[var(--green)]' : 'text-[var(--dim)]'}>
                      {isEnabled ? '[ON] ' : '[OFF]'}
                    </span>
                    <span className={isEnabled ? 'text-[var(--green)]' : 'text-[var(--dim)]'}>
                      {info.name}
                    </span>
                    {isLocked && <span className="text-[var(--dim)]"> (locked)</span>}
                  </span>
                )}
              </div>
            );
          })}
          <p className="text-[var(--dim)] text-sm mt-1">Special roles require 6+ players.</p>
        </div>
      )}

      <div className="text-[var(--dim)]">{'═'.repeat(30)}</div>

      {/* Start / waiting */}
      <div className="my-3">
        {needed > 0 ? (
          <p className="text-[var(--green)] glow-green text-lg">
            NEED {needed} MORE PLAYER{needed === 1 ? '' : 'S'} TO START
          </p>
        ) : playerId === gameState.hostId ? (
          <button onClick={handleStartGame} className="term-btn glow text-xl">
            [START GAME]
          </button>
        ) : (
          <p className="text-[var(--dim)] text-lg">
            Waiting for host to start...
          </p>
        )}
      </div>

      <div className="text-[var(--dim)]">{'═'.repeat(30)}</div>

      {/* How to play */}
      <div className="my-3 text-[var(--dim)]">
        <p className="text-lg text-[var(--green)] mb-1">HOW TO PLAY:</p>
        <p className="mb-1">Innocents: Complete tasks. Report bodies. Vote out impostors.</p>
        <p className="mb-1">Impostors: Eliminate innocents. Blend in. Survive votes.</p>
        <p className="text-[var(--red)] mt-1">Trust no one.</p>
      </div>

      {/* Blinking cursor */}
      <p className="mt-4">
        <span className="text-[var(--dim)]">{'> '}</span>
        <span className="cursor-blink">&#9612;</span>
      </p>
    </div>
  );
}
