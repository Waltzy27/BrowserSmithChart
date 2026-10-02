/**
 * Touchstone reader/writer (1.0/1.1 fully for 1–n ports, core 2.0 keywords for 1–2 ports).
 *
 * Conventions implemented:
 *  - Option line "# <unit> <param> <format> R <ref>"; defaults GHz S MA R 50 (v1.x).
 *  - Formats: RI (real/imag), MA (linear magnitude, degrees), DB (20·log10|x|, degrees).
 *  - 2-port v1.x data order is N11 N21 N12 N22 (the Touchstone exception);
 *    v2.0 honours [Two-Port Data Order].
 *  - v1.x Z/Y data are normalised to R; v2.0 Z/Y data are in ohms/siemens.
 *  - Z/Y parameters are converted to S referenced to R.
 *  - 2-port noise data (a second block whose frequency restarts) is detected and skipped.
 *
 * All input is treated as untrusted text: sizes are limited and nothing is evaluated.
 */
import {
  type Complex, c, add, sub, mul, div, fromPolar, ONE, abs, arg, deg,
} from '../math/complex';

export type ParamType = 'S' | 'Y' | 'Z' | 'H' | 'G';
export type DataFormat = 'RI' | 'MA' | 'DB';

export interface Diagnostic { level: 'error' | 'warning' | 'info'; line?: number; message: string; }

export interface Network {
  name: string;
  ports: number;
  freqs: number[];             // Hz
  /** S-parameters referenced to z0: s[k][i][j] at freqs[k]. */
  s: Complex[][][];
  z0: number;
  source: { version: string; param: ParamType; format: DataFormat; unit: string; };
  comments: string[];
  hasNoiseData: boolean;
}

export interface ParseResult { network: Network | null; diagnostics: Diagnostic[]; }

export const LIMITS = { maxBytes: 50 * 1024 * 1024, maxPorts: 16, maxFrequencies: 200_000 };

const UNIT_SCALE: Record<string, number> = { HZ: 1, KHZ: 1e3, MHZ: 1e6, GHZ: 1e9 };

function toComplex(a: number, b: number, fmt: DataFormat): Complex {
  if (fmt === 'RI') return c(a, b);
  const mag = fmt === 'MA' ? a : Math.pow(10, a / 20);
  return fromPolar(mag, (b * Math.PI) / 180);
}

/** Guess port count from a filename extension like ".s2p" / ".S1P". */
export function portsFromFilename(name: string): number | null {
  const m = /\.s(\d+)p$/i.exec(name.trim());
  return m ? parseInt(m[1], 10) : null;
}

/* ---------- small complex-matrix helpers (n ≤ 2 for Z/Y conversion) ---------- */
type M2 = [[Complex, Complex], [Complex, Complex]];
function inv2(m: M2): M2 | null {
  const det = sub(mul(m[0][0], m[1][1]), mul(m[0][1], m[1][0]));
  if (abs(det) < 1e-300) return null;
  return [
    [div(m[1][1], det), div(c(-m[0][1].re, -m[0][1].im), det)],
    [div(c(-m[1][0].re, -m[1][0].im), det), div(m[0][0], det)],
  ];
}
function mul2(a: M2, b: M2): M2 {
  return [
    [add(mul(a[0][0], b[0][0]), mul(a[0][1], b[1][0])), add(mul(a[0][0], b[0][1]), mul(a[0][1], b[1][1]))],
    [add(mul(a[1][0], b[0][0]), mul(a[1][1], b[1][0])), add(mul(a[1][0], b[0][1]), mul(a[1][1], b[1][1]))],
  ];
}
const I2: M2 = [[ONE, c(0)], [c(0), ONE]];
const addM = (a: M2, b: M2, s = 1): M2 => [
  [add(a[0][0], c(s * b[0][0].re, s * b[0][0].im)), add(a[0][1], c(s * b[0][1].re, s * b[0][1].im))],
  [add(a[1][0], c(s * b[1][0].re, s * b[1][0].im)), add(a[1][1], c(s * b[1][1].re, s * b[1][1].im))],
];

/** Normalised z-matrix → S:  S = (z − I)(z + I)⁻¹  (Pozar 4.3, equal real references). */
export function zToS(z: Complex[][]): Complex[][] | null {
  if (z.length === 1) return [[div(sub(z[0][0], ONE), add(z[0][0], ONE))]];
  if (z.length !== 2) return null;
  const zm = z as unknown as M2;
  const inv = inv2(addM(zm, I2));
  return inv ? (mul2(addM(zm, I2, -1), inv) as unknown as Complex[][]) : null;
}
/** Normalised y-matrix → S:  S = (I − y)(I + y)⁻¹. */
export function yToS(y: Complex[][]): Complex[][] | null {
  if (y.length === 1) return [[div(sub(ONE, y[0][0]), add(ONE, y[0][0]))]];
  if (y.length !== 2) return null;
  const ym = y as unknown as M2;
  const inv = inv2(addM(ym, I2));
  return inv ? (mul2(addM(I2, ym, -1), inv) as unknown as Complex[][]) : null;
}

