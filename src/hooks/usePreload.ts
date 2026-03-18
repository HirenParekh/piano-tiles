import { useState, useEffect, useCallback, useRef } from 'react';
import type { LoadOptions } from './useSynth';
import musicUrls from '../music_urls.json';

export interface PreloadState {
  progress: number;
  statusMessage: string;
  isComplete: boolean;
  error: string | null;
  retry: () => void;
}

const pianoCnt = Object.keys(musicUrls.piano).length;
const bassCnt = Object.keys((musicUrls as any).bass ?? {}).length;

// Progress ranges:
//  0– 5%  song catalog (instant)
//  5–10%  audio engine init
// 10–90%  piano samples (80% range)
// 90–100% bass samples (10% range)
const PIANO_START = 10;
const PIANO_RANGE = 80;
const BASS_START = 90;
const BASS_RANGE = 10;

export function usePreload(
  loadInstruments: (instruments: string[], options?: LoadOptions) => Promise<void>
): PreloadState {
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function attemptLoad() {
      try {
        if (!mountedRef.current || cancelled) return;
        setError(null);
        setIsComplete(false);

        // Step 1: song catalog (static import — already available)
        setProgress(0);
        setStatusMessage('Loading songs...');
        await new Promise<void>(r => setTimeout(r, 0)); // yield to paint
        if (cancelled) return;
        setProgress(5);

        // Step 2: audio engine init (Tone context is already created by useSynth)
        setStatusMessage('Initializing audio engine...');
        await new Promise<void>(r => setTimeout(r, 0));
        if (cancelled) return;
        setProgress(10);

        // Step 3: piano samples
        let pianoLoaded = 0;
        setStatusMessage(`Loading piano samples (0/${pianoCnt})...`);
        await loadInstruments(['piano'], {
          onFileLoaded: (loaded) => {
            if (cancelled || !mountedRef.current) return;
            pianoLoaded = loaded;
            const pct = PIANO_START + Math.round((loaded / pianoCnt) * PIANO_RANGE);
            setProgress(pct);
            setStatusMessage(`Loading piano samples (${loaded}/${pianoCnt})...`);
          },
        });
        if (cancelled) return;
        void pianoLoaded;
        setProgress(BASS_START);

        // Step 4: bass samples (if available)
        if (bassCnt > 0) {
          setStatusMessage('Loading bass samples...');
          await loadInstruments(['bass'], {
            onFileLoaded: (loaded) => {
              if (cancelled || !mountedRef.current) return;
              const pct = BASS_START + Math.round((loaded / bassCnt) * BASS_RANGE);
              setProgress(pct);
            },
          });
          if (cancelled) return;
        }

        setProgress(100);
        setStatusMessage('Ready');
        setIsComplete(true);
      } catch (err) {
        if (!cancelled && mountedRef.current) {
          setError(err instanceof Error ? err.message : 'Loading failed');
        }
      }
    }

    attemptLoad();
    return () => { cancelled = true; };
  }, [loadInstruments, attempt]);

  const retry = useCallback(() => {
    setProgress(0);
    setStatusMessage('');
    setError(null);
    setIsComplete(false);
    setAttempt(a => a + 1);
  }, []);

  return { progress, statusMessage, isComplete, error, retry };
}
