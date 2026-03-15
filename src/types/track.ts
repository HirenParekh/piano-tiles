import type { ParsedNote } from './midi';

// ── Tiles ─────────────────────────────────────────────────────────────────
export type TileType = 'SINGLE' | 'HOLD' | 'DOUBLE';

export interface BaseTile {
    id: string;           // Unique identifier for gameplay mapping
    type: TileType;
    lane: number;         // 0 to 3 (for a 4-lane track)
    rowStart: number;     // Row offset within its parent Card (0-indexed)
    rowSpan: number;      // How many rows (beats) this tile spans
    notes: ParsedNote[];  // All the individual audio notes this tile is responsible for playing
    tapped: boolean;      // Gameplay state
    noteIndices: number[];  // ADD
}

export interface SingleTile extends BaseTile {
    type: 'SINGLE';
    rowSpan: 1;           // Single tiles always span exactly 1 beat/row
}

export interface HoldTile extends BaseTile {
    type: 'HOLD';
    isActive: boolean;    // Is the user currently holding it down?
    isCompleted: boolean; // Did the user successfully hold it to the end?
}

export interface DoubleTile extends BaseTile {
    type: 'DOUBLE';
    rowSpan: 1;
}

export type Tile = SingleTile | HoldTile | DoubleTile;


// ── Cards ─────────────────────────────────────────────────────────────────
export type CardType = 'INFO' | 'START' | 'TILE' | 'FINISH' | 'EMPTY';

export interface BaseCard {
    id: string;
    type: CardType;
    span: number;         // The height of this card in beat-rows. (Default: 1)
}

export interface InfoCard extends BaseCard {
    type: 'INFO';
    title: string;
    author: string;
}

export interface StartCard extends BaseCard {
    type: 'START';
    span: 1;
}

export interface TileCard extends BaseCard {
    type: 'TILE';
    tiles: Tile[];        // Array of all tiles contained within this specific card bounds
}

export interface FinishCard extends BaseCard {
    type: 'FINISH';
    span: 2;              // Finish line usually might take up a larger visual space
}

export interface EmptyCard extends BaseCard {
    type: 'EMPTY';
    // Used for empty beats in a song where nothing spawns
}

export type Card = InfoCard | StartCard | TileCard | FinishCard | EmptyCard;


// ── Track ─────────────────────────────────────────────────────────────────
export interface GameTrackData {
    cards: Card[];
    totalRows: number;    // The total combined beat-rows of the entire track
}
