/**
 * Multisection quarter-wave transformers (Pozar §5.5–5.7).
 *
 * Two designs are produced for each case:
 *  1. Small-reflection design — exactly as in the textbook:
 *       binomial   ln(Z_{n+1}/Z_n) ≈ 2^{−N} C(N,n) ln(Z_L/Z0)                  (5.53)
 *       Chebyshev  Γ(θ) = A e^{−jNθ} T_N(secθm cosθ),
 *                  secθm = cosh[(1/N) cosh⁻¹(|ln(Z_L/Z0)| / 2Γm)]                (5.61), (5.63)
 *                  ln(Z_{n+1}/Z_n) ≈ 2Γ_n
 *  2. Exact design — the impedances that make the exact stepped-line response equal
 *     the ideal insertion-loss function (which is what Pozar's Tables 5.1 and 5.2 list):
 *       P(θ) = |Γ|²/(1 − |Γ|²)
 *       binomial   P = k² cos^{2N} θ
 *       Chebyshev  P = k² T_N²(secθm cosθ) / T_N²(secθm),  T_N(secθm) = k/ε
 *     with k² = (Z_L − Z0)²/(4 Z_L Z0) (the θ = 0 value) and ε² = Γm²/(1 − Γm²).
 *     Solved by Levenberg–Marquardt on ln Z_n with the symmetry
 *     ln Z_n + ln Z_{N+1−n} = ln(Z0 Z_L), starting from the small-reflection design.
 *
 * Only real loads are handled here; complex loads are first moved to a voltage
 * maximum/minimum by the caller.
 */
import { c, abs } from '../math/complex';
import { propagateGamma } from './network';

export type MultiKind = 'binomial' | 'chebyshev';

export interface MultiDesign {
  kind: MultiKind;
  N: number;
  /** Section impedances from the feed line side: Z_1 … Z_N (Ω). */
  approx: number[];
  exact: number[];
  /** Fractional bandwidth for |Γ| ≤ Γm: closed form (5.55)/(5.64) and from the exact response. */
  bwFormula: number;
  bwExact: number;
  thetaM: number; // rad, lower passband edge from the closed-form (5.54)/(5.63)
  /** rad, lower passband edge of the exact design's response (|Γ| = Γm). */
  thetaMExact: number;
  exactResidual: number;
}

const binom = (N: number, n: number): number => {
  let r = 1;
  for (let i = 1; i <= n; i++) r = (r * (N - n + i)) / i;
  return r;
};

/** Chebyshev polynomial T_N(x) for any real x. */
export function chebyshevT(N: number, x: number): number {
  if (Math.abs(x) <= 1) return Math.cos(N * Math.acos(x));
  const v = Math.cosh(N * Math.acosh(Math.abs(x)));
  return x < 0 && N % 2 === 1 ? -v : v;
}

/** Exact |Γ_in| of the stepped transformer at electrical length θ per section (θ = π/2 at f0). */
export function steppedGamma(Zs: readonly number[], Z0: number, ZL: number, theta: number): number {
  // Start at the load, walk toward the feed: Z_N is next to the load.
  let g = c((ZL - Z0) / (ZL + Z0), 0);
  for (let k = Zs.length - 1; k >= 0; k--) g = propagateGamma(g, c(Zs[k] / Z0, 0), c(0, theta));
  return abs(g);
}

/** Small-reflection Γ_n coefficients of a Chebyshev design, from the cos-series of T_N(secθm cosθ). */
function chebyshevGammas(N: number, A: number, secM: number): number[] {
  // Γ(θ)e^{jNθ} = 2[Γ0 cos Nθ + Γ1 cos(N−2)θ + …] = A T_N(secθm cosθ). Project onto cos((N−2n)θ).
  const M = 4096;
  const gam = new Array(N + 1).fill(0);
  for (let n = 0; n <= Math.floor(N / 2); n++) {
    const m = N - 2 * n;
    let acc = 0;
    for (let i = 0; i < M; i++) {
      const th = ((i + 0.5) / M) * Math.PI;
      acc += A * chebyshevT(N, secM * Math.cos(th)) * Math.cos(m * th);
    }
    let coef = (2 / M) * acc; // Fourier cosine coefficient a_m on [0, π]
    if (m === 0) coef /= 2;    // constant term
    // 2Γn cos(mθ) = coef·cos(mθ)  (for m = 0 the series term is Γ_{N/2}, not 2Γ)
    gam[n] = m === 0 ? coef : coef / 2;
    gam[N - n] = gam[n];
  }
  return gam;
}

