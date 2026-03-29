/**
 * AudioSystem.ts
 *
 * Manages low-latency audio playback for the Phaser scene.
 * Replaces the React-based `useSynth` hook to eliminate framework boundary
 * latency and keep game logic self-contained.
 */

import Phaser from 'phaser';
import type { ParsedNote, GameTile } from '../../types/midi';
import musicUrls from '../../music_urls.json';

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
 * Encapsulates one instrument's sample set and playback logic.
 * Uses raw Web Audio API nodes for minimum latency.
 */
class InstrumentSampler {
  context: AudioContext;
  masterGain: GainNode;
  buffers: Map<number, AudioBuffer> = new Map();
  releaseTime: number;
  activeVoices: Set<{ source: AudioBufferSourceNode; gain: GainNode; name: string; stopTime: number; stopped: boolean }> = new Set();
  loaded: boolean = false;

  constructor(context: AudioContext, targetVolumeDb: number, releaseTime: number = 1.2) {
    this.context = context;
    this.releaseTime = releaseTime;
    this.masterGain = context.createGain();
    const amplitude = Math.pow(10, targetVolumeDb / 20);
    this.masterGain.gain.value = amplitude;
    this.masterGain.connect(context.destination);
  }

  async loadSamples(instrument: string, baseUrl: string) {
    if (this.loaded) return;
    const urls = (musicUrls as any)[instrument];
    if (!urls) {
      return;
    }

    const promises = Object.entries(urls).map(async ([key, fileName]) => {
      const midi = parseKeyToMidi(key);
      const url = `${baseUrl}${fileName}`;
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
        this.buffers.set(midi, audioBuffer);
      } catch (e) {
        console.error(`[AudioSystem] Failed to load ${url}:`, e);
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
    const buffer = note.mergedBuffer ?? note.buffer ?? this.buffers.get(note.midi);
    if (!buffer) {
      return;
    }

    const source = this.context.createBufferSource();
    source.buffer = buffer;

    const gainNode = this.context.createGain();
    gainNode.gain.setValueAtTime(velocity, time);

    source.connect(gainNode);
    gainNode.connect(this.masterGain);
    source.start(time);

    const voice = { source, gain: gainNode, name: note.name, stopTime: time + buffer.duration, stopped: false };
    this.activeVoices.add(voice);
    source.onended = () => this.activeVoices.delete(voice);
  }

  triggerRelease(note: ParsedNote, time: number) {
    const name = note.name;
    for (const voice of this.activeVoices) {
      if (voice.name === name && !voice.stopped) {
        voice.stopped = true;
        voice.gain.gain.cancelScheduledValues(time);
        voice.gain.gain.setValueAtTime(voice.gain.gain.value, time);
        voice.gain.gain.exponentialRampToValueAtTime(0.001, time + this.releaseTime);
        voice.source.stop(time + this.releaseTime + 0.1);
        voice.stopTime = time + this.releaseTime + 0.1;
      }
    }
  }

  destroy() {
    this.masterGain.disconnect();
    this.activeVoices.forEach(v => v.source.stop());
    this.activeVoices.clear();
  }
}

export class AudioSystem {
  private samplers: Record<string, InstrumentSampler> = {};
  private context: AudioContext;

  /**
   * Tracks the first tap time and note duration for each in-flight double-tile pair.
   * Key = Math.round(note.time * 10000) — unique per slotStart since both tiles
   * in a pair share the same note.time value.
   *
   * WHY: double tiles must play in rhythmic sequence even when tapped simultaneously.
   * Without this, both notes fire at context.currentTime (the same moment), which
   * loses the intended rhythmic gap between the two notes.
   * The second note is scheduled at max(now, firstTapTime + note0.duration) so it
   * always falls at or after the correct musical position — matching useTileAudio.ts.
   */
  private doublePairState: Map<number, { firstTapTime: number; note0Duration: number }> = new Map();

  constructor(scene: Phaser.Scene) {
    // @ts-ignore - Phaser 3 uses WebAudio context if available
    this.context = scene.sound.context;
  }

  async resume() {
    if (this.context && this.context.state === 'suspended') {
      await this.context.resume();
    }
  }

  async loadSongAssets(tiles: GameTile[], speedMultiplier: number = 1) {
    const instruments = Array.from(new Set(tiles.flatMap(t => t.notes.map(n => n.instrument || 'piano'))));
    if (instruments.length === 0) instruments.push('piano');

    const baseUrlTemplate = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/music/`;

    const loadPromises = instruments.map(async (instr) => {
      if (!this.samplers[instr]) {
        const release = instr === 'drum' ? 0.5 : 1.2;
        const volDb = instr === 'piano' ? -4 : -2;
        this.samplers[instr] = new InstrumentSampler(this.context, volDb, release);
      }
      await this.samplers[instr].loadSamples(instr, `${baseUrlTemplate}${instr}/`);
    });

    await Promise.all(loadPromises);

    // Resolve buffers and merge chords/holds
    const notes = tiles.flatMap(t => t.notes);
    for (const instr of Object.keys(this.samplers)) {
      const instrNotes = notes.filter(n => (n.instrument || 'piano') === instr);
      this.samplers[instr].resolveNotes(instrNotes);
    }

    const mergePromises = tiles.map(async (tile) => {
      // Find all notes that start at the exact same moment as the primary note.
      const firstTime = tile.notes[0]?.time;
      const initialChordNotes = tile.notes.filter(n => n.time === firstTime);

      // If there's an initial chord (2+ notes starting at once), merge them.
      // This allows hold tiles starting with a chord to play fully on tap.
      if (initialChordNotes.length < 2) return;

      const instr = initialChordNotes[0].instrument || 'piano';
      const sampler = this.samplers[instr];
      if (sampler) await sampler.mergeNotes(initialChordNotes, speedMultiplier);
    });

    await Promise.all(mergePromises);
  }

  async playNote(tile: GameTile) {
    await this.resume();

    const note = tile.notes[0];
    if (!note) return;
    const instr = note.instrument || 'piano';
    const sampler = this.samplers[instr];
    if (!sampler) return;

    const velocity = Math.max(note.velocity, 0.3);

    // ── Double-tile rhythmic sequencing ──────────────────────────────────────
    // Both tiles in a double pair share the same note.time (= identical slotStart).
    // Key off that value to match the two physical taps to the same pair entry.
    if (note.tileType === 'DOUBLE') {
      // Round to 0.1 ms precision — floats with the same slotStart can have tiny
      // rounding differences after multiplication, so we snap to a stable key.
      const pairKey = Math.round(note.time * 10000);
      const existing = this.doublePairState.get(pairKey);

      if (!existing) {
        // First tap: play immediately and record when + how long tile 0 lasts.
        const playTime = this.context.currentTime;
        sampler.triggerAttack(note, playTime, velocity);
        sampler.triggerRelease(note, playTime + 8);
        this.doublePairState.set(pairKey, { firstTapTime: playTime, note0Duration: note.duration });
        // Safety cleanup: if the second tile is never tapped, remove stale state after 5s
        setTimeout(() => this.doublePairState.delete(pairKey), 5000);
      } else {
        // Second tap: schedule at the rhythmically correct position.
        // max(now, firstTapTime + note0Duration) ensures we never go backwards in
        // audio time while still respecting the musical gap.
        const scheduledTime = Math.max(
          this.context.currentTime,
          existing.firstTapTime + existing.note0Duration,
        );
        sampler.triggerAttack(note, scheduledTime, velocity);
        sampler.triggerRelease(note, scheduledTime + 8);
        this.doublePairState.delete(pairKey);
      }
      return;
    }

    // ── Normal (non-double) tile ───────────────────────────────────────────
    sampler.triggerAttack(note, this.context.currentTime, velocity);
    sampler.triggerRelease(note, this.context.currentTime + 8);
  }

  async attackHold(tile: GameTile) {
    await this.resume();
    const note = tile.notes[0];
    if (!note) return;
    const instr = note.instrument || 'piano';
    const sampler = this.samplers[instr];
    if (sampler) {
      sampler.triggerAttack(note, this.context.currentTime, Math.max(note.velocity, 0.3));
    }
  }

  releaseHold(tile: GameTile) {
    const note = tile.notes[0];
    if (!note) return;
    const instr = note.instrument || 'piano';
    const sampler = this.samplers[instr];
    if (sampler) {
      sampler.triggerRelease(note, this.context.currentTime + 0.1);
    }
  }

  async playHoldBeat(notes: ParsedNote[]) {
    await this.resume();
    // Ported from handleHoldBeat logic
    for (const note of notes) {
      const instr = note.instrument || 'piano';
      const sampler = this.samplers[instr];
      if (sampler) {
        sampler.triggerAttack(note, this.context.currentTime, Math.max(note.velocity, 0.3));
        sampler.triggerRelease(note, this.context.currentTime + 0.5); // Short pulse
      }
    }
  }

  destroy() {
    Object.values(this.samplers).forEach(s => s.destroy());
    this.samplers = {};
  }
}
