/**
 * AudioSystem.ts  — sim-pt2-style audio engine
 *
 * Ported directly from sim-pt2's `bofang()` / `bf()` approach:
 *   - Buffers are keyed by PT2 pitch name (e.g. "c1", "#f2", "F-2")
 *   - Each note fires its own AudioBufferSourceNode directly to destination
 *   - No merging, no gain chains, no release scheduling
 *   - Chords / co-starting notes loop and fire simultaneously
 *
 * This guarantees identical audio behaviour to the reference simulator.
 */

import Phaser from 'phaser';
import type { ParsedNote, GameTile } from '../../types/midi';
import musicUrls from '../../music_urls.json';

// ── Pitch name helpers ────────────────────────────────────────────────────────
// PT2 pitch names use the same filenames as our /public/music/piano/ samples.
// The music_urls.json maps "C4" → "c1.mp3", "C#4" → "sc1.mp3", etc.
// We build a reverse map: filename-stem → AudioBuffer, keyed by PT2 pitch name.

/** Map from PT2 pitch name (e.g. "c1", "#f2", "F-2") → AudioBuffer */
type PitchBufferMap = Map<string, AudioBuffer>;

/**
 * The filenames in music_urls.json are already named after PT2 pitch names
 * with two encoding rules:
 *   - Sharp notes prefix with 's': "sc1.mp3" = "#c1"
 *   - Uppercase = negative octave: "F-2.mp3" = "F-2"
 * We strip the path and extension to recover the pitch name.
 */
function filenameToPitchName(filename: string): string {
  // Remove .mp3 extension
  const stem = filename.replace(/\.mp3$/i, '');
  // 's' prefix → '#' sharp prefix (e.g. "sc1" → "#c1", "sC-2" → "#C-2")
  if (stem.startsWith('s')) {
    return '#' + stem.slice(1);
  }
  return stem;
}

// ── InstrumentSampler ─────────────────────────────────────────────────────────

class InstrumentSampler {
  private context: AudioContext;
  private buffers: PitchBufferMap = new Map();
  public loaded = false;

  constructor(context: AudioContext) {
    this.context = context;
  }

  async loadSamples(instrument: string, baseUrl: string) {
    if (this.loaded) return;
    const urls = (musicUrls as Record<string, Record<string, string>>)[instrument];
    if (!urls) return;

    const promises = Object.entries(urls).map(async ([_midiKey, filename]) => {
      const pitchName = filenameToPitchName(filename);
      const url = `${baseUrl}${filename}`;
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
        this.buffers.set(pitchName, audioBuffer);
      } catch (e) {
        console.error(`[AudioSystem] Failed to load ${url}:`, e);
      }
    });

    await Promise.all(promises);
    this.loaded = true;
  }

  /**
   * Play a single pitch immediately — direct port of sim-pt2's bofang().
   * Creates a BufferSourceNode, connects directly to destination, starts it.
   * No gain, no release, no merging — the buffer decays naturally.
   *
   * @param pitchName PT2 pitch string e.g. "c1", "#f2", "F-2"
   */
  bofang(pitchName: string) {
    const buffer = this.buffers.get(pitchName);
    if (!buffer) return; // note not in this instrument's range — silently skip
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    source.start();
  }

  /**
   * Extract the bare PT2 pitch name from a ParsedNote's pt2Notation field.
   * pt2Notation looks like "c1[L]", "#f2[KL]", "F-2[L]".
   * We strip the bracket suffix.
   */
  private static pitchFromNote(note: ParsedNote): string {
    // pt2Notation = "<pitchName>[<brackets>]"  e.g. "c1[L]" or "#f2[KL]"
    if (note.pt2Notation) {
      return note.pt2Notation.replace(/\[[HIJKLMNOP]*\]$/, '').trim();
    }
    // Fallback: derive from note.name (Tone.js format "C4") — less accurate for negative octaves
    return '';
  }

  /** Play a ParsedNote using its PT2 pitch name (bofang equivalent). */
  playNote(note: ParsedNote) {
    const pitch = InstrumentSampler.pitchFromNote(note);
    if (pitch) {
      this.bofang(pitch);
    } else {
      // Fallback: try to find buffer by MIDI number if pt2Notation is unavailable
      // (e.g. notes created by the Editor which don't carry pt2Notation)
      this.playByMidi(note.midi);
    }
  }

  /** Fallback: find the closest loaded buffer by MIDI number. */
  private playByMidi(midi: number) {
    // Build a quick MIDI→pitchName lookup on first call
    // (simple brute-force — only used for editor-generated notes without pt2Notation)
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
    this.bofang(pitchName);
  }

  destroy() {
    this.buffers.clear();
  }
}