function solveExact(N: number, Z0: number, ZL: number, target: (th: number) => number, start: number[]): { Z: number[]; res: number } {
  const L0 = Math.log(Z0), LL = Math.log(ZL);
  const free = Math.floor(N / 2);
  const build = (x: number[]): number[] => {
    const ln = new Array(N);
    for (let i = 0; i < free; i++) { ln[i] = x[i]; ln[N - 1 - i] = L0 + LL - x[i]; }
    if (N % 2 === 1) ln[free] = (L0 + LL) / 2;
    return ln.map(Math.exp);
  };
  const thetas: number[] = [];
  const S = Math.max(12, 6 * N);
  for (let i = 0; i < S; i++) thetas.push(((i + 0.5) / S) * Math.PI / 2);
  const Pexact = (Z: number[], th: number) => { const g = steppedGamma(Z, Z0, ZL, th); return (g * g) / (1 - g * g); };
  const P0 = target(0) || 1;
  const resid = (x: number[]) => { const Z = build(x); return thetas.map((th) => (Pexact(Z, th) - target(th)) / P0); };
  let x = start.slice(0, free).map(Math.log);
  let r = resid(x);
  let cost = r.reduce((a, v) => a + v * v, 0);
  let lambda = 1e-3;
  for (let it = 0; it < 200 && free > 0; it++) {
    // numerical Jacobian
    const J: number[][] = thetas.map(() => new Array(free).fill(0));
    for (let j = 0; j < free; j++) {
      const h = 1e-7;
      const xp = x.slice(); xp[j] += h;
      const rp = resid(xp);
      for (let i = 0; i < thetas.length; i++) J[i][j] = (rp[i] - r[i]) / h;
    }
    // (JᵀJ + λ diag) δ = −Jᵀ r
    const A = Array.from({ length: free }, () => new Array(free).fill(0));
    const g = new Array(free).fill(0);
    for (let i = 0; i < thetas.length; i++) for (let a = 0; a < free; a++) {
      g[a] += J[i][a] * r[i];
      for (let b = 0; b < free; b++) A[a][b] += J[i][a] * J[i][b];
    }
    for (let a = 0; a < free; a++) A[a][a] *= 1 + lambda;
    const delta = solveLinear(A, g.map((v) => -v));
    if (!delta) break;
    const xn = x.map((v, i) => v + delta[i]);
    const rn = resid(xn);
    const cn = rn.reduce((a2, v) => a2 + v * v, 0);
    if (cn < cost) { x = xn; r = rn; cost = cn; lambda = Math.max(1e-12, lambda / 5); if (cost < 1e-26) break; }
    else lambda *= 10;
    if (lambda > 1e12) break;
  }
  return { Z: build(x), res: Math.sqrt(cost / thetas.length) };
}

function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-300) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  return M.map((row, i) => row[n] / M[i][i]);
}

/** Fractional bandwidth Δf/f0 where the exact response stays ≤ Γm around θ = π/2. */
export function exactBandwidth(Z: number[], Z0: number, ZL: number, gm: number): { bw: number; thetaM: number } {
  if (steppedGamma(Z, Z0, ZL, Math.PI / 2) > gm) return { bw: 0, thetaM: Math.PI / 2 };
  // walk down from π/2 until |Γ| first exceeds Γm, then bisect
  let lo = Math.PI / 2, step = Math.PI / 2 / 2000;
  let th = lo;
  while (th > 0 && steppedGamma(Z, Z0, ZL, th) <= gm * (1 + 1e-9)) { lo = th; th -= step; }
  if (th <= 0) return { bw: 2, thetaM: 0 };
  let a = th, b = lo;
  for (let i = 0; i < 60; i++) { const m = (a + b) / 2; if (steppedGamma(Z, Z0, ZL, m) > gm * (1 + 1e-9)) a = m; else b = m; }
  return { bw: 2 - (4 * b) / Math.PI, thetaM: b };
}

export function designMultisection(kind: MultiKind, N: number, Z0: number, ZL: number, gm: number): MultiDesign | null {
  if (!(ZL > 0) || !(Z0 > 0) || N < 1 || N > 7 || !Number.isInteger(N)) return null;
  const lnR = Math.log(ZL / Z0);
  const approx: number[] = [];
  let bwFormula: number;
  let thetaM: number;
  let target: (th: number) => number;
  const k2 = (ZL - Z0) ** 2 / (4 * ZL * Z0);
  if (kind === 'binomial') {
    let lnZ = Math.log(Z0);
    for (let n = 0; n < N; n++) { lnZ += Math.pow(2, -N) * binom(N, n) * lnR; approx.push(Math.exp(lnZ)); }
    // (5.49) with the small-reflection form used in Pozar's Example 5.6: A ≈ ln(Z_L/Z0)/2^{N+1}
    const A = lnR / Math.pow(2, N + 1);
    const ratio = gm / Math.abs(A);
    thetaM = Math.acos(Math.min(1, 0.5 * Math.pow(ratio, 1 / N))); // (5.54)
    bwFormula = 2 - (4 / Math.PI) * thetaM; // (5.55)
    target = (th) => k2 * Math.pow(Math.cos(th), 2 * N);
  } else {
    if (!(gm > 0 && gm < 1)) return null;
    const x = Math.abs(lnR) / (2 * gm);
    if (x <= 1) return null; // ripple larger than the step itself: one section is enough
    const secM = Math.cosh(Math.acosh(x) / N); // (5.63)
    thetaM = Math.acos(1 / secM);
    bwFormula = 2 - (4 * thetaM) / Math.PI; // (5.64)
    const A = gm * Math.sign(lnR);
    const gam = chebyshevGammas(N, A, secM);
    let lnZ = Math.log(Z0);
    for (let n = 0; n < N; n++) { lnZ += 2 * gam[n]; approx.push(Math.exp(lnZ)); }
    // exact insertion-loss target
    const eps = gm / Math.sqrt(1 - gm * gm);
    const kk = Math.sqrt(k2);
    if (kk / eps <= 1) return null;
    const secE = Math.cosh(Math.acosh(kk / eps) / N);
    const TN = chebyshevT(N, secE);
    target = (th) => k2 * (chebyshevT(N, secE * Math.cos(th)) ** 2) / (TN * TN);
  }
  const ex = solveExact(N, Z0, ZL, target, approx);
  const bwE = exactBandwidth(ex.Z, Z0, ZL, gm);
  return { kind, N, approx, exact: ex.Z, bwFormula, bwExact: bwE.bw, thetaM, thetaMExact: bwE.thetaM, exactResidual: ex.res };
}
