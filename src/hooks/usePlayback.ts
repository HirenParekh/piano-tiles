import { useRef, useState, useCallback, useEffect } from 'react';
import * as Tone from 'tone';
import type { ParsedNote } from '../types/midi';

export interface UsePlaybackReturn {
  isPlaying: boolean;
  currentTime: number;
  play: () => Promise<void>;
  pause: () => void;
  stop: () => void;
}

export function usePlayback(
  notes: ParsedNote[],
  durationSeconds: number,
  playNoteScheduled: (note: ParsedNote, time: number) => void,
): UsePlaybackReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const partRef        = useRef<Tone.Part | null>(null);
  const intervalRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const endEventIdRef  = useRef<number | null>(null);

  const clearTicker = () => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  // Rebuild Part whenever the note list changes (new file loaded)
  useEffect(() => {
    partRef.current?.dispose();

    const events: Array<[number, ParsedNote]> = notes.map(n => [n.time, n]);
    // Tone.js Part accepts [time, value] tuples; cast needed due to typing mismatch
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const part = new Tone.Part<ParsedNote>((time, note) => {
      playNoteScheduled(note, time as number);
    }, events as unknown as ParsedNote[]);
    part.start(0);
    partRef.current = part;

    return () => {
      part.dispose();
      partRef.current = null;
      Tone.getTransport().stop();
      if (endEventIdRef.current !== null) {
        Tone.getTransport().clear(endEventIdRef.current);
        endEventIdRef.current = null;
      }
      clearTicker();
      setIsPlaying(false);
      setCurrentTime(0);
    };
  }, [notes, playNoteScheduled]);

  // Cleanup transport on unmount
  useEffect(() => () => {
    Tone.getTransport().stop();
    clearTicker();
  }, []);

  const play = useCallback(async () => {
    await Tone.start();

    // Re-schedule the end-of-song sentinel each time we (re)start
    if (endEventIdRef.current !== null) {
      Tone.getTransport().clear(endEventIdRef.current);
    }
    endEventIdRef.current = Tone.getTransport().scheduleOnce(() => {
      clearTicker();
      setIsPlaying(false);
      setCurrentTime(durationSeconds);
    }, durationSeconds);

    Tone.getTransport().start();
    setIsPlaying(true);

    clearTicker();
    intervalRef.current = setInterval(() => {
      setCurrentTime(Tone.getTransport().seconds);
    }, 200);
  }, [durationSeconds]);

  const pause = useCallback(() => {
    Tone.getTransport().pause();
    clearTicker();
    setIsPlaying(false);
    setCurrentTime(Tone.getTransport().seconds);
  }, []);

  const stop = useCallback(() => {
    Tone.getTransport().stop();
    if (endEventIdRef.current !== null) {
      Tone.getTransport().clear(endEventIdRef.current);
      endEventIdRef.current = null;
    }
    clearTicker();
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  return { isPlaying, currentTime, play, pause, stop };
}
