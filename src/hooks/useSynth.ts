import { useRef, useCallback, useEffect } from 'react';
import * as Tone from 'tone';
import type { ParsedNote } from '../types/midi';

interface UseSynthReturn {
  /** Play a single note immediately (for tile tap) */
  playNote: (note: ParsedNote) => void;
  /** Play a note at a precise scheduled time (for Transport-based playback) */
  playNoteScheduled: (note: ParsedNote, time: number) => void;
  /** Ensure AudioContext is running (must be called from a user gesture) */
  resumeContext: () => Promise<void>;
}

export function useSynth(): UseSynthReturn {
  // PolySynth so multiple notes can overlap
  const synthRef = useRef<Tone.PolySynth | null>(null);

  useEffect(() => {
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: {
        type: 'triangle',
      },
      envelope: {
        attack: 0.005,
        decay: 0.1,
        sustain: 0.3,
        release: 1.2,
      },
      volume: -6,
    }).toDestination();

    // Slight reverb to make it feel more like a piano in a room
    const reverb = new Tone.Reverb({ decay: 1.5, wet: 0.25 }).toDestination();
    synth.connect(reverb);

    synthRef.current = synth;

    return () => {
      synth.dispose();
      reverb.dispose();
    };
  }, []);

  const resumeContext = useCallback(async () => {
    await Tone.start();
  }, []);

  const playNote = useCallback((note: ParsedNote) => {
    if (!synthRef.current) return;

    const durationSec = Math.max(note.duration, 0.1);
    const velocity = Math.max(note.velocity, 0.3); // min velocity so quiet notes still sound

    synthRef.current.triggerAttackRelease(
      note.name,
      durationSec,
      Tone.now(),
      velocity
    );
  }, []);

  const playNoteScheduled = useCallback((note: ParsedNote, time: number) => {
    if (!synthRef.current) return;
    const durationSec = Math.max(note.duration, 0.1);
    const velocity = Math.max(note.velocity, 0.3);
    synthRef.current.triggerAttackRelease(note.name, durationSec, time, velocity);
  }, []);

  return { playNote, playNoteScheduled, resumeContext };
}
