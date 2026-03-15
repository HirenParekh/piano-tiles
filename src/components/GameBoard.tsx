/**
 * GameBoard — thin orchestrator component.
 *
 * RESPONSIBILITY:
 *   1. Run useGameBoardEngine to get all game state (timing, scroll, tapped tiles, …)
 *   2. Choose which visual skin to render based on the `skin` prop
 *   3. Forward the engine + audio callbacks to the chosen skin
 *
 * Adding a new skin:
 *   1. Create a new *Skin component that accepts GameBoardSkinProps
 *   2. Add its name to the GameBoardSkin union type
 *   3. Add a branch here in GameBoard
 *
 * WHY the engine is created here (not inside each skin):
 *   The engine sets up DOM refs (scrollRef) and rAF loops that must survive
 *   across skin switches. If the engine lived inside the skin, switching skins
 *   would unmount and remount it, resetting scroll state mid-game.
 */

import type { MidiParseResult, ParsedNote } from '../types/midi';
import type { Tile } from '../types/track';
import { useGameBoardEngine } from '../hooks/useGameBoardEngine';
import { GameBoardClassicSkin } from './GameBoardClassicSkin';
import { GameBoardDebugSkin } from './GameBoardDebugSkin';

/** All available visual skins for the game board. */
export type GameBoardSkin = 'classic' | 'debug';

interface Props {
  result: MidiParseResult;
  /** Called by the engine when a tile is tapped; caller handles audio scheduling. */
  onPlayNote: (tile: Tile) => void;
  /** Called when a hold tile is released (stops the sustain note). */
  onHoldRelease?: () => void;
  /** Called on every beat tick inside a hold tile (triggers rhythmic note hits). */
  onHoldBeat?: (notes: ParsedNote[]) => void;
  /** Called when the player taps the back button to leave the game. */
  onExit?: () => void;
  /**
   * Which visual skin to render.
   * - 'classic'  polished look matching the original game
   * - 'debug'    shows beat lines, note labels, timing info
   * Defaults to 'classic'.
   */
  skin?: GameBoardSkin;
}

export function GameBoard({
  result,
  onPlayNote,
  onHoldRelease,
  onHoldBeat,
  onExit,
  skin = 'classic',
}: Props) {
  // Run all game logic once here; both skins receive the same engine object.
  const engine = useGameBoardEngine({ result, onPlayNote });

  // Bundle the props that every skin needs
  const skinProps = { engine, onHoldRelease, onHoldBeat, onExit };

  if (skin === 'debug') return <GameBoardDebugSkin {...skinProps} />;
  return <GameBoardClassicSkin {...skinProps} />;
}
