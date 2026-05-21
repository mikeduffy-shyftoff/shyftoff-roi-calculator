// 30-min intraday arrival curves. Each entry's pct is unnormalized; consumers
// normalize against the active slice (start/end hour window).

// Single-peak realistic pattern used by the v15 classic calculator:
// overnight low → morning ramp → late-morning peak → lunch dip →
// afternoon secondary → evening taper.
export const SINGLE_PEAK = [
  { label: "00:00", pct: 0.4 }, { label: "00:30", pct: 0.3 },
  { label: "01:00", pct: 0.3 }, { label: "01:30", pct: 0.2 },
  { label: "02:00", pct: 0.2 }, { label: "02:30", pct: 0.2 },
  { label: "03:00", pct: 0.2 }, { label: "03:30", pct: 0.2 },
  { label: "04:00", pct: 0.3 }, { label: "04:30", pct: 0.3 },
  { label: "05:00", pct: 0.5 }, { label: "05:30", pct: 0.7 },
  { label: "06:00", pct: 1.2 }, { label: "06:30", pct: 1.5 },
  { label: "07:00", pct: 2.3 }, { label: "07:30", pct: 3.1 },
  { label: "08:00", pct: 4.5 }, { label: "08:30", pct: 5.8 },
  { label: "09:00", pct: 6.8 }, { label: "09:30", pct: 7.2 },
  { label: "10:00", pct: 7.5 }, { label: "10:30", pct: 7.3 },
  { label: "11:00", pct: 6.9 }, { label: "11:30", pct: 6.2 },
  { label: "12:00", pct: 5.0 }, { label: "12:30", pct: 4.6 },
  { label: "13:00", pct: 5.1 }, { label: "13:30", pct: 5.5 },
  { label: "14:00", pct: 5.8 }, { label: "14:30", pct: 5.4 },
  { label: "15:00", pct: 4.8 }, { label: "15:30", pct: 4.2 },
  { label: "16:00", pct: 3.5 }, { label: "16:30", pct: 2.8 },
  { label: "17:00", pct: 2.1 }, { label: "17:30", pct: 1.8 },
  { label: "18:00", pct: 1.5 }, { label: "18:30", pct: 1.3 },
  { label: "19:00", pct: 1.1 }, { label: "19:30", pct: 0.9 },
  { label: "20:00", pct: 0.8 }, { label: "20:30", pct: 0.7 },
  { label: "21:00", pct: 0.6 }, { label: "21:30", pct: 0.5 },
  { label: "22:00", pct: 0.5 }, { label: "22:30", pct: 0.4 },
  { label: "23:00", pct: 0.4 }, { label: "23:30", pct: 0.4 },
];

// Dual-peak "camel hump" pattern used by the AI calculator. Morning peak
// ~9:30 AM, deep lunch valley ~12:30, secondary afternoon peak ~15:00. The
// two-peak shape maximises shift-block waste — no single 8-hr shift covers
// both humps without running overstaffed through the valley.
export const CAMEL = [
  { label: "00:00", pct: 0.3 }, { label: "00:30", pct: 0.2 },
  { label: "01:00", pct: 0.2 }, { label: "01:30", pct: 0.1 },
  { label: "02:00", pct: 0.1 }, { label: "02:30", pct: 0.1 },
  { label: "03:00", pct: 0.1 }, { label: "03:30", pct: 0.2 },
  { label: "04:00", pct: 0.3 }, { label: "04:30", pct: 0.4 },
  { label: "05:00", pct: 0.7 }, { label: "05:30", pct: 1.0 },
  { label: "06:00", pct: 1.6 }, { label: "06:30", pct: 2.3 },
  { label: "07:00", pct: 3.5 }, { label: "07:30", pct: 5.0 },
  { label: "08:00", pct: 6.5 }, { label: "08:30", pct: 7.8 },
  { label: "09:00", pct: 8.6 }, { label: "09:30", pct: 9.0 },
  { label: "10:00", pct: 8.7 }, { label: "10:30", pct: 7.9 },
  { label: "11:00", pct: 6.5 }, { label: "11:30", pct: 5.0 },
  { label: "12:00", pct: 3.6 }, { label: "12:30", pct: 3.1 },
  { label: "13:00", pct: 3.2 }, { label: "13:30", pct: 4.2 },
  { label: "14:00", pct: 6.0 }, { label: "14:30", pct: 7.5 },
  { label: "15:00", pct: 7.8 }, { label: "15:30", pct: 7.2 },
  { label: "16:00", pct: 6.2 }, { label: "16:30", pct: 4.9 },
  { label: "17:00", pct: 3.5 }, { label: "17:30", pct: 2.6 },
  { label: "18:00", pct: 1.9 }, { label: "18:30", pct: 1.4 },
  { label: "19:00", pct: 1.1 }, { label: "19:30", pct: 0.9 },
  { label: "20:00", pct: 0.7 }, { label: "20:30", pct: 0.5 },
  { label: "21:00", pct: 0.4 }, { label: "21:30", pct: 0.3 },
  { label: "22:00", pct: 0.3 }, { label: "22:30", pct: 0.3 },
  { label: "23:00", pct: 0.3 }, { label: "23:30", pct: 0.3 },
];

// Pure Gaussian centered at midday — the textbook "bell" arrival pattern.
// Symmetric, no lunch dip, no early-morning ramp asymmetry. Useful as a
// reference baseline against the more realistic SINGLE_PEAK and CAMEL.
// mean = interval 24 (12:00), stdDev = 6 intervals (3 hrs), peak ~9%.
function gaussianCurve({ mean, stdDev, peak }) {
  return Array.from({ length: 48 }, (_, i) => {
    const hh = String(Math.floor(i / 2)).padStart(2, "0");
    const mm = i % 2 === 0 ? "00" : "30";
    const pct =
      peak * Math.exp(-((i - mean) ** 2) / (2 * stdDev ** 2));
    return { label: `${hh}:${mm}`, pct: Math.round(pct * 10) / 10 };
  });
}

export const BELL = gaussianCurve({ mean: 24, stdDev: 6, peak: 9 });

// Industry-realistic contact-center day-of-week distribution.
//   • Monday spikes ~40% above Friday (FlyFone published data)
//   • Tuesday-Thursday cluster at steady mid-range
//   • Friday tapers
//   • Weekends drop sharply (most centers operate reduced weekend coverage)
// Sources: flyfone.com/call-center-forecasting,
// brightpattern.com (Mon = busiest day, 9-10 AM spike),
// blog.peopleware.com/forecasting/call-center-forecasting-methods-part-1.
export const DEFAULT_DOW = {
  Mon: 20, Tue: 17, Wed: 16, Thu: 16, Fri: 14, Sat: 9, Sun: 8,
};
