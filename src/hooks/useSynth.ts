import { useRef, useCallback, useEffect, useMemo } from 'react';
import * as Tone from 'tone';
import type { ParsedNote, GameTile } from '../types/midi';
import musicUrls from '../music_urls.json';

/**
 * The filenames in music_urls.json are already named after PT2 pitch names
 * with two encoding rules:
 *   - Sharp notes prefix with 's': "sc1.mp3" = "#c1"
 *   - Uppercase = negative octave: "F-2.mp3" = "F-2"
 * We strip the path and extension to recover the pitch name.
 */
function filenameToPitchName(filename: string): string {
  const stem = filename.replace(/\.mp3$/i, '');
  if (stem.startsWith('s')) {
    return '#' + stem.slice(1);
  }
  return stem;
}

/**
 * Raw Web Audio API Sampler for Zero-Latency Rhythm Game Playback.
 * Replaces Tone.Sampler to avoid main-thread scheduling abstractions.
 * 
 * Updated to match sim-pt2's audio engine:
 *   - Buffers keyed by PT2 pitch name
 *   - Each note fires its own AudioBufferSourceNode directly to destination
 *   - No merging, no gain chains, no release scheduling
 */
class WebAudioSampler {
  context: AudioContext;
  buffers: Map<string, AudioBuffer> = new Map();
  loaded: boolean = false;

  constructor(context: AudioContext) {
    this.context = context;
  }

  async load(urls: Record<string, string>, baseUrl: string, options?: LoadOptions) {
    if (this.loaded) return;
    const total = Object.keys(urls).length;
    let loadedCount = 0;
    const promises = Object.entries(urls).map(async ([_midiKey, fileName]) => {
      const pitchName = filenameToPitchName(fileName);
      try {
        const response = await fetch(`${baseUrl}${fileName}`);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
        this.buffers.set(pitchName, audioBuffer);
      } catch (e) {
        console.error(`Failed to load ${fileName}`, e);
      } finally {
        options?.onFileLoaded?.(++loadedCount, total);
      }
    });
    await Promise.all(promises);
    this.loaded = true;
  }

  bofang(pitchName: string, time?: number) {
    const buffer = this.buffers.get(pitchName);
    if (!buffer) return;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    if (time !== undefined) {
      source.start(time);
    } else {
      source.start();
    }
  }

  static pitchFromNote(note: ParsedNote): string {
    if (note.pt2Notation) {
      return note.pt2Notation.replace(/\[[HIJKLMNOP]*\]$/, '').trim();
    }
    return '';
  }

  playNote(note: ParsedNote, time?: number) {
    const pitch = WebAudioSampler.pitchFromNote(note);
    if (pitch) {
      this.bofang(pitch, time);
    } else {
      this.playByMidi(note.midi, time);
    }
  }

  private playByMidi(midi: number, time?: number) {
    const NOTE_NAMES_LOWER = ['c', '#c', 'd', '#d', 'e', 'f', '#f', 'g', '#g', 'a', '#a', 'b'];
    const NOTE_NAMES_UPPER = ['C', '#C', 'D', '#D', 'E', 'F', '#F', 'G', '#G', 'A', '#A', 'B'];
    const octave = Math.floor(midi / 12) - 4;
    const offset = midi % 12;
    let pitchName: string;
    if (octave < 0) {
      pitchName = `${NOTE_NAMES_UPPER[offset]}${octave}`;
    } else if (octave === 0) {
      pitchName = NOTE_NAMES_LOWER[offset];
    } else {
      pitchName = `${NOTE_NAMES_LOWER[offset]}${octave}`;
    }
    this.bofang(pitchName, time);
  }

  dispose() {
    this.buffers.clear();
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

  const rawContext = Tone.getContext().rawContext as AudioContext;

  useEffect(() => {
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
        samplers[instr] = new WebAudioSampler(rawContext);
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
    sampler.playNote(note);
  }, [rawContext]);

  const attackNote = useCallback((note: ParsedNote) => {
    const sampler = getSampler(note);
    if (!sampler || !sampler.loaded) return;
    sampler.playNote(note);
  }, [rawContext]);

  const releaseNote = useCallback((_note: ParsedNote) => {
    // No-op for sim-pt2 style
  }, []);

  const playNoteScheduled = useCallback((note: ParsedNote, time: number) => {
    const sampler = getSampler(note);
    if (!sampler || !sampler.loaded) return;
    sampler.playNote(note, time);
  }, []);

  const resolveNotes = useCallback((_notes: ParsedNote[]) => {
    // No-op for sim-pt2 style
  }, []);

  const resolveChords = useCallback(async (_gameTiles: GameTile[], _speedMultiplier: number = 1) => {
    // No-op for sim-pt2 style
  }, []);

  const getAudioTime = useCallback(() => rawContext.currentTime, [rawContext]);

  return useMemo(() => ({
    loadInstruments,
    resolveNotes,
    resolveChords: (resolveChords as (gameTiles: any[], speedMultiplier?: number) => Promise<void>),
    playNote,
    attackNote,
    releaseNote,
    playNoteScheduled,
    getAudioTime,
    resumeContext
  }), [
    loadInstruments, 
    resolveNotes, 
    resolveChords, 
    playNote, 
    attackNote, 
    releaseNote, 
    playNoteScheduled, 
    getAudioTime, 
    resumeContext
  ]);
}
