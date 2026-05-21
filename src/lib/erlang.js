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

