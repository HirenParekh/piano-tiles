/**
 * useCustomSongs.ts
 *
 * Manages user-added songs stored in localStorage.
 * Songs are stored as full JSON objects so they work offline without server changes.
 *
 * Storage key: 'piano-tiles-custom-songs'
 * Format: CustomSong[] (newest first)
 */

import { useState, useCallback } from 'react';

const STORAGE_KEY = 'piano-tiles-custom-songs';

export interface CustomSong {
  /** Unique ID — used to route playback in App.tsx */
  id: string;
  title: string;
  author: string;
  /** The raw Piano Tiles 2 JSON string */
  json: string;
  /** Unix timestamp (ms) when added */
  addedAt: number;
}

function loadFromStorage(): CustomSong[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CustomSong[];
  } catch {
    return [];
  }
}

function saveToStorage(songs: CustomSong[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
}

/**
 * Validates that a JSON string looks like a Piano Tiles 2 song.
 * Returns null on success, or an error string on failure.
 */
export function validateSongJson(jsonStr: string): string | null {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e: any) {
    return `Invalid JSON: ${e.message}`;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return 'JSON must be an object.';
  }
  if (typeof parsed.baseBpm !== 'number') {
    return 'Missing or invalid "baseBpm" field (must be a number).';
  }
  if (!Array.isArray(parsed.musics) || parsed.musics.length === 0) {
    return 'Missing or empty "musics" array.';
  }
  const firstMusic = parsed.musics[0];
  if (!Array.isArray(firstMusic?.scores) || firstMusic.scores.length === 0) {
    return 'First music entry is missing "scores" array.';
  }

  return null;
}

export function useCustomSongs() {
  const [songs, setSongs] = useState<CustomSong[]>(() => loadFromStorage());

  const addSong = useCallback((title: string, author: string, jsonStr: string): string | null => {
    const error = validateSongJson(jsonStr);
    if (error) return error;

    const newSong: CustomSong = {
      id: `custom-${crypto.randomUUID()}`,
      title: title.trim() || 'Custom Song',
      author: author.trim() || 'Unknown Artist',
      json: jsonStr,
      addedAt: Date.now(),
    };

    try {
      const updated = [newSong, ...songs];
      saveToStorage(updated);
      setSongs(updated);
      return null;
    } catch (e: any) {
      if (e?.name === 'QuotaExceededError') {
        return 'Storage is full. Please remove some custom songs before adding new ones.';
      }
      return `Failed to save: ${e.message}`;
    }
  }, [songs]);

  const removeSong = useCallback((id: string): void => {
    const updated = songs.filter(s => s.id !== id);
    saveToStorage(updated);
    setSongs(updated);
  }, [songs]);

  const getSongJson = useCallback((id: string): string | null => {
    return songs.find(s => s.id === id)?.json ?? null;
  }, [songs]);

  return { songs, addSong, removeSong, getSongJson };
}
