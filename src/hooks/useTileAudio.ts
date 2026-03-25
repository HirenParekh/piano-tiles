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
  playNoteScheduled?: (note: ParsedNote, time: number) => void;
  getAudioTime?: () => number;
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
  playNoteScheduled,
  getAudioTime,
}: Options) {
  const holdTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const heldNoteRef = useRef<ParsedNote | null>(null);
  // Tracks how many taps have fired for each double-tile pair (keyed by shared pairNotes ref).
  const doublePairTapRef = useRef<WeakMap<ParsedNote[], number>>(new WeakMap());
  // Tracks the Web Audio time when note 0 of each pair was tapped, for scheduling note 1.
  const doubleFirstTapTimeRef = useRef<WeakMap<ParsedNote[], number>>(new WeakMap());

  const handleTileTap = useCallback(async (tile: Tile) => {
    await resumeContext();

    holdTimersRef.current.forEach(clearTimeout);
    holdTimersRef.current = [];

    const speed = getSpeed();

    // Double tiles play sequentially: first tap → pairNotes[0], second tap → pairNotes[1],
    // regardless of which physical tile (left or right) was tapped.
    // The second note is always scheduled at firstTapTime + note0.duration/speed so it
    // plays after the correct beat gap even when both tiles are tapped simultaneously.
    if (tile.type === 'DOUBLE') {
      const pairNotes = tile.pairNotes;
      const tapIndex = doublePairTapRef.current.get(pairNotes) ?? 0;
      const noteToPlay = pairNotes[tapIndex];
      if (noteToPlay) {
        if (tapIndex === 0) {
          playNote({ ...noteToPlay, duration: noteToPlay.duration / speed });
          if (getAudioTime) doubleFirstTapTimeRef.current.set(pairNotes, getAudioTime());
        } else {
          const firstTapTime = doubleFirstTapTimeRef.current.get(pairNotes) ?? 0;
          const note0Duration = (pairNotes[0]?.duration ?? 0) / speed;
          const scheduledTime = Math.max(
            getAudioTime ? getAudioTime() : 0,
            firstTapTime + note0Duration
          );
          if (playNoteScheduled) {
            playNoteScheduled({ ...noteToPlay, duration: noteToPlay.duration / speed }, scheduledTime);
          } else {
            playNote({ ...noteToPlay, duration: noteToPlay.duration / speed });
          }
        }
      }
      doublePairTapRef.current.set(pairNotes, tapIndex + 1);
      return;
    }

    const isHold = tile.type === 'HOLD';
    const primaryNote = tile.notes[0];
    if (!primaryNote) return;

    if (isHold) {
      attackNote({ ...primaryNote, duration: primaryNote.duration / speed });
      heldNoteRef.current = primaryNote;
      // Play any notes that co-start with the primary (same slot = play simultaneously on tap)
      // BUT SKIP if they are already baked into the mergedBuffer!
      if (!primaryNote.mergedBuffer) {
        tile.notes.slice(1).forEach(note => {
          if (Math.abs(note.slotStart - primaryNote.slotStart) < 0.0001) {
            playNote({ ...note, duration: note.duration / speed });
          }
        });
      }
    } else if (tile.type === 'ARPEGGIO') {
      // Notes have staggered arpeggioDelayS — fire each with a setTimeout offset.
      // The first note always has delayMs=0 and plays immediately.
      tile.notes.forEach(note => {
        const delayMs = Math.round((note.time - primaryNote.time) * 1000 / speed);
        if (delayMs === 0) {
          playNote({ ...note, duration: note.duration / speed });
        } else {
          const id = setTimeout(() => playNote({ ...note, duration: note.duration / speed }), delayMs);
          holdTimersRef.current.push(id);
        }
      });
    } else {
      // SINGLE: if pre-merged chord buffer exists, play once; else play each note separately.
      if (tile.notes.length > 1 && tile.notes[0]?.mergedBuffer) {
        playNote({ ...tile.notes[0], duration: tile.notes[0].duration / speed });
      } else {
        tile.notes.forEach(note => playNote({ ...note, duration: note.duration / speed }));
      }
    }
  }, [attackNote, playNote, resumeContext, getSpeed, playNoteScheduled, getAudioTime]);

  const handleHoldBeat = useCallback((_notes: ParsedNote[]) => {
    // Secondary beat notes are now baked into the pre-merged hold buffer
    // triggered at tap-start. We only emit this for visual/score effects.
  }, []);

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
