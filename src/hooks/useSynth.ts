import { useRef, useCallback, useEffect, useState } from 'react';
import * as Tone from 'tone';
import type { ParsedNote } from '../types/midi';
import musicUrls from '../music_urls.json';

interface UseSynthReturn {
  /** True once all instrument samples have loaded */
  loaded: boolean;
  /** Play a single note immediately (for tap tiles) */
  playNote: (note: ParsedNote) => void;
  /** Start a note without scheduling its release (for hold tiles) */
  attackNote: (note: ParsedNote) => void;
  /** Release a held note by its parsed note reference */
  releaseNote: (note: ParsedNote) => void;
  /** Play a note at a precise scheduled time (for Transport-based playback) */
  playNoteScheduled: (note: ParsedNote, time: number) => void;
  /** Ensure AudioContext is running (must be called from a user gesture) */
  resumeContext: () => Promise<void>;
}

export function useSynth(): UseSynthReturn {
  const samplersRef = useRef<Record<string, Tone.Sampler>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const reverb = new Tone.Reverb({ decay: 1.5, wet: 0.2 }).toDestination();

    const instruments = Object.keys(musicUrls);
    let loadedCount = 0;
    const samplers: Record<string, Tone.Sampler> = {};

    for (const instr of instruments) {
      const sampler = new Tone.Sampler({
        urls: (musicUrls as any)[instr],
        baseUrl: `/music/${instr}/`,
        release: instr === 'drum' ? 0.5 : 1.2,
        onload: () => {
          console.log(`Loaded ${instr} samples`);
          loadedCount++;
          if (loadedCount === instruments.length) {
            setLoaded(true);
          }
        },
        onerror: (err) => {
          console.error(`Failed to load samples for ${instr}:`, err);
        }
      }).connect(reverb);

      sampler.volume.value = instr === 'piano' ? -6 : -4;
      samplers[instr] = sampler;
    }

    samplersRef.current = samplers;

    return () => {
      Object.keys(samplers).forEach(k => samplers[k].dispose());
      reverb.dispose();
    };
  }, []);

  const getSamplerAndLoaded = (note: ParsedNote) => {
    let instr = note.instrument || 'piano';
    if (!samplersRef.current[instr]) instr = 'piano';
    const sampler = samplersRef.current[instr];
    return { sampler, loaded: sampler?.loaded };
  }

  const resumeContext = useCallback(async () => {
    await Tone.start();
  }, []);

  const playNote = useCallback((note: ParsedNote) => {
    const { sampler, loaded } = getSamplerAndLoaded(note);
    if (!loaded) return;
    const velocity = Math.max(note.velocity, 0.3);
    // Allow the MP3 to ring out fully through its natural 7+ second decay.
    // This perfectly emulates SimpleAudioEngine::playEffect used in the original Cocos2d-x PT2.
    sampler.triggerAttackRelease(note.name, 8, Tone.now(), velocity);
  }, []);

  const attackNote = useCallback((note: ParsedNote) => {
    const { sampler, loaded } = getSamplerAndLoaded(note);
    if (!loaded) return;
    const velocity = Math.max(note.velocity, 0.3);
    sampler.triggerAttack(note.name, Tone.now(), velocity);
  }, []);

  const releaseNote = useCallback((note: ParsedNote) => {
    // In PT2, releasing a hold tile does NOT choke the audio immediately; it lets it finish its release tail.
    const { sampler, loaded } = getSamplerAndLoaded(note);
    if (!loaded) return;
    sampler.triggerRelease(note.name, Tone.now() + 0.1);
  }, []);

  const playNoteScheduled = useCallback((note: ParsedNote, time: number) => {
    const { sampler, loaded } = getSamplerAndLoaded(note);
    if (!loaded) return;
    const velocity = Math.max(note.velocity, 0.3);
    sampler.triggerAttackRelease(note.name, 8, time, velocity);
  }, []);

  return { loaded, playNote, attackNote, releaseNote, playNoteScheduled, resumeContext };
}
