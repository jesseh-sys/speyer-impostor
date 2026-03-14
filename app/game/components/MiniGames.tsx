'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { audio } from '../lib/audio';
import { haptics } from '../lib/haptics';

export interface MiniGameProps {
  onComplete: () => void;
  onCancel: () => void;
}

// ── HackTerminal — Type a Code ──────────────────

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function HackTerminal({ onComplete, onCancel }: MiniGameProps) {
  const [code, setCode] = useState(generateCode);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'entering' | 'granted' | 'denied'>('entering');
  const [timeLeft, setTimeLeft] = useState(8);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const timerRefs = useRef<NodeJS.Timeout[]>([]);

  useEffect(() => {
    return () => { timerRefs.current.forEach(clearTimeout); };
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          setStatus('denied');
          audio.miniGameFail();
          haptics.light();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [code]);

  const handleRetry = () => {
    setCode(generateCode());
    setInput('');
    setStatus('entering');
    setTimeLeft(8);
    const id = setTimeout(() => inputRef.current?.focus(), 50);
    timerRefs.current.push(id);
  };

  const handleInputChange = (value: string) => {
    const upper = value.toUpperCase();
    setInput(upper);
    if (upper.length === 6) {
      if (upper === code) {
        setStatus('granted');
        if (timerRef.current) clearInterval(timerRef.current);
        audio.miniGameSuccess();
        haptics.success();
        const id = setTimeout(onComplete, 800);
        timerRefs.current.push(id);
      } else {
        setStatus('denied');
        if (timerRef.current) clearInterval(timerRef.current);
        audio.miniGameFail();
        haptics.light();
      }
    }
  };

  return (
    <div className="min-h-screen p-4 max-w-lg mx-auto flex flex-col justify-center">
      <div className="text-center">
        <p className="text-[var(--dim)] text-base tracking-widest mb-2">SECURITY TERMINAL v2.04</p>
        <div className="text-[var(--dim)]">{'═'.repeat(30)}</div>

        {status === 'granted' ? (
          <div className="my-8">
            <p className="text-[var(--green)] glow-green text-2xl tracking-widest" style={{ animation: 'fadeIn 0.3s ease-in' }}>
              ACCESS GRANTED
            </p>
          </div>
        ) : status === 'denied' && input.length === 6 ? (
          <div className="my-8">
            <p className="text-[var(--red)] glow-red text-xl tracking-widest mb-4">ACCESS DENIED</p>
            <p className="text-[var(--dim)] text-base mb-4">WRONG CODE. TRY AGAIN.</p>
            <button onClick={handleRetry} className="term-btn text-xl">
              {'> '}RETRY
            </button>
          </div>
        ) : status === 'denied' ? (
          <div className="my-8">
            <p className="text-[var(--red)] glow-red text-xl tracking-widest mb-4">TIMEOUT</p>
            <p className="text-[var(--dim)] text-base mb-4">TOO SLOW. TRY AGAIN.</p>
            <button onClick={handleRetry} className="term-btn text-xl">
              {'> '}RETRY
            </button>
          </div>
        ) : (
          <div className="my-6">
            <p className="text-[var(--dim)] text-base mb-2">ENTER ACCESS CODE:</p>
            <p className="text-[var(--green)] glow-green text-4xl tracking-[0.3em] font-mono mb-6">{code}</p>
            <p className="text-[var(--dim)] text-base mb-1">{'>'} TYPE CODE:</p>
            <div className="flex justify-center items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => handleInputChange(e.target.value)}
                maxLength={6}
                className="term-input text-2xl tracking-[0.3em] text-center w-48 font-mono"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
              />
            </div>
            <p className="text-[var(--dim)] text-base mt-4">TIME: [{timeLeft}s]</p>
          </div>
        )}

        <div className="text-[var(--dim)]">{'═'.repeat(30)}</div>
        <button onClick={onCancel} className="term-btn text-base text-[var(--dim)] mt-4">
          {'> '}CANCEL
        </button>
      </div>
    </div>
  );
}

// ── DefragDrive — Tap Sequence ──────────────────

function shufflePositions(): number[] {
  const positions = [0, 1, 2, 3, 4];
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  return positions;
}

export function DefragDrive({ onComplete, onCancel }: MiniGameProps) {
  const [positions, setPositions] = useState(shufflePositions);
  const [nextExpected, setNextExpected] = useState(1);
  const [tapped, setTapped] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<'playing' | 'error' | 'done'>('playing');
  const timerRefs = useRef<NodeJS.Timeout[]>([]);

  useEffect(() => {
    return () => { timerRefs.current.forEach(clearTimeout); };
  }, []);

  const handleTap = (blockNum: number) => {
    if (status === 'done') return;
    if (blockNum === nextExpected) {
      const newTapped = new Set(tapped);
      newTapped.add(blockNum);
      setTapped(newTapped);
      audio.keyClick();
      haptics.light();
      if (blockNum === 5) {
        setStatus('done');
        audio.miniGameSuccess();
        haptics.success();
        const id = setTimeout(onComplete, 800);
        timerRefs.current.push(id);
      } else {
        setNextExpected(blockNum + 1);
      }
    } else {
      setStatus('error');
      audio.miniGameFail();
      haptics.light();
      const id = setTimeout(() => {
        setPositions(shufflePositions());
        setNextExpected(1);
        setTapped(new Set());
        setStatus('playing');
      }, 600);
      timerRefs.current.push(id);
    }
  };

  // 3x2 grid layout with blocks placed in shuffled positions
  const gridSlots = [0, 1, 2, 3, 4];

  return (
    <div className="min-h-screen p-4 max-w-lg mx-auto flex flex-col justify-center">
      <div className="text-center">
        <p className="text-[var(--dim)] text-base tracking-widest mb-2">DRIVE DEFRAGMENTATION</p>
        <div className="text-[var(--dim)]">{'═'.repeat(30)}</div>

        {status === 'done' ? (
          <div className="my-8">
            <p className="text-[var(--green)] glow-green text-2xl tracking-widest">DEFRAG COMPLETE</p>
          </div>
        ) : (
          <div className="my-6">
            <p className="text-[var(--dim)] text-base mb-1">TAP BLOCKS IN ORDER: 1 {'→'} 5</p>
            {status === 'error' && (
              <p className="text-[var(--red)] glow-red text-base mb-2">WRONG ORDER — RESHUFFLING...</p>
            )}
            <p className="text-[var(--dim)] text-base mb-4">NEXT: [{nextExpected}]</p>

            <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto">
              {gridSlots.map(slotIdx => {
                const blockNum = positions[slotIdx] + 1; // 1-5
                const isDone = tapped.has(blockNum);
                return (
                  <button
                    key={slotIdx}
                    onClick={() => !isDone && handleTap(blockNum)}
                    className={`border-2 p-4 text-2xl font-mono transition-colors ${
                      isDone
                        ? 'border-[var(--green)] text-[var(--green)] bg-[rgba(0,255,65,0.1)]'
                        : 'border-[var(--dim)] text-[var(--green)] bg-transparent active:bg-[rgba(0,255,65,0.1)]'
                    }`}
                    disabled={isDone}
                  >
                    [{blockNum.toString().padStart(2, '0')}]
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="text-[var(--dim)]">{'═'.repeat(30)}</div>
        <button onClick={onCancel} className="term-btn text-base text-[var(--dim)] mt-4">
          {'> '}CANCEL
        </button>
      </div>
    </div>
  );
}

// ── DecodeSignal — Pattern Match ──────────────────

const SYMBOLS = ['\u25AE', '\u25AF', '\u25B2', '\u25BC', '\u25C6'];

function generatePattern(): string[] {
  const pattern: string[] = [];
  for (let i = 0; i < 4; i++) {
    pattern.push(SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
  }
  return pattern;
}

export function DecodeSignal({ onComplete, onCancel }: MiniGameProps) {
  const [pattern, setPattern] = useState(generatePattern);
  const [entered, setEntered] = useState<string[]>([]);
  const [status, setStatus] = useState<'playing' | 'error' | 'done'>('playing');
  const timerRefs = useRef<NodeJS.Timeout[]>([]);

  useEffect(() => {
    return () => { timerRefs.current.forEach(clearTimeout); };
  }, []);

  const handleSymbolTap = (symbol: string) => {
    if (status === 'done') return;
    const newEntered = [...entered, symbol];
    const idx = newEntered.length - 1;

    if (newEntered[idx] !== pattern[idx]) {
      setStatus('error');
      audio.miniGameFail();
      haptics.light();
      const id = setTimeout(() => {
        setEntered([]);
        setStatus('playing');
      }, 500);
      timerRefs.current.push(id);
      return;
    }

    audio.keyClick();
    haptics.light();
    setEntered(newEntered);
    if (newEntered.length === pattern.length) {
      setStatus('done');
      audio.miniGameSuccess();
      haptics.success();
      const id2 = setTimeout(onComplete, 800);
      timerRefs.current.push(id2);
    }
  };

  return (
    <div className="min-h-screen p-4 max-w-lg mx-auto flex flex-col justify-center">
      <div className="text-center">
        <p className="text-[var(--dim)] text-base tracking-widest mb-2">SIGNAL DECODER</p>
        <div className="text-[var(--dim)]">{'═'.repeat(30)}</div>

        {status === 'done' ? (
          <div className="my-8">
            <p className="text-[var(--green)] glow-green text-2xl tracking-widest">SIGNAL DECODED</p>
          </div>
        ) : (
          <div className="my-6">
            <p className="text-[var(--dim)] text-base mb-2">INCOMING SIGNAL:</p>
            <p className="text-[var(--green)] glow-green text-3xl tracking-[0.4em] mb-6">
              {pattern.join(' ')}
            </p>

            {status === 'error' && (
              <p className="text-[var(--red)] glow-red text-base mb-2">MISMATCH — RESETTING...</p>
            )}

            <p className="text-[var(--dim)] text-base mb-2">
              YOUR INPUT: {entered.length > 0 ? entered.join(' ') : '_'}
              {entered.length < pattern.length && <span className="cursor-blink"> {'|'}</span>}
            </p>

            <div className="flex justify-center gap-3 mt-4">
              {SYMBOLS.map((symbol, i) => (
                <button
                  key={i}
                  onClick={() => handleSymbolTap(symbol)}
                  className="border-2 border-[var(--dim)] text-[var(--green)] p-3 text-2xl bg-transparent active:bg-[rgba(0,255,65,0.1)] min-w-[48px]"
                >
                  {symbol}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="text-[var(--dim)]">{'═'.repeat(30)}</div>
        <button onClick={onCancel} className="term-btn text-base text-[var(--dim)] mt-4">
          {'> '}CANCEL
        </button>
      </div>
    </div>
  );
}

// ── CrackPassword — Word Unscramble ──────────────────

const WORD_POOL = [
  'SPEYER', 'LOCKER', 'HALLWAY', 'SHADOW', 'STATIC',
  'FLICKER', 'PHANTOM', 'SUSPECT', 'SIGNAL', 'SYSTEM',
  'BREACH', 'CIPHER', 'REBOOT', 'GHOST', 'ALARM',
  'VAULT', 'ESCAPE', 'DECODE', 'GLITCH', 'TERROR',
];

function scrambleWord(word: string): string {
  const arr = word.split('');
  // Keep shuffling until it's different from the original
  let scrambled: string;
  do {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    scrambled = arr.join('');
  } while (scrambled === word);
  return scrambled;
}

export function CrackPassword({ onComplete, onCancel }: MiniGameProps) {
  const [word] = useState(() => WORD_POOL[Math.floor(Math.random() * WORD_POOL.length)]);
  const [scrambled] = useState(() => scrambleWord(word));
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'entering' | 'cracked' | 'wrong'>('entering');
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRefs = useRef<NodeJS.Timeout[]>([]);

  useEffect(() => {
    return () => { timerRefs.current.forEach(clearTimeout); };
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleInputChange = (value: string) => {
    const upper = value.toUpperCase();
    setInput(upper);
  };

  const handleSubmit = useCallback(() => {
    if (input === word) {
      setStatus('cracked');
      audio.miniGameSuccess();
      haptics.success();
      const id = setTimeout(onComplete, 800);
      timerRefs.current.push(id);
    } else {
      setStatus('wrong');
      audio.miniGameFail();
      haptics.light();
      const id = setTimeout(() => {
        setStatus('entering');
        setInput('');
        inputRef.current?.focus();
      }, 800);
      timerRefs.current.push(id);
    }
  }, [input, word, onComplete]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="min-h-screen p-4 max-w-lg mx-auto flex flex-col justify-center">
      <div className="text-center">
        <p className="text-[var(--dim)] text-base tracking-widest mb-2">PASSWORD CRACKER</p>
        <div className="text-[var(--dim)]">{'═'.repeat(30)}</div>

        {status === 'cracked' ? (
          <div className="my-8">
            <p className="text-[var(--green)] glow-green text-2xl tracking-widest">PASSWORD CRACKED</p>
          </div>
        ) : (
          <div className="my-6">
            <p className="text-[var(--dim)] text-base mb-2">ENCRYPTED:</p>
            <p className="text-[var(--green)] glow-green text-3xl tracking-[0.3em] font-mono mb-6">{scrambled}</p>

            {status === 'wrong' && (
              <p className="text-[var(--red)] glow-red text-base mb-2">WRONG. TRY AGAIN.</p>
            )}

            <p className="text-[var(--dim)] text-base mb-1">{'>'} DECRYPT:</p>
            <div className="flex justify-center items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                maxLength={word.length + 2}
                className="term-input text-2xl tracking-[0.2em] text-center w-56 font-mono"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
              />
            </div>
            <button onClick={handleSubmit} className="term-btn text-lg mt-4">
              {'> '}SUBMIT
            </button>
          </div>
        )}

        <div className="text-[var(--dim)]">{'═'.repeat(30)}</div>
        <button onClick={onCancel} className="term-btn text-base text-[var(--dim)] mt-4">
          {'> '}CANCEL
        </button>
      </div>
    </div>
  );
}
