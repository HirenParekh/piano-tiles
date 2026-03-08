import type { MidiParseResult } from '../types/midi';
import { buildResultFromPianoTilesSong, type PianoTilesSong } from '../utils/pianoTilesParser';
import jingleBellsJson from '../../PianoTilesJAVA/resources/assets/res/song/Jingle Bells.json';

// Default to difficulty 0 (easiest). Change musicIndex to 1 or 2 for harder difficulties.
const MUSIC_INDEX = 0;

export const devResult: MidiParseResult = buildResultFromPianoTilesSong(
  jingleBellsJson as unknown as PianoTilesSong,
  MUSIC_INDEX,
  'Jingle Bells',
);

export const DEV_SELECTED_TRACKS = new Set([0]);
