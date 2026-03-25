import { useRef, useCallback, useEffect } from 'react';
import * as Tone from 'tone';
import type { ParsedNote, GameTile } from '../types/midi';
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

  async load(urls: Record<string, string>, baseUrl: string, options?: LoadOptions) {
    if (this.loaded) return;
    const total = Object.keys(urls).length;
    let loadedCount = 0;
    const promises = Object.entries(urls).map(async ([key, fileName]) => {
      const midi = parseKeyToMidi(key);
      try {
        const response = await fetch(`${baseUrl}${fileName}`);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
        this.buffers.set(midi, audioBuffer);
      } catch (e) {
        console.error(`Failed to load ${fileName}`, e);
      } finally {
        options?.onFileLoaded?.(++loadedCount, total);
      }
    });
    await Promise.all(promises);
    this.loaded = true;
  }

  resolveNotes(notes: ParsedNote[]) {
    for (const note of notes) {
      const buf = this.buffers.get(note.midi);
      if (buf) note.buffer = buf;
    }
  }

  async mergeNotes(notes: ParsedNote[], speedMultiplier = 1): Promise<void> {
    const buffers = notes.map(n => n.buffer).filter(Boolean) as AudioBuffer[];
    if (buffers.length < 1) return;

    const baseTimeForTile = notes[0].time;
    let maxEnd = 0;
    for (const note of notes) {
      if (!note.buffer) continue;
      const offset = (note.time - baseTimeForTile) / speedMultiplier;
      maxEnd = Math.max(maxEnd, offset + note.buffer.duration);
    }

    const sampleRate = buffers[0].sampleRate;
    const channels = Math.max(...buffers.map(b => b.numberOfChannels));
    const offline = new OfflineAudioContext(channels, Math.ceil(maxEnd * sampleRate), sampleRate);

    for (const note of notes) {
      if (!note.buffer) continue;
      const src = offline.createBufferSource();
      src.buffer = note.buffer;
      src.connect(offline.destination);
      const offset = (note.time - baseTimeForTile) / speedMultiplier;
      src.start(offset);
    }

    notes[0].mergedBuffer = await offline.startRendering();
  }

  triggerAttack(note: ParsedNote, time: number, velocity: number = 0.8) {
    if (!this.loaded) return;
    const buffer = note.mergedBuffer ?? note.buffer ?? this.buffers.get(note.midi);
    if (!buffer) return;

    // Direct C++ Native AudioBufferSourceNode allocation (Fastest possible playback)
    const source = this.context.createBufferSource();
    source.buffer = buffer;

    const gainNode = this.context.createGain();
    gainNode.gain.setValueAtTime(velocity, time);

    source.connect(gainNode);
    gainNode.connect(this.masterGain);

    source.start(time);

    // Cleanup GC for finished long-notes
    this._cleanupVoices(time);

    const voice = { source, gain: gainNode, name: note.name, stopTime: time + buffer.duration, stopped: false };
    this.activeVoices.add(voice);

    source.onended = () => {
      this.activeVoices.delete(voice);
    };
  }

  triggerRelease(note: ParsedNote, time: number) {
    const name = note.name;
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

  triggerAttackRelease(note: ParsedNote, duration: number, time: number, velocity: number = 0.8) {
    this.triggerAttack(note, time, velocity);
    this.triggerRelease(note, time + duration);
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

export interface LoadOptions {
  onFileLoaded?: (loaded: number, total: number) => void;
}

export interface UseSynthReturn {
  loadInstruments: (instruments: string[], options?: LoadOptions) => Promise<void>;
  resolveNotes: (notes: ParsedNote[]) => void;
  resolveChords: (gameTiles: GameTile[]) => Promise<void>;
  playNote: (note: ParsedNote) => void;
  attackNote: (note: ParsedNote) => void;
  releaseNote: (note: ParsedNote) => void;
  playNoteScheduled: (note: ParsedNote, time: number) => void;
  getAudioTime: () => number;
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
      samplersRef.current = {};
    };
  }, []);

  const loadInstruments = useCallback(async (instruments: string[], options?: LoadOptions) => {
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

      const baseUrl = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/music/${instr}/`;
      promises.push(samplers[instr].load(urls, baseUrl, options));
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
    sampler.triggerAttackRelease(note, 8, rawContext.currentTime, velocity);
  }, [rawContext]);

  const attackNote = useCallback((note: ParsedNote) => {
    const sampler = getSampler(note);
    if (!sampler || !sampler.loaded) return;
    const velocity = Math.max(note.velocity, 0.3);
    sampler.triggerAttack(note, rawContext.currentTime, velocity);
  }, [rawContext]);

  const releaseNote = useCallback((note: ParsedNote) => {
    const sampler = getSampler(note);
    if (!sampler || !sampler.loaded) return;
    sampler.triggerRelease(note, rawContext.currentTime + 0.1);
  }, [rawContext]);

  const playNoteScheduled = useCallback((note: ParsedNote, time: number) => {
    const sampler = getSampler(note);
    if (!sampler || !sampler.loaded) return;
    const velocity = Math.max(note.velocity, 0.3);
    sampler.triggerAttackRelease(note, 8, time, velocity);
  }, []);

  const resolveNotes = useCallback((notes: ParsedNote[]) => {
    const samplers = samplersRef.current;
    for (const instr of Object.keys(samplers)) {
      const instrNotes = notes.filter(n => (n.instrument || 'piano') === instr);
      if (instrNotes.length > 0) samplers[instr].resolveNotes(instrNotes);
    }
  }, []);

  const resolveChords = useCallback(async (gameTiles: GameTile[], speedMultiplier = 1) => {
    const promises: Promise<void>[] = [];
    for (const tile of gameTiles) {
      if (tile.notes.length < 2) continue;
      const instr = tile.notes[0].instrument || 'piano';
      const sampler = samplersRef.current[instr];
      if (sampler) promises.push(sampler.mergeNotes(tile.notes, speedMultiplier));
    }
    await Promise.all(promises);
  }, []);

  const getAudioTime = useCallback(() => rawContext.currentTime, [rawContext]);

  return { loadInstruments, resolveNotes, resolveChords, playNote, attackNote, releaseNote, playNoteScheduled, getAudioTime, resumeContext };
}
