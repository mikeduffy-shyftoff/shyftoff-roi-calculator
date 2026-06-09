// Erlang C math (log-space for numerical stability).

export function logFactorial(n) {
  if (n <= 1) return 0;
  let r = 0;
  for (let i = 2; i <= n; i++) r += Math.log(i);
  return r;
}

export function erlangC(agents, trafficErlangs) {
  const N = agents;
  const A = trafficErlangs;
  if (N <= A) return 1;
  if (A <= 0) return 0;
  const rho = A / N;
  if (rho >= 1) return 1;

  const logAN = N * Math.log(A) - logFactorial(N);

  let logTerm = 0;
  const logTerms = [0];
  for (let k = 1; k < N; k++) {
    logTerm += Math.log(A) - Math.log(k);
    logTerms.push(logTerm);
  }
  const maxLog = Math.max(...logTerms, logAN);
  const sumPart = logTerms.reduce((s, lt) => s + Math.exp(lt - maxLog), 0);

  const scaledAN = Math.exp(logAN - maxLog);
  const numerator = scaledAN * (1 / (1 - rho));
  return numerator / (sumPart + numerator);
}

export function serviceLevel(agents, trafficErlangs, ahtSeconds, targetSeconds) {
  if (agents <= trafficErlangs) return 0;
  if (trafficErlangs <= 0) return 1;
  const pw = erlangC(agents, trafficErlangs);
  const sl =
    1 - pw * Math.exp(-(agents - trafficErlangs) * (targetSeconds / ahtSeconds));
  return Math.max(0, Math.min(1, sl));
}

// Default search: starts at max(1, ceil(traffic)), filters occupancy first.
// Matches AICalculator semantics and is used by the shared staffing/scenarios layer.
export function findRequiredAgents(
  trafficErlangs,
  ahtSeconds,
  targetSL,
  targetSeconds,
  maxOccupancy,
) {
  const minAgents = Math.max(1, Math.ceil(trafficErlangs));
  for (let n = minAgents; n < minAgents + 300; n++) {
    if (trafficErlangs / n > maxOccupancy) continue;
    if (serviceLevel(n, trafficErlangs, ahtSeconds, targetSeconds) >= targetSL)
      return n;
  }
  return minAgents + 300;
}

// Occ-driven staffing: ignores the SL check entirely and returns the minimum
// agent count needed to keep occupancy at or below maxOccupancy. Used when the
// planner has explicitly chosen occupancy as the binding constraint and is
// willing to accept whatever SL falls out. The caller is responsible for
// computing achievedSL = serviceLevel(N, erlangs, ...) and warning the user
// when it drifts below their target.
export function findRequiredAgentsByOcc(trafficErlangs, maxOccupancy) {
  if (trafficErlangs <= 0) return 1;
  if (maxOccupancy <= 0 || maxOccupancy >= 1) {
    // Degenerate inputs: fall back to "just enough for steady-state."
    return Math.max(1, Math.ceil(trafficErlangs));
  }
  return Math.max(1, Math.ceil(trafficErlangs / maxOccupancy));
}

// The "natural" maxOcc for a given traffic profile: the highest occupancy at
// which SL is still met. This is what the maxOcc slider should default to —
// the sweet spot where both constraints are exactly balanced. Below this, the
// user is over-staffing (SL exceeded). Above this, SL drops below target and
// a warning fires. Capped at 0.95 to avoid pathological edge cases.
//
// Math: if N is the smallest agent count satisfying SL, then for ceil(erlangs/
// maxOcc) to still equal N we need maxOcc < erlangs / (N-1). Returning just
// below that bound puts the slider at the highest occ where staffing still
// equals N and SL still meets target. Returning erlangs/N (the lower bound of
// the same plateau) would also preserve N agents but at unnecessarily
// conservative occupancy — same staffing, but the slider would look like it
// "doesn't reach" the actual sweet spot.
export function findNaturalMaxOcc(
  trafficErlangs,
  ahtSeconds,
  targetSL,
  targetSeconds,
) {
  if (trafficErlangs <= 0) return 0.85;
  const minAgents = Math.max(1, Math.ceil(trafficErlangs));
  for (let n = minAgents; n < minAgents + 300; n++) {
    if (serviceLevel(n, trafficErlangs, ahtSeconds, targetSeconds) >= targetSL) {
      if (n <= 1) return 0.95; // trivial-staffing edge case
      return Math.min(0.95, trafficErlangs / (n - 1) - 1e-9);
    }
  }
  return 0.85;
}

