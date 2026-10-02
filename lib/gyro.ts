// Absolute gyro pointer tuning (phone angle maps straight to screen position). The Mac agent stores the live values in agent/tune.json and sends them
// to the phone on connect, so they can be edited by hand or fitted by the calibration wizard.
export type GyroTune = {
  /** Pixels of pointer travel per degree the phone turns away from center, per direction. */
  right: number;
  left: number;
  up: number;
  down: number;
  /** One-euro filter: cutoff (Hz) when the pointer is nearly still. Lower removes more hand tremor. */
  minCutoff: number;
  /** One-euro filter: how fast the cutoff opens up as the pointer speeds up. Higher means less lag in fast sweeps. */
  beta: number;
  /** Pointer changes smaller than this many pixels are ignored, which stops resting jitter. */
  deadband: number;
  flipX: boolean;
  flipY: boolean;
};

export type DisplaySize = { w: number; h: number };

export const defaultTune: GyroTune = {
  right: 18,
  left: 18,
  up: 18,
  down: 18,
  minCutoff: 1.2,
  beta: 0.012,
  deadband: 0.8,
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

/** Where a phone's top edge points, as azimuth (clockwise, degrees) and elevation (up, degrees). */
export function aimAngles(alpha: number, beta: number) {
  const a = (alpha * Math.PI) / 180;
  const b = (beta * Math.PI) / 180;
  // Top edge of the phone in world space for the W3C Z-X'-Y'' angles (gamma does not move it).
  const x = -Math.sin(a) * Math.cos(b);
  const y = Math.cos(a) * Math.cos(b);
  const z = Math.sin(b);
  return { az: (Math.atan2(x, y) * 180) / Math.PI, el: (Math.asin(Math.max(-1, Math.min(1, z))) * 180) / Math.PI };
}

export function wrapDegrees(value: number) {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

/** One-euro filter: heavy smoothing while nearly still (hand tremor), light smoothing in fast moves. */
export class OneEuro {
  private value = 0;
  private slope = 0;
  private time = 0;
  private ready = false;

  constructor(
    public minCutoff: number,
    public beta: number,
    private slopeCutoff = 1,
  ) {}

  reset() {
    this.ready = false;
  }

  private static smoothing(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(input: number, now: number) {
    if (!this.ready) {
      this.ready = true;
      this.value = input;
      this.slope = 0;
      this.time = now;
      return input;
    }
    const dt = Math.max(0.001, (now - this.time) / 1000);
    this.time = now;
    const rate = (input - this.value) / dt;
    this.slope += (rate - this.slope) * OneEuro.smoothing(this.slopeCutoff, dt);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.slope);
    this.value += (input - this.value) * OneEuro.smoothing(cutoff, dt);
    return this.value;
  }
}

export type TremorResult = {
  /** Residual shake in pixels (RMS) after removing slow drift, at the current gains. */
  rmsPx: number;
  /** Strongest shake frequency in Hz. */
  freq: number;
  /** Slow wander of the aim in degrees; large values mean the hand was not held still. */
  drift: number;
  tune: Pick<GyroTune, "minCutoff" | "beta" | "deadband">;
};

/** Residual shake (px, RMS) that is acceptable to leave on the pointer. */
const TREMOR_TARGET_PX = 0.8;

/**
 * Samples are [ms, azimuth, elevation] taken while the phone is held as still as possible.
 * Slow drift is removed with a moving average, the remaining shake is measured, and the
 * one-euro filter is set so a first-order low-pass at minCutoff brings that shake down to
 * about TREMOR_TARGET_PX at the shake's strongest frequency.
 */
export function analyzeTremor(samples: number[][], tune: GyroTune, sens = 1): TremorResult | null {
  const SETTLE_MS = 800;
  const RATE = 60;
  if (samples.length < 30) return null;
  const start = samples[0][0] + SETTLE_MS;
  const rows = samples.filter((row) => row[0] >= start);
  if (rows.length < 90) return null;
  const t0 = rows[0][0];
  const span = (rows[rows.length - 1][0] - t0) / 1000;
  if (span < 3) return null;

  const az0 = rows[0][1];
  const el0 = rows[0][2];
  const n = Math.floor(span * RATE);
  const degX: number[] = [];
  const degY: number[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + (i / RATE) * 1000;
    while (j < rows.length - 2 && rows[j + 1][0] < t) j++;
    const a = rows[j];
    const b = rows[j + 1];
    const k = b[0] === a[0] ? 0 : Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
    degX.push(wrapDegrees(a[1] - az0) + wrapDegrees(b[1] - a[1]) * k);
    degY.push(a[2] - el0 + (b[2] - a[2]) * k);
  }

  const half = Math.round(RATE * 0.3);
  const slow = (series: number[]) =>
    series.map((_, i) => {
      let sum = 0;
      let count = 0;
      for (let k = Math.max(0, i - half); k <= Math.min(series.length - 1, i + half); k++) {
        sum += series[k];
        count++;
      }
      return sum / count;
    });
  const slowX = slow(degX);
  const slowY = slow(degY);
  const range = (series: number[]) => Math.max(...series) - Math.min(...series);
  const drift = Math.max(range(slowX), range(slowY));

  const gainX = ((tune.right + tune.left) / 2) * sens;
  const gainY = ((tune.up + tune.down) / 2) * sens;
  const edge = half; // ignore the ends, where the moving average is one-sided
  const resX: number[] = [];
  const resY: number[] = [];
  for (let i = edge; i < n - edge; i++) {
    resX.push((degX[i] - slowX[i]) * gainX);
    resY.push((degY[i] - slowY[i]) * gainY);
  }
  if (resX.length < RATE) return null;
  const meanSquare = (series: number[]) => series.reduce((sum, v) => sum + v * v, 0) / series.length;
  const rms = Math.sqrt(meanSquare(resX) + meanSquare(resY));

  let best = 0;
  let freq = 8;
  for (let f = 2; f <= 15; f += 0.25) {
    let re = 0;
    let im = 0;
    let re2 = 0;
    let im2 = 0;
    for (let i = 0; i < resX.length; i++) {
      const phase = (2 * Math.PI * f * i) / RATE;
      const c = Math.cos(phase);
      const sn = Math.sin(phase);
      re += resX[i] * c;
      im -= resX[i] * sn;
      re2 += resY[i] * c;
      im2 -= resY[i] * sn;
    }
    const power = re * re + im * im + re2 * re2 + im2 * im2;
    if (power > best) {
      best = power;
      freq = f;
    }
  }

  const ratio = rms / TREMOR_TARGET_PX;
  const minCutoff = ratio <= 1 ? 3 : Math.min(3, Math.max(0.5, freq / Math.sqrt(ratio * ratio - 1)));
  // Tremor speed leaks into the filter's speed estimate; keep that boost to ~30% of the cutoff.
  const slopeAmplitude = (2 * Math.PI * freq * rms * Math.SQRT2) / Math.sqrt(1 + freq * freq);
  const beta = Math.min(0.03, Math.max(0.002, (0.3 * minCutoff) / Math.max(slopeAmplitude, 1)));
  const deadband = Math.min(5, Math.max(0.8, rms * 1.2));
  return { rmsPx: rms, freq, drift, tune: { minCutoff, beta, deadband } };
}
