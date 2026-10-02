/** Chart colours. Kept in TS (not CSS) so exported SVG/PNG files are self-contained. */
export interface Palette {
  bg: string;            // chart surround
  disk: string;          // inside the unit circle
  rim: string;
  zMajor: string; zMinor: string; zFaint: string;
  yMajor: string; yMinor: string; yFaint: string;
  axis: string;
  label: string; labelDim: string;
  ring: string; ringText: string;
  load: string; input: string;
  series: string; shunt: string; line: string; transformer: string;
  construct: string; constructText: string;
  vswr: string; guide: string;
  traceA: string; traceB: string; applied: string; sweep: string;
  marker: string; hover: string;
  halo: string;
}

export const PALETTES: Record<'dark' | 'light', Palette> = {
  dark: {
    bg: '#0b1017', disk: '#0f1620', rim: '#c9d4e3',
    zMajor: 'rgba(240,128,104,0.62)', zMinor: 'rgba(240,128,104,0.26)', zFaint: 'rgba(240,128,104,0.16)',
    yMajor: 'rgba(86,196,214,0.60)', yMinor: 'rgba(86,196,214,0.25)', yFaint: 'rgba(86,196,214,0.15)',
    axis: 'rgba(201,212,227,0.55)',
    label: 'rgba(222,230,240,0.86)', labelDim: 'rgba(200,210,224,0.55)',
    ring: 'rgba(201,212,227,0.40)', ringText: 'rgba(210,220,232,0.72)',
    load: '#ffb547', input: '#7ee0a1',
    series: '#ffb547', shunt: '#56c4d6', line: '#b79cff', transformer: '#e8eef6',
    construct: '#e9e46a', constructText: '#f3f0a8',
    vswr: 'rgba(255,181,71,0.55)', guide: 'rgba(126,224,161,0.55)',
    traceA: '#5fb3ff', traceB: '#ff6fb1', applied: '#7ee0a1', sweep: '#7ee0a1',
    marker: '#ffffff', hover: 'rgba(255,255,255,0.22)',
    halo: 'rgba(11,16,23,0.85)',
  },
  light: {
    bg: '#f3efe6', disk: '#fffdf8', rim: '#3a3f47',
    zMajor: 'rgba(196,58,36,0.62)', zMinor: 'rgba(196,58,36,0.26)', zFaint: 'rgba(196,58,36,0.15)',
    yMajor: 'rgba(16,122,140,0.62)', yMinor: 'rgba(16,122,140,0.26)', yFaint: 'rgba(16,122,140,0.15)',
    axis: 'rgba(40,44,52,0.55)',
    label: 'rgba(30,34,40,0.88)', labelDim: 'rgba(40,44,52,0.58)',
    ring: 'rgba(40,44,52,0.45)', ringText: 'rgba(30,34,40,0.78)',
    load: '#c46a00', input: '#18864b',
    series: '#c46a00', shunt: '#107a8c', line: '#6b4fd1', transformer: '#30353d',
    construct: '#8a6d00', constructText: '#6b5500',
    vswr: 'rgba(196,106,0,0.55)', guide: 'rgba(24,134,75,0.6)',
    traceA: '#1f6fd1', traceB: '#c2187a', applied: '#18864b', sweep: '#18864b',
    marker: '#111418', hover: 'rgba(0,0,0,0.18)',
    halo: 'rgba(255,253,248,0.9)',
  },
};

/** Linear blend of two #rrggbb colours. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (p: number, s: number) => (p >> s) & 255;
  const m = (s: number) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t);
  return `rgb(${m(16)},${m(8)},${m(0)})`;
}