// ───────────────────────────────────────────────────────────────────────────
// Erlang A — M/M/c+M queueing model WITH caller abandonment.
//
// The contact-center industry standard for realistic SL/staffing math. Erlang
// C assumes infinite patience (every queued caller waits forever), which
// overstaffs at peak by 20–30% per Brown et al. (2005) "Statistical analysis
// of a telephone call center." Erlang A models exponentially-distributed
// caller patience θ⁻¹, so the steady-state queue is finite even when offered
// load exceeds agent capacity.
//
// References:
//   • Palm (1957) — original M/M/c+M derivation
//   • Garnett, Mandelbaum, Reiman (2002) — designing M/M/n+M
//   • Brown, Gans, Mandelbaum, Sakov, Shen, Zeltyn, Zhao (2005) — call-center
//     statistical analysis showing Erlang C overstaffs in practice
//   • Mandelbaum & Zeltyn (2007) — service engineering in action: the Palm/
//     Erlang-A queue
//
// Parameters:
//   agents   — number of servers (c, integer ≥ 1)
//   traffic  — offered load in Erlangs (a = λ × AHT)
//   beta     — impatience ratio (β = θ × AHT = AHT / mean patience)
//              β = 0   → callers infinitely patient → Erlang C (no abandonment)
//              β = 1   → mean patience equals mean handle time (typical voice)
//              β = 2+  → very impatient callers (chat / async)
//   maxQueue — max queue depth to track (default 200, ample for any practical load)
//
// Returns: { pWait, pAbandon, expectedQueue, stateProbs }
//   pWait         — P(arriving call must wait) = P(n ≥ c at arrival, PASTA)
//   pAbandon      — fraction of arriving calls that abandon before service
//   expectedQueue — E[queue length]
//   stateProbs    — steady-state probabilities (for debugging / further math)
//
// Math: birth-death Markov chain. For n ≤ c, p_n = (a^n / n!) p₀.
// For n = c+k > c, p_{c+k} = p_c × ∏_{i=1..k} a / (c + i β). Normalize.
// Computed in log-space to avoid overflow at large a.
// ───────────────────────────────────────────────────────────────────────────
export function erlangA(agents, traffic, beta, options = {}) {
  const c = Math.max(1, Math.floor(agents));
  const a = Math.max(0, traffic);
  const b = Math.max(0, beta);
  const maxQ = options.maxQueue || 200;

  // Edge cases.
  if (a === 0) {
    return { pWait: 0, pAbandon: 0, expectedQueue: 0 };
  }
  if (b === 0) {
    // No abandonment ⟹ pure Erlang C. Reuse the existing function for pWait.
    // Abandonment is impossible; queue can blow up if ρ ≥ 1.
    const pWait = erlangC(c, a);
    return { pWait, pAbandon: 0, expectedQueue: Infinity * 0 || 0 };
  }

  // Build unnormalized log-probabilities for states 0..c+maxQ.
  const logP = new Array(c + maxQ + 1);
  logP[0] = 0;
  for (let n = 1; n <= c; n++) {
    logP[n] = logP[n - 1] + Math.log(a) - Math.log(n);
  }
  // Tail (n > c): geometric-like ratio a / (c + k β).
  let lastLog = logP[c];
  for (let k = 1; k <= maxQ; k++) {
    lastLog = lastLog + Math.log(a) - Math.log(c + k * b);
    logP[c + k] = lastLog;
  }

  // Normalize via log-sum-exp.
  let maxLog = -Infinity;
  for (let n = 0; n <= c + maxQ; n++) {
    if (logP[n] > maxLog) maxLog = logP[n];
  }
  let sum = 0;
  for (let n = 0; n <= c + maxQ; n++) {
    sum += Math.exp(logP[n] - maxLog);
  }
  const logZ = maxLog + Math.log(sum);

  // Aggregates.
  let pWait = 0;
  let EQ = 0;
  const stateProbs = new Array(c + maxQ + 1);
  for (let n = 0; n <= c + maxQ; n++) {
    const p = Math.exp(logP[n] - logZ);
    stateProbs[n] = p;
    if (n >= c) pWait += p;
    if (n > c) EQ += (n - c) * p;
  }
  // P(abandon) = θ × E[Q] / λ = β × E[Q] / a (Mandelbaum-Zeltyn 2007).
  const pAbandon = a > 0 ? (b * EQ) / a : 0;

  return { pWait, pAbandon, expectedQueue: EQ, stateProbs };
}

// Service level under Erlang A — fraction of calls served within targetSec.
//
// Uses a practical approximation: SL = 1 − pWait_A × exp(−η × T) where the
// effective decay rate η accounts for both service completions and ongoing
// abandonments shrinking the queue. The single-exponential form mirrors the
// Erlang C convention while incorporating Erlang A's lower pWait and faster
// queue drain.
//
// Convention: abandoned calls count as NOT answered (stricter of the two
// industry SL conventions). If you want "of-calls-that-stayed" SL, divide
// answered-within-T by (1 − pAbandon).
export function serviceLevelErlangA(
  agents,
  trafficErlangs,
  beta,
  ahtSeconds,
  targetSeconds,
) {
  if (trafficErlangs <= 0) return 1;
  if (agents <= 0) return 0;
  const { pWait, pAbandon } = erlangA(agents, trafficErlangs, beta);
  if (pWait === 0) return 1;
  // Effective offered load after abandonment.
  const aEff = trafficErlangs * (1 - pAbandon);
  // Decay rate ∝ (c − aEff) / AHT; abandonment makes the queue drain faster.
  const decay = Math.max(0, (agents - aEff) / Math.max(1e-9, ahtSeconds));
  const sl = 1 - pWait * Math.exp(-decay * targetSeconds);
  return Math.max(0, Math.min(1, sl));
}

// Min agent count to hit targetSL under Erlang A. Same shape as
// findRequiredAgents but with the abandonment-aware SL formula.
export function findRequiredAgentsErlangA(
  trafficErlangs,
  ahtSeconds,
  targetSL,
  targetSeconds,
  maxOccupancy,
  beta,
) {
  const minAgents = Math.max(1, Math.ceil(trafficErlangs));
  for (let n = minAgents; n < minAgents + 300; n++) {
    if (trafficErlangs / n > maxOccupancy) continue;
    const sl = serviceLevelErlangA(n, trafficErlangs, beta, ahtSeconds, targetSeconds);
    if (sl >= targetSL) return n;
  }
  return minAgents + 300;
}

