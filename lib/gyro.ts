// Gyro mouse tuning. The Mac agent stores the live values in agent/tune.json and sends them
// to the phone on connect, so they can be edited by hand or fitted by the calibration wizard.
export type GyroTune = {
  /** Pixels of pointer travel per degree of phone rotation, per direction. */
  right: number;
  left: number;
  up: number;
  down: number;
  /** Extra speed-based gain: 1 + min(speed / accelDiv, accelMax). */
  accelDiv: number;
  accelMax: number;
  /** Rotation rates (deg/s) below this are ignored. */
  deadzone: number;
  /** 0..1 low-pass factor applied to the rotation rate; higher follows the phone more tightly. */
  smooth: number;
  flipX: boolean;
  flipY: boolean;
};

export type DisplaySize = { w: number; h: number };

export const defaultTune: GyroTune = {
  right: 18,
  left: 18,
  up: 18,
  down: 18,
  accelDiv: 40,
  accelMax: 3,
  deadzone: 0.6,
  smooth: 0.6,
  flipX: false,
  flipY: false,
};

export const GAIN_MIN = 20;
export const GAIN_MAX = 45;
export const MIN_PEAK = 12;

export const calibSteps = ["right", "left", "up", "down"] as const;
export type CalibStep = (typeof calibSteps)[number];

/** Turn the largest comfortable rotation (degrees) in each direction into per-direction gains. */
export function fitTune(
  current: GyroTune,
  display: DisplaySize,
  peaks: Record<CalibStep, number>,
): GyroTune {
  // Gains are bounded so a timid rotation cannot be turned into a hair-trigger pointer: past
  // roughly 45 px/deg, normal hand tremor already moves the pointer many pixels. Reach beyond
  // the comfortable range comes from the speed boost instead.
  const gain = (half: number, degrees: number) => Math.min(GAIN_MAX, Math.max(GAIN_MIN, half / Math.max(Math.abs(degrees), 4)));
  return {
    ...current,
    right: gain(display.w / 2, peaks.right),
    left: gain(display.w / 2, peaks.left),
    down: gain(display.h / 2, peaks.down),
    up: gain(display.h / 2, peaks.up),
    // Peaks are measured before flipping: turning right should be positive x, tipping down positive y.
    flipX: peaks.right < 0,
    flipY: peaks.down < 0,
  };
}
