import { useRef, useCallback, useEffect, useState } from 'react';
import * as Tone from 'tone';
import type { ParsedNote } from '../types/midi';

// Salamander Grand Piano — every ~3 semitones, Tone.Sampler interpolates the rest
const SALAMANDER_BASE = 'https://tonejs.github.io/audio/salamander/';
const SALAMANDER_URLS: Record<string, string> = {
  A0: 'A0.mp3',
  C1: 'C1.mp3', 'D#1': 'Ds1.mp3', 'F#1': 'Fs1.mp3', A1: 'A1.mp3',
  C2: 'C2.mp3', 'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3', A2: 'A2.mp3',
  C3: 'C3.mp3', 'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3', A3: 'A3.mp3',
  C4: 'C4.mp3', 'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3', A4: 'A4.mp3',
  C5: 'C5.mp3', 'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3', A5: 'A5.mp3',
  C6: 'C6.mp3', 'D#6': 'Ds6.mp3', 'F#6': 'Fs6.mp3', A6: 'A6.mp3',
  C7: 'C7.mp3',
};

interface UseSynthReturn {
  /** True once all Salamander samples have loaded */
  loaded: boolean;
  /** Play a single note immediately (for tap tiles) */
  playNote: (note: ParsedNote) => void;
  /** Start a note without scheduling its release (for hold tiles) */
  attackNote: (note: ParsedNote) => void;
  /** Release a held note by name */
  releaseNote: (noteName: string) => void;
  /** Play a note at a precise scheduled time (for Transport-based playback) */
  playNoteScheduled: (note: ParsedNote, time: number) => void;
  /** Ensure AudioContext is running (must be called from a user gesture) */
  resumeContext: () => Promise<void>;
}

export function useSynth(): UseSynthReturn {
  const samplerRef = useRef<Tone.Sampler | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const reverb = new Tone.Reverb({ decay: 1.5, wet: 0.2 }).toDestination();

    const sampler = new Tone.Sampler({
      urls: SALAMANDER_URLS,
      baseUrl: SALAMANDER_BASE,
      release: 1.2,
      onload: () => setLoaded(true),
    }).connect(reverb);

    sampler.volume.value = -6;
    samplerRef.current = sampler;

    return () => {
      sampler.dispose();
      reverb.dispose();
    };
  }, []);

  const resumeContext = useCallback(async () => {
    await Tone.start();
  }, []);

  const playNote = useCallback((note: ParsedNote) => {
    if (!samplerRef.current?.loaded) return;
    const durationSec = Math.max(note.duration, 0.1);
    const velocity = Math.max(note.velocity, 0.3);
    samplerRef.current.triggerAttackRelease(note.name, durationSec, Tone.now(), velocity);
  }, []);

  const attackNote = useCallback((note: ParsedNote) => {
    if (!samplerRef.current?.loaded) return;
    const velocity = Math.max(note.velocity, 0.3);
    samplerRef.current.triggerAttack(note.name, Tone.now(), velocity);
  }, []);

  const releaseNote = useCallback((noteName: string) => {
    if (!samplerRef.current?.loaded) return;
    samplerRef.current.triggerRelease(noteName, Tone.now());
  }, []);

  const playNoteScheduled = useCallback((note: ParsedNote, time: number) => {
    if (!samplerRef.current?.loaded) return;
    const durationSec = Math.max(note.duration, 0.1);
    const velocity = Math.max(note.velocity, 0.3);
    samplerRef.current.triggerAttackRelease(note.name, durationSec, time, velocity);
  }, []);

  return { loaded, playNote, attackNote, releaseNote, playNoteScheduled, resumeContext };
}
