import { useRef, useCallback, useEffect } from 'react';
import * as Tone from 'tone';
import type { ParsedNote } from '../types/midi';
import musicUrls from '../music_urls.json';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function parseKeyToMidi(key: string): number {
  const match = key.match(/^([A-G]#?)(\d+)$/);
  if (!match) return 60;
  const noteName = match[1];
  const octave = parseInt(match[2], 10);
  const index = NOTE_NAMES.indexOf(noteName);
  return (octave + 1) * 12 + index;
}

/**
 * Raw Web Audio API Sampler for Zero-Latency Rhythm Game Playback.
 * Replaces Tone.Sampler to avoid main-thread scheduling abstractions.
 */
class WebAudioSampler {
  context: AudioContext;
  masterGain: GainNode;
  buffers: Map<number, AudioBuffer> = new Map();
  releaseTime: number;
  activeVoices: Set<{ source: AudioBufferSourceNode; gain: GainNode; name: string; stopTime: number; stopped: boolean }> = new Set();
  loaded: boolean = false;

  constructor(context: AudioContext, targetVolumeDb: number, releaseTime: number = 1.2) {
    this.context = context;
    this.releaseTime = releaseTime;

    // Connect to destination directly for minimum latency 
    this.masterGain = context.createGain();
    const amplitude = Math.pow(10, targetVolumeDb / 20);
    this.masterGain.gain.value = amplitude;
    this.masterGain.connect(context.destination);
  }

  async load(urls: Record<string, string>, baseUrl: string) {
    if (this.loaded) return;
    const promises = Object.entries(urls).map(async ([key, fileName]) => {
      const midi = parseKeyToMidi(key);
      try {
        const response = await fetch(`${baseUrl}${fileName}`);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
        this.buffers.set(midi, audioBuffer);
      } catch (e) {
        console.error(`Failed to load ${fileName}`, e);
      }
    });
    await Promise.all(promises);
    this.loaded = true;
  }

  getNearestBuffer(midi: number): { buffer: AudioBuffer | null, detune: number } {
    if (this.buffers.size === 0) return { buffer: null, detune: 0 };
    if (this.buffers.has(midi)) return { buffer: this.buffers.get(midi)!, detune: 0 };

    let nearest = -1;
    let minDiff = Infinity;
    for (const loadedMidi of this.buffers.keys()) {
      const diff = Math.abs(midi - loadedMidi);
      if (diff < minDiff) {
        minDiff = diff;
        nearest = loadedMidi;
      }
    }
    return { buffer: this.buffers.get(nearest)!, detune: midi - nearest };
  }

  triggerAttack(midi: number, name: string, time: number, velocity: number = 0.8) {
    if (!this.loaded) return;
    const { buffer, detune } = this.getNearestBuffer(midi);
    if (!buffer) return;

    // Direct C++ Native AudioBufferSourceNode allocation (Fastest possible playback)
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    if (detune !== 0) {
      source.playbackRate.value = Math.pow(2, detune / 12);
    }

    const gainNode = this.context.createGain();
    gainNode.gain.setValueAtTime(velocity, time);

    source.connect(gainNode);
    gainNode.connect(this.masterGain);

    source.start(time);

    // Cleanup GC for finished long-notes
    this._cleanupVoices(time);

    const voice = { source, gain: gainNode, name, stopTime: time + buffer.duration, stopped: false };
    this.activeVoices.add(voice);

    source.onended = () => {
      this.activeVoices.delete(voice);
    };
  }

  triggerRelease(name: string, time: number) {
    for (const voice of this.activeVoices) {
      if (voice.name === name && !voice.stopped) {
        voice.stopped = true;
        // Damper pedal fadeout simulation
        voice.gain.gain.cancelScheduledValues(time);
        voice.gain.gain.setValueAtTime(voice.gain.gain.value, time);
        voice.gain.gain.exponentialRampToValueAtTime(0.001, time + this.releaseTime);

        voice.source.stop(time + this.releaseTime + 0.1);
        voice.stopTime = time + this.releaseTime + 0.1;
      }
    }
  }

  triggerAttackRelease(midi: number, name: string, duration: number, time: number, velocity: number = 0.8) {
    this.triggerAttack(midi, name, time, velocity);
    this.triggerRelease(name, time + duration);
  }

  _cleanupVoices(time: number) {
    for (const voice of this.activeVoices) {
      if (voice.stopTime < time) {
        this.activeVoices.delete(voice);
      }
    }
  }

  dispose() {
    this.masterGain.disconnect();
    this.activeVoices.clear();
  }
}

export interface UseSynthReturn {
  loadInstruments: (instruments: string[]) => Promise<void>;
  playNote: (note: ParsedNote) => void;
  attackNote: (note: ParsedNote) => void;
  releaseNote: (note: ParsedNote) => void;
  playNoteScheduled: (note: ParsedNote, time: number) => void;
  resumeContext: () => Promise<void>;
}

export function useSynth(): UseSynthReturn {
  const samplersRef = useRef<Record<string, WebAudioSampler>>({});

  // We explicitly fetch the Web Audio API context powering Tone.js's transport
  // so `usePlayback.ts` remains perfectly in sync with our custom low-latency node.
  const rawContext = Tone.getContext().rawContext as AudioContext;

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      Object.values(samplersRef.current).forEach(s => s.dispose());
    };
  }, []);

  const loadInstruments = useCallback(async (instruments: string[]) => {
    const samplers = samplersRef.current;
    const promises: Promise<void>[] = [];

    for (const instr of instruments) {
      if (samplers[instr] && samplers[instr].loaded) continue;

      const urls = (musicUrls as any)[instr];
      if (!urls) continue;

      if (!samplers[instr]) {
        const release = instr === 'drum' ? 0.5 : 1.2;
        const volDb = instr === 'piano' ? -4 : -2;
        samplers[instr] = new WebAudioSampler(rawContext, volDb, release);
      }

      const baseUrl = `${import.meta.env.BASE_URL}music/${instr}/`;
      promises.push(samplers[instr].load(urls, baseUrl));
    }

    await Promise.all(promises);
  }, [rawContext]);

  const getSampler = (note: ParsedNote) => {
    let instr = note.instrument || 'piano';
    if (!samplersRef.current[instr]) instr = 'piano';
    return samplersRef.current[instr];
  }

  const resumeContext = useCallback(async () => {
    if (rawContext && rawContext.state !== 'running') {
      await rawContext.resume();
    }
    await Tone.start();
  }, [rawContext]);

  const playNote = useCallback((note: ParsedNote) => {
    const sampler = getSampler(note);
    if (!sampler || !sampler.loaded) return;
    const velocity = Math.max(note.velocity, 0.3);
    sampler.triggerAttackRelease(note.midi, note.name, 8, rawContext.currentTime, velocity);
  }, [rawContext]);

  const attackNote = useCallback((note: ParsedNote) => {
    const sampler = getSampler(note);
    if (!sampler || !sampler.loaded) return;
    const velocity = Math.max(note.velocity, 0.3);
    sampler.triggerAttack(note.midi, note.name, rawContext.currentTime, velocity);
  }, [rawContext]);

  const releaseNote = useCallback((note: ParsedNote) => {
    const sampler = getSampler(note);
    if (!sampler || !sampler.loaded) return;
    sampler.triggerRelease(note.name, rawContext.currentTime + 0.1);
  }, [rawContext]);

  const playNoteScheduled = useCallback((note: ParsedNote, time: number) => {
    const sampler = getSampler(note);
    if (!sampler || !sampler.loaded) return;
    const velocity = Math.max(note.velocity, 0.3);
    sampler.triggerAttackRelease(note.midi, note.name, 8, time, velocity);
  }, []);

  return { loadInstruments, playNote, attackNote, releaseNote, playNoteScheduled, resumeContext };
}
