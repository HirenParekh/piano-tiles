/**
 * ScrollSegmentTracker.test.ts
 *
 * Pure unit tests — no Phaser, no DOM, no mocks required.
 * ScrollSegmentTracker takes arrays and numbers; returns numbers.
 */

import { describe, it, expect } from 'vitest';
import { ScrollSegmentTracker } from '../ScrollSegmentTracker';
import type { ScrollSegment } from '../../../types/midi';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal ScrollSegment for testing. */
function seg(startPixel: number, endPixel: number, slotDurationS: number): ScrollSegment {
  return {
    startPixel,
    endPixel,
    slotDurationS,
    startSlot: 0,
    endSlot: 0,
    startTime: 0,
    endTime: 0,
  };
}

// A known constant for all pixel-per-second calculations.
// MIN_HEIGHT = 100 (imported from tileBuilder, but we use the value directly here
// to keep the test self-contained and catch if the constant ever changes).
const MIN_HEIGHT = 100;

// ---------------------------------------------------------------------------
// Tests: constant-BPM (empty segments)
// ---------------------------------------------------------------------------

describe('ScrollSegmentTracker — constant BPM (no segments)', () => {
  it('returns fallback speed at song start (distance = 0)', () => {
    const slotDurationS = 0.5; // 120 BPM → 0.5 s/slot
    const scaleRatio = 1.5;
    const tracker = new ScrollSegmentTracker([], slotDurationS);

    const expected = (MIN_HEIGHT / slotDurationS) * scaleRatio; // 300 px/s
    expect(tracker.getPixelsPerSecond(0, scaleRatio)).toBeCloseTo(expected);
  });

  it('returns fallback speed at any distance', () => {
    const slotDurationS = 0.333;
    const scaleRatio = 1;
    const tracker = new ScrollSegmentTracker([], slotDurationS);

    const expected = MIN_HEIGHT / slotDurationS;
    expect(tracker.getPixelsPerSecond(99999, scaleRatio)).toBeCloseTo(expected);
  });

  it('scales correctly with scaleRatio', () => {
    const slotDurationS = 1; // 1 s/slot → easy math
    const tracker = new ScrollSegmentTracker([], slotDurationS);

    // At scaleRatio 2: each slot is 200px, so speed = 200 px/s
    expect(tracker.getPixelsPerSecond(0, 2)).toBeCloseTo(200);
    // At scaleRatio 0.5: each slot is 50px, so speed = 50 px/s
    expect(tracker.getPixelsPerSecond(0, 0.5)).toBeCloseTo(50);
  });
});

// ---------------------------------------------------------------------------
// Tests: variable-BPM (with segments)
// ---------------------------------------------------------------------------

describe('ScrollSegmentTracker — variable BPM (with segments)', () => {
  // Two segments: slow (0–500px) then fast (500–1000px)
  const slowDuration = 1.0;   // 1 s/slot
  const fastDuration = 0.25;  // 0.25 s/slot (4× faster)
  const segments = [
    seg(0, 500, slowDuration),
    seg(500, 1000, fastDuration),
  ];
  const scaleRatio = 1;
  const tracker = new ScrollSegmentTracker(segments, slowDuration);

  it('uses slow segment speed at song distance = 0', () => {
    const expected = MIN_HEIGHT / slowDuration; // 100 px/s
    expect(tracker.getPixelsPerSecond(0, scaleRatio)).toBeCloseTo(expected);
  });

  it('uses slow segment speed in the middle of the first segment', () => {
    const expected = MIN_HEIGHT / slowDuration;
    expect(tracker.getPixelsPerSecond(250, scaleRatio)).toBeCloseTo(expected);
  });

  it('uses fast segment speed at the start of the second segment', () => {
    const expected = MIN_HEIGHT / fastDuration; // 400 px/s
    expect(tracker.getPixelsPerSecond(500, scaleRatio)).toBeCloseTo(expected);
  });

  it('uses fast segment speed in the middle of the second segment', () => {
    const expected = MIN_HEIGHT / fastDuration;
    expect(tracker.getPixelsPerSecond(750, scaleRatio)).toBeCloseTo(expected);
  });

  it('falls back to fallback speed past the last segment', () => {
    const expected = MIN_HEIGHT / slowDuration;
    expect(tracker.getPixelsPerSecond(1001, scaleRatio)).toBeCloseTo(expected);
  });

  it('applies scaleRatio to segment speed', () => {
    const ratio = 2;
    const expected = (MIN_HEIGHT / slowDuration) * ratio; // 200 px/s
    expect(tracker.getPixelsPerSecond(0, ratio)).toBeCloseTo(expected);
  });

  it('treats segment boundaries as inclusive-start exclusive-end', () => {
    // distance = 500 exactly → start of second segment (fast), not end of first (slow)
    const fastExpected = MIN_HEIGHT / fastDuration;
    expect(tracker.getPixelsPerSecond(500, scaleRatio)).toBeCloseTo(fastExpected);

    // distance = 499.999 → still in the first segment (slow)
    const slowExpected = MIN_HEIGHT / slowDuration;
    expect(tracker.getPixelsPerSecond(499.999, scaleRatio)).toBeCloseTo(slowExpected);
  });
});
