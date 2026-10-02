# Browser Smith Chart

**Live app → [waltzy27.github.io/BrowserSmithChart](https://waltzy27.github.io/BrowserSmithChart/)**

An interactive Smith chart that runs in any modern browser, on desktop and on phones. It works like a paper chart: place a load, use a compass and protractor, rotate along lines, and add series or shunt reactance along the correct contours. It also does the math and shows every equation with live numbers. Nothing to install. It works offline once loaded, and you can install it as an app (PWA).

## Features (v0.1)

**Chart**
- Impedance (Z), admittance (Y), and combined ZY / YZ grids.
- The grid adapts to the zoom level.
- Angle-of-Γ and wavelengths-toward-generator / wavelengths-toward-load (WTG/WTL) scale rings.
- Constant-r/x/g/b reading circles appear under the cursor.
- Pan and zoom with the mouse wheel, trackpad, or a two-finger pinch.
- Snapping to grid values, to the r = 1 / g = 1 guide circles, to design points, and to the centre.

**Digital drafting tools**
- **Compass:** draws circles. A circle centred on the chart reads |Γ|, SWR, and return loss.
- **Protractor:** draws radials. It reads ∠Γ and the WTG/WTL position, plus Δλ between two radials.
- **Dividers:** measure distances.
- Constructions are listed, selectable, and deletable.

**Design chain** (applied from the load toward the generator)
- Series and shunt R, L, and C.
- Transmission lines with their own Z0, length in λ or degrees, loss, and velocity factor.
- Short or open stubs, connected in series or shunt.
- Ideal n:1 transformer.
- Every element is drawn along its physically correct contour, and you can drag it on the chart to change its value.
- Paper-chart Z ↔ Y (180° reflection) helper.

**Inspector**
- Γ in rectangular, polar, and dB-polar form; z, Z, y, and Y.
- VSWR, return loss, mismatch loss, and reflected/accepted power.
- WTG/WTL position, series and parallel R-L-C equivalents, node Q, and the region of the chart.
- A live cursor readout.

**Calculators**
- Converter between |Γ|, VSWR, return loss, and mismatch loss.
- Reactance ⇄ L/C at a chosen frequency.
- Wavelength and electrical/physical line length, with velocity factor or ε_eff.

**Matching synthesis**
- L-sections (all valid topologies).
- Single stubs: shunt or series, open or short, with both solutions.
- Quarter-wave transformers, including complex loads via the voltage-max or voltage-min position.
- One click applies a solution to the chart. Every solution is checked by cascading it (residual |Γ_in| < 10⁻⁶).

**Equations tab**
- KaTeX-rendered equations with Pozar equation numbers.
- Live substitution for the selected point.
- A worked "selected step" showing the algebra for the chosen element.
- A paper-chart workflow guide.

**Data**
- Touchstone import (files are read locally and never uploaded):
  - v1.x and core v2.0
  - S1P and S2P (and S3P/S4P diagonal terms)
  - RI, MA, and DB formats
  - S, Z, and Y data
- Bundled example files and drag-and-drop onto the chart.
- Frequency-coloured traces, S11/S22/S21/S12 selection, and an option to apply the design network to measured data.
- Markers you can drag along a trace, plus an "at minimum |Γ|" search.
- A |Γ| vs. frequency plot with SWR ≤ 2 bandwidth.

**Files**
- Export the chart as SVG or PNG.
- Export Touchstone S1P and marker CSV.
- Save and open project files as JSON; projects also autosave.
- Undo and redo.

## Verified math

The math kernel (`src/math`, `src/rf`, `src/io`) is plain TypeScript with no DOM dependencies. It is tested against worked examples from D. M. Pozar, *Microwave Engineering*, 4th ed., and against golden values from [scikit-rf](https://scikit-rf.org/). CI runs all 60 tests before every deploy.

| Check | Expected (Pozar) | Result |
| --- | --- | --- |
| Ex. 2.2: z_L = 0.4 + j0.7, \|Γ\|, SWR, RL, ∠Γ, WTG | 0.59, 3.87, 4.6 dB, 104°, 0.106λ | 0.5890, 3.866, 4.60 dB, 104.04°, 0.1055λ |
| Ex. 2.2: Z_in after a 0.3λ line on 100 Ω | 36.5 − j61.1 Ω, ∠Γ 248° | 36.534 − j61.119 Ω (scikit-rf agrees) |
| Ex. 2.3: y_in after 0.15λ | 0.61 + j0.66 | ✓ |
| Ex. 2.5: quarter-wave transformer 100 Ω → 50 Ω | Z1 = 70.71 Ω | 70.711 Ω |
| Ex. 5.1: L-section, 200 − j100 Ω → 100 Ω at 500 MHz | 0.92 pF + 38.8 nH; 46.1 nH + 2.61 pF | 0.92 pF + 38.98 nH (unrounded; Pozar rounds x = 1.22); 46.1 nH + 2.61 pF |
| Ex. 5.2: shunt short stub, 60 − j80 Ω, 50 Ω | d = 0.110 / 0.260λ, ℓ = 0.095 / 0.405λ | 0.1104 / 0.2594λ, 0.0950 / 0.4050λ |
| Ex. 5.3: series open stub, 100 + j80 Ω | d = 0.120 / 0.463λ, ℓ = 0.397 / 0.103λ | ✓ |
| Lossy lines (2.90, 2.91), Touchstone RI/MA/DB, Z/Y → S | scikit-rf 2.1 | agree to < 10⁻⁹ |

The tests also cover identities: Γ ↔ z round trips, Z/Y being a 180° reflection, points lying on their r/x/g/b/Q circles, λ/2 periodicity, clockwise 2βℓ rotation, and lossless lines preserving |Γ|.

Conventions: e^{+jωt}. The inductive half is on top. Moving toward the generator is a clockwise rotation, Γ(ℓ) = Γ_L e^{−2jβℓ} (Pozar 2.42). WTG = 0 at the short-circuit point.

## Architecture

```
src/
  math/   complex.ts  smith.ts  units.ts      pure math kernel (Γ↔z, circles, metrics, WTG)
  rf/     network.ts  matching.ts             element models, Γ-domain cascade, synthesis
  io/     touchstone.ts                       parser/serializer with diagnostics
  state/  store.ts  derive.ts                 immutable state, undo/redo, autosave, memoized derivation
  ui/     chart.ts                            layered SVG grid → canvas traces → SVG interaction + HUD
          panel*.ts  dom.ts  readout.ts       panels, inputs (engineering notation: "2.2n", "500 MHz")
public/   sw.js  manifest.webmanifest  examples/*.s1p|s2p
tests/    Vitest suites + scikit-rf golden fixtures (scripts/make_fixtures.py)
```

- **Single source of truth.** The chain of elements and the load live in one immutable state object. The chart, panels, equations, and exports are all derived from that state, so they always agree.
- **Γ-domain arithmetic.** Elements are applied as Möbius maps in the Γ plane, so open and short circuits stay finite and exact.
- **Constraint drag.** Dragging a point solves for the element value that lands nearest the pointer on that element's contour. A series L stays on its constant-r circle; a line stays on its SWR circle or spiral.
- **Rendering.** The static grid is cached as SVG. Dense traces are drawn on canvas. Interactive overlays use SVG with Pointer Events (mouse, pen, and touch).

## Run locally

```bash
npm ci
npm run dev        # http://localhost:5173
npm test           # math verification
npm run build      # type-check + production build to dist/
```

`scripts/make_fixtures.py` (Python + scikit-rf) regenerates the example Touchstone files and the golden test data.

## Deployment

Every push to `main` runs `.github/workflows/pages.yml`: tests, type-check, build, then deploy `dist/` to GitHub Pages.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md):
- v0.2 adds nonideal components, Pi/T networks with chosen Q, double stubs, multi-section transformers, and Web Worker sweeps.
- v0.3 adds an optimizer, Monte Carlo, stability/gain/noise circles, N-port renormalization, and TDR.
- v0.4 adds live NanoVNA input over Web Serial, a guided lessons mode, and a 3D Smith chart.

## License

See [LICENSE](LICENSE).