// ── AudioSystem ───────────────────────────────────────────────────────────────

export class AudioSystem {
  private samplers: Record<string, InstrumentSampler> = {};
  private context: AudioContext;

  /**
   * Tracks first-tap time for double-tile rhythmic sequencing.
   * Key = Math.round(note.time * 10000) — unique per slotStart.
   */
  private doublePairState: Map<number, { firstTapTime: number; note0Duration: number }> = new Map();

  constructor(scene: Phaser.Scene) {
    // @ts-ignore — Phaser 3 exposes the underlying AudioContext here
    this.context = scene.sound.context;
  }

  async resume() {
    if (this.context?.state === 'suspended') {
      await this.context.resume();
    }
  }

  // ── Asset loading ─────────────────────────────────────────────────────────

  async loadSongAssets(tiles: GameTile[], _speedMultiplier: number = 1) {
    // Collect unique instruments required by this song
    const instruments = Array.from(
      new Set(tiles.flatMap(t => t.notes.map(n => n.instrument || 'piano')))
    );
    if (instruments.length === 0) instruments.push('piano');

    const base = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/music/`;

    await Promise.all(
      instruments.map(async (instr) => {
        if (!this.samplers[instr]) {
          this.samplers[instr] = new InstrumentSampler(this.context);
        }
        await this.samplers[instr].loadSamples(instr, `${base}${instr}/`);
      })
    );

    // No resolveNotes / mergeNotes needed — we play directly by pitch name on tap.
  }

  // ── Playback ──────────────────────────────────────────────────────────────

  /**
   * Play all notes in a tile immediately.
   * Mirrors sim-pt2: each pitch fires its own buffer independently.
   */
  async playNote(tile: GameTile) {
    await this.resume();

    const primaryNote = tile.notes[0];
    if (!primaryNote) return;

    // ── Double-tile rhythmic sequencing ──────────────────────────────────────
    if (primaryNote.tileType === 'DOUBLE') {
      const pairKey = Math.round(primaryNote.time * 10000);
      const existing = this.doublePairState.get(pairKey);

      if (!existing) {
        // First tap — play immediately
        this._playNoteNow(primaryNote);
        const playTime = this.context.currentTime;
        this.doublePairState.set(pairKey, {
          firstTapTime: playTime,
          note0Duration: primaryNote.duration,
        });
        setTimeout(() => this.doublePairState.delete(pairKey), 5000);
      } else {
        // Second tap — schedule after first note's duration
        const gap = existing.firstTapTime + existing.note0Duration - this.context.currentTime;
        if (gap > 0) {
          setTimeout(() => this._playNoteNow(primaryNote), gap * 1000);
        } else {
          this._playNoteNow(primaryNote);
        }
        this.doublePairState.delete(pairKey);
      }
      return;
    }

    // ── Normal tile: play every note in the tile (sim-pt2 fires all pitches) ─
    for (const note of tile.notes) {
      this._playNoteNow(note);
    }
  }

  /** Attack a hold tile — play all co-starting notes immediately. */
  async attackHold(tile: GameTile) {
    await this.resume();
    // For holds, play all notes that start at the same time as the primary.
    // Notes baked in later (beat dots) are handled by playHoldBeat.
    const primaryTime = tile.notes[0]?.time ?? 0;
    for (const note of tile.notes) {
      if (Math.abs(note.time - primaryTime) < 0.001) {
        this._playNoteNow(note);
      }
    }
  }

  /** Release a hold tile — no-op in sim-pt2 style (buffer decays naturally). */
  releaseHold(_tile: GameTile) {
    // sim-pt2 does not implement manual release — the sample decays on its own.
  }

  /** Play beat-dot notes mid-hold. */
  async playHoldBeat(notes: ParsedNote[]) {
    await this.resume();
    for (const note of notes) {
      this._playNoteNow(note);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Fire a single note's buffer — equivalent to sim-pt2's bofang(). */
  private _playNoteNow(note: ParsedNote) {
    const instr = note.instrument || 'piano';
    const sampler = this.samplers[instr] ?? this.samplers['piano'];
    if (sampler?.loaded) sampler.playNote(note);
  }

  destroy() {
    Object.values(this.samplers).forEach(s => s.destroy());
    this.samplers = {};
  }
}
