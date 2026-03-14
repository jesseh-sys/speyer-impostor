'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { PLAYER_COLORS } from '@/lib/gameConfig';
import { audio } from './game/lib/audio';

const BOOT_LINES = [
  'SPEYER-OS v3.14',
  'LOADING KERNEL........... OK',
  'SCANNING NETWORK......... OK',
  'CHECKING SENSORS......... OK',
  'ANOMALY DETECTED.',
];

export default function Home() {
  const [bootStep, setBootStep] = useState(0);
  const [bootComplete, setBootComplete] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [selectedColor, setSelectedColor] = useState('#00ff41');
  const [showJoin, setShowJoin] = useState(false);
  const [roomCode, setRoomCode] = useState('');
  const [audioOn, setAudioOn] = useState(false);
  const router = useRouter();

  useEffect(() => {
    audio.loadPreference();
    setAudioOn(audio.isEnabled());
  }, []);

  const toggleAudio = useCallback(() => {
    if (audio.isEnabled()) {
      audio.disable();
      setAudioOn(false);
    } else {
      audio.enable();
      setAudioOn(true);
    }
  }, []);

  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];
    BOOT_LINES.forEach((_, i) => {
      timers.push(setTimeout(() => setBootStep(i + 1), (i + 1) * 350));
    });
    timers.push(setTimeout(() => setBootComplete(true), BOOT_LINES.length * 350 + 400));
    return () => timers.forEach(clearTimeout);
  }, []);

  const generateRoomCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  };

  const handleCreate = () => {
    if (!playerName.trim()) return;
    const code = generateRoomCode();
    localStorage.setItem('playerName', playerName);
    localStorage.setItem('playerColor', selectedColor);
    router.push(`/lobby/${code}`);
  };

  const handleJoin = () => {
    if (!playerName.trim() || !roomCode.trim()) return;
    localStorage.setItem('playerName', playerName);
    localStorage.setItem('playerColor', selectedColor);
    router.push(`/lobby/${roomCode.toUpperCase()}`);
  };

  return (
    <div className="min-h-screen p-4 max-w-lg mx-auto">
      {/* Audio toggle */}
      <button
        onClick={toggleAudio}
        className="fixed top-2 right-2 z-50 text-[var(--dim)] text-xs px-2 py-1 border border-[var(--dim)] bg-black opacity-60 hover:opacity-100"
      >
        {audioOn ? '\u266A ON' : '\u266A OFF'}
      </button>

      {/* Boot sequence */}
      <div className="mt-4 mb-3">
        {BOOT_LINES.slice(0, bootStep).map((line, i) => (
          <p key={i} className={`text-base ${
            line === 'ANOMALY DETECTED.'
              ? 'text-[var(--red)] glow-red'
              : 'text-[var(--dim)]'
          }`}>
            {line}
          </p>
        ))}
        {!bootComplete && (
          <span className="cursor-blink text-xl">&#9612;</span>
        )}
      </div>

      {bootComplete && (
        <div>
          {/* Title */}
          <pre className="text-[var(--green)] glow-green leading-tight mb-1">{`
 ███████╗██████╗ ███████╗██╗   ██╗███████╗██████╗
 ██╔════╝██╔══██╗██╔════╝╚██╗ ██╔╝██╔════╝██╔══██╗
 ███████╗██████╔╝█████╗   ╚████╔╝ █████╗  ██████╔╝
 ╚════██║██╔═══╝ ██╔══╝    ╚██╔╝  ██╔══╝  ██╔══██╗
 ███████║██║     ███████╗   ██║   ███████╗██║  ██║
 ╚══════╝╚═╝     ╚══════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝
      ╔══════════════════════════╗
      ║  A F T E R   H O U R S  ║
      ╚══════════════════════════╝`}</pre>
          <p className="text-[var(--dim)] text-sm mb-1">v2.0 &copy; 2025 SPEYER INTERACTIVE</p>
          <p className="text-[var(--dim)] mb-4">You are in a school. It is dark. Trust no one.</p>

          {/* Name input */}
          <div className="mb-4">
            <p className="text-lg mb-1">ENTER YOUR NAME:</p>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className="term-input"
              placeholder="type here..."
              maxLength={15}
              autoFocus
            />
          </div>

          {/* Color selection */}
          <div className="mb-3">
            <p className="text-lg mb-1">CHOOSE YOUR COLOR:</p>
            <div className="flex flex-wrap gap-2">
              {PLAYER_COLORS.map(color => (
                <button
                  key={color}
                  onClick={() => setSelectedColor(color)}
                  className={`w-11 h-11 rounded transition-all text-lg flex items-center justify-center ${
                    selectedColor === color
                      ? 'ring-2 ring-white scale-110'
                      : 'opacity-60 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: color }}
                >
                  {selectedColor === color ? '✓' : ''}
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="mb-4 text-xl">
            <span className="text-[var(--dim)]">{'> '}</span>
            <span style={{ color: selectedColor }}>
              {playerName || '???'}
            </span>
          </div>

          {/* Actions */}
          {!showJoin ? (
            <div>
              <button onClick={handleCreate} className="term-btn glow text-xl">
                [CREATE NEW GAME]
              </button>
              <button onClick={() => setShowJoin(true)} className="term-btn text-xl">
                [JOIN GAME]
              </button>
            </div>
          ) : (
            <div>
              <p className="text-lg mb-2">ENTER ROOM CODE:</p>
              <input
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                className="term-input mb-4"
                placeholder="XXXXXX"
                maxLength={6}
                autoFocus
              />
              <button onClick={handleJoin} className="term-btn glow text-xl">
                [JOIN]
              </button>
              <button
                onClick={() => { setShowJoin(false); setRoomCode(''); }}
                className="term-btn text-xl text-[var(--dim)]"
              >
                [BACK]
              </button>
            </div>
          )}

          <div className="mt-6 text-base text-[var(--dim)]">
            <p>4-15 PLAYERS / 10 MINUTE ROUNDS</p>
          </div>
        </div>
      )}
    </div>
  );
}
