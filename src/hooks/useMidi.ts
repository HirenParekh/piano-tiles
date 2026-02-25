import { useState, useCallback, useRef } from 'react';
import { Midi } from '@tonejs/midi';
import {
  parseMidiFile,
  readFileAsArrayBuffer,
  extractTrackMeta,
  buildTilesFromTracks,
} from '../utils/midiParser';
import type { MidiParseResult, TrackMeta } from '../types/midi';

// The hook has two stages:
//   'idle'            → no file loaded
//   'track-select'    → file parsed, waiting for user to confirm tracks
//   'ready'           → tiles built from selected tracks
//   'error'           → something went wrong

type Stage = 'idle' | 'loading' | 'track-select' | 'ready' | 'error';

interface UseMidiReturn {
  stage: Stage;
  error: string | null;

  // Available after 'track-select'
  tracks: TrackMeta[];
  selectedTracks: Set<number>;
  toggleTrack: (index: number) => void;
  confirmTracks: () => void;

  // Available after 'ready'
  result: MidiParseResult | null;

  loadFile: (file: File) => Promise<void>;
  reset: () => void;
}

export function useMidi(): UseMidiReturn {
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [tracks, setTracks] = useState<TrackMeta[]>([]);
  const [selectedTracks, setSelectedTracks] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<MidiParseResult | null>(null);

  // Keep the raw Midi object in a ref so we don't re-parse on track changes
  const rawMidiRef = useRef<Midi | null>(null);
  const fileNameRef = useRef<string>('');

  const loadFile = useCallback(async (file: File) => {
    if (!file.name.match(/\.midi?$/i)) {
      setError('Please upload a valid MIDI file (.mid or .midi)');
      setStage('error');
      return;
    }

    setStage('loading');
    setError(null);
    setResult(null);

    try {
      const buffer = await readFileAsArrayBuffer(file);
      const parsed = await parseMidiFile(buffer, file.name);

      rawMidiRef.current = parsed.rawMidi;
      fileNameRef.current = parsed.info.name;

      const trackMeta = parsed.tracks;

      // Auto-select piano/keyboard tracks; fall back to all if none found
      const autoSelected = new Set(
        trackMeta.filter((t) => t.autoSelected).map((t) => t.index)
      );
      const initial = autoSelected.size > 0
        ? autoSelected
        : new Set(trackMeta.map((t) => t.index));

      setTracks(trackMeta);
      setSelectedTracks(initial);
      setStage('track-select');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error parsing MIDI file';
      setError(message);
      setStage('error');
    }
  }, []);

  const toggleTrack = useCallback((index: number) => {
    setSelectedTracks((prev) => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  }, []);

  const confirmTracks = useCallback(() => {
    const midi = rawMidiRef.current;
    if (!midi || selectedTracks.size === 0) return;

    const { notes, tiles, totalHeight } = buildTilesFromTracks(midi, tracks, selectedTracks);

    const bpm = midi.header.tempos.length > 0 ? midi.header.tempos[0].bpm : 120;
    const timeSig = midi.header.timeSignatures.length > 0
      ? midi.header.timeSignatures[0].timeSignature : [4, 4];

    setResult({
      info: {
        name: fileNameRef.current,
        durationSeconds: midi.duration,
        bpm: Math.round(bpm),
        timeSignature: [timeSig[0], timeSig[1]] as [number, number],
        trackCount: midi.tracks.length,
        totalNotes: midi.tracks.reduce((s, t) => s + t.notes.length, 0),
      },
      tracks,
      notes,
      tiles,
      totalHeight,
    });

    setStage('ready');
  }, [selectedTracks, tracks]);

  const reset = useCallback(() => {
    rawMidiRef.current = null;
    fileNameRef.current = '';
    setStage('idle');
    setError(null);
    setTracks([]);
    setSelectedTracks(new Set());
    setResult(null);
  }, []);

  return {
    stage,
    error,
    tracks,
    selectedTracks,
    toggleTrack,
    confirmTracks,
    result,
    loadFile,
    reset,
  };
}
