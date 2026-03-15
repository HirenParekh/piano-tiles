import { useRef, useCallback } from 'react';
import type { Tile } from '../types/track';
import type { ParsedNote } from '../types/midi';

interface Options {
  playNote: (note: ParsedNote) => void;
  attackNote: (note: ParsedNote) => void;
  releaseNote: (note: ParsedNote) => void;
  resumeContext: () => Promise<void>;
  /** Playback speed multiplier (default 1). Can be a ref or a stable value. */
  getSpeed?: () => number;
}

/**
 * Shared audio logic for tapping tiles — used by both GameBoard (via App.tsx)
 * and TileRendererWidget. Keeps a single source of truth for:
 *   - SINGLE tile: play primary note + all co-notes with correct delays
 *   - HOLD tile: attack primary note + play co-starting bass notes immediately
 *   - Hold beat: play secondary-beat notes fired mid-hold by HoldTileCard
 *   - Hold release: release the sustained primary note
 */
export function useTileAudio({
  playNote,
  attackNote,
  releaseNote,
  resumeContext,
  getSpeed = () => 1,
}: Options) {
  const holdTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const heldNoteRef = useRef<ParsedNote | null>(null);

  const handleTileTap = useCallback(async (tile: Tile) => {
    await resumeContext();

    holdTimersRef.current.forEach(clearTimeout);
    holdTimersRef.current = [];

    const speed = getSpeed();
    const isHold = tile.type === 'HOLD';
    const primaryNote = tile.notes[0];
    if (!primaryNote) return;

    if (isHold) {
      attackNote({ ...primaryNote, duration: primaryNote.duration / speed });
      heldNoteRef.current = primaryNote;
      // Play any notes that co-start with the primary (same slot = play simultaneously on tap)
      tile.notes.slice(1).forEach(note => {
        if (Math.abs(note.slotStart - primaryNote.slotStart) < 0.0001) {
          playNote({ ...note, duration: note.duration / speed });
        }
      });
    } else {
      playNote({ ...primaryNote, duration: primaryNote.duration / speed });
      tile.notes.slice(1).forEach(note => {
        const delayMs = Math.round((note.time - primaryNote.time) * 1000 / speed);
        const id = setTimeout(() => playNote({ ...note, duration: note.duration / speed }), delayMs);
        holdTimersRef.current.push(id);
      });
    }
  }, [attackNote, playNote, resumeContext, getSpeed]);

  const handleHoldBeat = useCallback((notes: ParsedNote[]) => {
    const speed = getSpeed();
    notes.forEach(note => playNote({ ...note, duration: note.duration / speed }));
  }, [playNote, getSpeed]);

  const handleHoldRelease = useCallback(() => {
    if (heldNoteRef.current) {
      releaseNote(heldNoteRef.current);
      heldNoteRef.current = null;
    }
    holdTimersRef.current.forEach(clearTimeout);
    holdTimersRef.current = [];
  }, [releaseNote]);

  return { handleTileTap, handleHoldBeat, handleHoldRelease };
}