/* ------------------------------------------------------------------ */

export function parseTouchstone(text: string, filename = 'network.s1p', portsHint?: number): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const err = (message: string, line?: number): ParseResult => {
    diagnostics.push({ level: 'error', message, line });
    return { network: null, diagnostics };
  };
  if (text.length > LIMITS.maxBytes) return err(`File exceeds ${LIMITS.maxBytes / 1048576} MB limit.`);

  const lines = text.split(/\r\n|\r|\n/);
  let version = '1.1';
  let ports = portsHint ?? portsFromFilename(filename) ?? 0;
  let unit = 'GHZ', param: ParamType = 'S', fmt: DataFormat = 'MA', R = 50;
  let optionSeen = false;
  let twoPortOrder: '21_12' | '12_21' = '21_12';
  let matrixFormat = 'FULL';
  let declaredFreqs: number | null = null;
  let inNoise = false;
  let hasNoiseData = false;
  const comments: string[] = [];
  const rows: Array<{ vals: number[]; line: number }> = [];

  for (let li = 0; li < lines.length; li++) {
    let raw = lines[li];
    const bang = raw.indexOf('!');
    if (bang >= 0) {
      const cm = raw.slice(bang + 1).trim();
      if (cm && comments.length < 200) comments.push(cm.slice(0, 500));
      raw = raw.slice(0, bang);
    }
    const s = raw.trim();
    if (!s) continue;

    if (s.startsWith('[')) {
      const m = /^\[([^\]]+)\]\s*(.*)$/.exec(s);
      if (!m) { diagnostics.push({ level: 'warning', line: li + 1, message: 'Malformed keyword line ignored.' }); continue; }
      const key = m[1].trim().toUpperCase();
      const val = m[2].trim();
      switch (key) {
        case 'VERSION': version = val || '2.0'; break;
        case 'NUMBER OF PORTS': ports = parseInt(val, 10); break;
        case 'TWO-PORT DATA ORDER': twoPortOrder = val.replace(/\s/g, '') === '12_21' ? '12_21' : '21_12'; break;
        case 'NUMBER OF FREQUENCIES': declaredFreqs = parseInt(val, 10); break;
        case 'REFERENCE': {
          const r = val.split(/\s+/).map(Number).filter(Number.isFinite);
          if (r.length) {
            R = r[0];
            if (r.some((x) => x !== r[0])) diagnostics.push({ level: 'warning', line: li + 1, message: 'Per-port references differ; port 1 reference is used (full renormalisation is a later feature).' });
          }
          break;
        }
        case 'MATRIX FORMAT': matrixFormat = val.toUpperCase(); break;
        case 'NETWORK DATA': inNoise = false; break;
        case 'NOISE DATA': inNoise = true; hasNoiseData = true; break;
        case 'END': li = lines.length; break;
        default: diagnostics.push({ level: 'info', line: li + 1, message: `Keyword [${m[1]}] not used by this version of the app.` });
      }
      continue;
    }

    if (s.startsWith('#')) {
      if (optionSeen) { diagnostics.push({ level: 'warning', line: li + 1, message: 'Additional option line ignored.' }); continue; }
      optionSeen = true;
      const toks = s.slice(1).trim().split(/\s+/).filter(Boolean);
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i].toUpperCase();
        if (t in UNIT_SCALE) unit = t;
        else if (t === 'S' || t === 'Y' || t === 'Z' || t === 'H' || t === 'G') param = t;
        else if (t === 'RI' || t === 'MA' || t === 'DB') fmt = t;
        else if (t === 'R') {
          const v = parseFloat(toks[i + 1] ?? '');
          if (Number.isFinite(v) && v > 0) { R = v; i++; }
          else diagnostics.push({ level: 'error', line: li + 1, message: 'Option "R" must be followed by a positive reference resistance.' });
        } else diagnostics.push({ level: 'warning', line: li + 1, message: `Unknown option token "${toks[i]}".` });
      }
      continue;
    }

    if (inNoise) continue;
    const toks = s.split(/\s+/);
    const vals = toks.map(Number);
    const bad = vals.findIndex((v) => !Number.isFinite(v));
    if (bad >= 0) { diagnostics.push({ level: 'error', line: li + 1, message: `Non-numeric token "${toks[bad].slice(0, 30)}".` }); continue; }
    rows.push({ vals, line: li + 1 });
  }

  if (!optionSeen) diagnostics.push({ level: 'warning', message: 'No option line found; Touchstone defaults (GHz S MA R 50) assumed.' });
  if (param === 'H' || param === 'G') return err(`${param}-parameter files are not supported yet. Convert to S, Y or Z.`);
  const isV2 = version.startsWith('2');
  if (isV2 && matrixFormat !== 'FULL') return err(`[Matrix Format] ${matrixFormat} is not supported yet; use Full.`);

  if (!ports) {
    // Infer from the first data row: 1 + 2n² values per frequency (n ≤ 2 fit on one line)
    const n0 = rows[0]?.vals.length ?? 0;
    if (n0 === 3) ports = 1; else if (n0 === 9) ports = 2;
    else return err('Cannot determine the number of ports. Use a .sNp file name or [Number of Ports].');
    diagnostics.push({ level: 'info', message: `Port count inferred as ${ports} from the data layout.` });
  }
  if (ports < 1 || ports > LIMITS.maxPorts) return err(`Port count ${ports} outside the supported range 1–${LIMITS.maxPorts}.`);

  const perFreq = 1 + 2 * ports * ports;
  const scaleF = UNIT_SCALE[unit];
  const freqs: number[] = [];
  const s: Complex[][][] = [];

  // Assemble records. For 1- and 2-port files each record is one line; detect noise blocks.
  let buf: number[] = [];
  let lastF = -Infinity;
  for (const r of rows) {
    if (ports === 2 && buf.length === 0 && r.vals.length === 5 && r.vals[0] * scaleF <= lastF) {
      hasNoiseData = true; break; // v1.x noise parameters follow the S-parameter block
    }
    buf.push(...r.vals);
    while (buf.length >= perFreq) {
      const rec = buf.splice(0, perFreq);
      const f = rec[0] * scaleF;
      if (f < 0) { diagnostics.push({ level: 'error', line: r.line, message: 'Negative frequency.' }); continue; }
      if (f <= lastF) {
        if (f === lastF) { diagnostics.push({ level: 'warning', line: r.line, message: `Duplicate frequency ${rec[0]} skipped.` }); continue; }
        return err('Frequencies must be strictly increasing.', r.line);
      }
      lastF = f;
      const m: Complex[][] = Array.from({ length: ports }, () => Array<Complex>(ports).fill(c(0)));
      let k = 1;
      for (let i = 0; i < ports; i++) {
        for (let j = 0; j < ports; j++) {
          m[i][j] = toComplex(rec[k], rec[k + 1], fmt);
          k += 2;
        }
      }
      if (ports === 2 && (!isV2 || twoPortOrder === '21_12')) {
        // Stored row-wise as 11 21 12 22 → swap the off-diagonals into matrix positions
        const t = m[0][1]; m[0][1] = m[1][0]; m[1][0] = t;
      }
      // Convert Z/Y to S. v1.x data are already normalised; v2.0 data are absolute.
      let sm: Complex[][] | null = m;
      if (param === 'Z' || param === 'Y') {
        const k2 = param === 'Z' ? (isV2 ? 1 / R : 1) : (isV2 ? R : 1);
        const n = m.map((row) => row.map((v) => c(v.re * k2, v.im * k2)));
        sm = param === 'Z' ? zToS(n) : yToS(n);
        if (!sm) return err(`${param}→S conversion is supported for 1- and 2-port data only, or the matrix is singular.`, r.line);
      }
      freqs.push(f);
      s.push(sm);
      if (freqs.length > LIMITS.maxFrequencies) return err(`More than ${LIMITS.maxFrequencies} frequency points.`);
    }
  }
  if (buf.length) diagnostics.push({ level: 'warning', message: `${buf.length} trailing values did not form a complete record and were ignored.` });
  if (!freqs.length) return err('No network data found.');
  if (declaredFreqs !== null && declaredFreqs !== freqs.length) diagnostics.push({ level: 'warning', message: `[Number of Frequencies] says ${declaredFreqs} but ${freqs.length} were read.` });

  // Passivity hint for reflection terms
  let active = 0;
  for (const m of s) for (let i = 0; i < ports; i++) if (abs(m[i][i]) > 1 + 1e-9) active++;
  if (active) diagnostics.push({ level: 'info', message: `${active} reflection samples have |S| > 1 (active / negative-resistance). They are plotted outside the unit circle, not clipped.` });

  return {
    network: {
      name: filename,
      ports, freqs, s, z0: R,
      source: { version, param, format: fmt, unit },
      comments,
      hasNoiseData,
    },
    diagnostics,
  };
}

/** Extract S_ij (1-based) as a trace. */
export const selectParameter = (net: Network, i: number, j: number): Complex[] => net.s.map((m) => m[i - 1][j - 1]);

/** Serialise a one-port reflection trace as Touchstone 1.1 S1P (Hz, RI). */
export function serializeS1P(freqs: readonly number[], gamma: readonly Complex[], z0: number, header: string[] = [], format: DataFormat = 'RI'): string {
  const out: string[] = [];
  for (const h of header) out.push(`! ${h.replace(/[\r\n]/g, ' ')}`);
  out.push(`# Hz S ${format} R ${z0}`);
  for (let k = 0; k < freqs.length; k++) {
    const g = gamma[k];
    let a: number, b: number;
    if (format === 'RI') { a = g.re; b = g.im; }
    else { a = format === 'MA' ? abs(g) : 20 * Math.log10(abs(g)); b = deg(arg(g)); }
    out.push(`${freqs[k].toPrecision(12)} ${a.toPrecision(12)} ${b.toPrecision(12)}`);
  }
  return out.join('\n') + '\n';
}
