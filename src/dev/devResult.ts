import type { MidiParseResult } from '../types/midi';
import { buildResultFromPianoTilesSong, type PianoTilesSong } from '../utils/pianoTilesParser';
import littleStarJson from '../../PianoTilesJAVA/resources/assets/res/song/Little Star.json';

// Default to difficulty 0 (easiest). Change musicIndex to 1 or 2 for harder difficulties.
const MUSIC_INDEX = 0;

export const devResult: MidiParseResult = buildResultFromPianoTilesSong(
  littleStarJson as unknown as PianoTilesSong,
  MUSIC_INDEX,
  'Little Star',
);

export const DEV_SELECTED_TRACKS = new Set([0]);
