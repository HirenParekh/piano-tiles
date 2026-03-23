/**
 * ScrollSegmentTracker.ts
 *
 * Pure utility class that maps a song-distance (in world pixels) to the correct
 * scroll speed (in pixels per second) for variable-BPM songs.
 *
 * RESPONSIBILITY:
 *   Given a list of ScrollSegments and the current playback position, return the
 *   appropriate `pixelsPerSecond` for the active segment.
 *
 * DOES NOT:
 *   - Own any Phaser objects.
 *   - Know about the camera or game loop.
 *   - Apply the speed — callers (CameraScrollSystem) do that.
 *
 * WHY a separate class (not inline in CameraScrollSystem):
 *   This logic is independently unit-testable without Phaser. Isolating it keeps
 *   CameraScrollSystem focused on camera mutation and avoids mixing coordinate-
 *   math concerns with Phaser API calls.
 *
 * COORDINATE CONVENTIONS:
 *   - `ScrollSegment.startPixel` / `endPixel` are bottom-offsets in CSS space
 *     at scaleRatio = 1 (as produced by tileBuilder.ts / pianoTilesParser.ts).
 *   - `songDistancePx` = how far the camera has moved from the start of the song,
 *     in Phaser world pixels = startScrollY - camera.scrollY (passed by CameraScrollSystem).
 *   - All segments are tested by scaling their pixel boundaries to world pixels:
 *     `worldBoundary = cssPixels * scaleRatio`.
 *
 * SEGMENT MATCHING:
 *   Segments cover [startPixel, endPixel) (inclusive start, exclusive end).
 *   They should be contiguous and cover the full song, but a fallback is used
 *   if no segment matches (past the end of the last segment, or empty array).
 */

import { MIN_HEIGHT } from '../../utils/tileBuilder';
import type { ScrollSegment } from '../../types/midi';

export class ScrollSegmentTracker {
  /**
   * Raw (unscaled) scroll segments from MidiParseResult.info.scrollSegments.
   * We scale boundaries on-the-fly at lookup time, so the tracker does not
   * need to be rebuilt when scaleRatio changes (e.g. on window resize).
   */
  private readonly segments: ScrollSegment[];

  /**
   * Fallback scroll speed for constant-BPM songs (empty segments array) or
   * when the playback position lies past all segment boundaries.
   *
   * Formula: slotHeightPx / slotDurationS
   *   = MIN_HEIGHT * scaleRatio / slotDurationS
   * (scaleRatio is applied at call time, so we store only slotDurationS here).
   */
  private readonly fallbackSlotDurationS: number;

  /**
   * @param segments           - Raw (unscaled) ScrollSegment array.
   *                             Pass an empty array for constant-BPM songs.
   * @param fallbackSlotDurationS - Duration of one slot in seconds for the
   *                             constant-BPM case (= 60 / effectiveBpm).
   */
  constructor(segments: ScrollSegment[], fallbackSlotDurationS: number) {
    this.segments = segments;
    this.fallbackSlotDurationS = fallbackSlotDurationS;
  }

  /**
   * Returns the scroll speed in world pixels per second for the given playback position.
   *
   * @param songDistancePx - How far the camera has traveled from the song start,
   *                         in world pixels (= startScrollY - camera.scrollY).
   *                         Increases from 0 (song start) toward worldHeight (song end).
   * @param scaleRatio     - Current viewport scale (gameHeight / (4 * MIN_HEIGHT)).
   *                         Applied to segment pixel boundaries on every call, so
   *                         live resize works without rebuilding the tracker.
   * @returns Pixels per second (always positive; caller controls direction).
   */
  getPixelsPerSecond(songDistancePx: number, scaleRatio: number): number {
    // Search segments in order. Segments are expected to be sorted by startPixel.
    for (const seg of this.segments) {
      const segStartPx = seg.startPixel * scaleRatio;
      const segEndPx = seg.endPixel * scaleRatio;

      if (songDistancePx >= segStartPx && songDistancePx < segEndPx) {
        // We are inside this segment. Use its per-slot duration.
        return (MIN_HEIGHT / seg.slotDurationS) * scaleRatio;
      }
    }

    // Fallback: no segment matched (constant-BPM song, or past the last segment).
    return (MIN_HEIGHT / this.fallbackSlotDurationS) * scaleRatio;
  }
}
