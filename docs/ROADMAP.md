# Roadmap and future add-ons

Version 0.1 is the first build: the analytic math kernel plus the interactive drafting layer. These add-ons are grouped by priority. Each one also lists the main design point to settle before building it.

## Version 0.2 — done (released as v0.2.0)

| Add-on | Status | As built |
| --- | --- | --- |
| Drag-and-drop schematic strip | Done | `src/ui/schematic.ts`. It renders from `elements[]`. Reordering uses Pointer Events: mouse and pen drag right away, touch uses press-and-hold, and the keyboard uses Alt + ←/→. |
| Non-ideal components | Done | Optional `q` (unloaded Q at f0, fixed-ESR model) and `srf` per L/C. Inductors get a parallel C_p = 1/(ω_s²L) and capacitors a series L_s = 1/(ω_s²C). Constraint drag is refined by Newton iteration. |
| Pi and T synthesis with a chosen Q | Done | Virtual resistance R_v = R_high/(1 + Q²) for a Pi, or R_low(1 + Q²) for a T, built from two L-sections (5.3)/(5.6). Every solution is verified by cascade. |
| Double- and triple-stub tuners | Done | Uses (5.21)–(5.24). The chart shows the rotated g = 1 circle and the forbidden region. The triple stub searches the stub-1 length numerically and keeps the shortest total stub length. |
| Multi-section transformers | Done | Binomial and Chebyshev, N ≤ 7. Each comes as a small-reflection design (5.53)/(5.61)–(5.63) and an exact design, which fits the insertion-loss function by Levenberg–Marquardt. The exact designs match Tables 5.1/5.2. |
| IndexedDB project library | Done | `src/state/library.ts`. Autosave falls back to IndexedDB when localStorage is full. The autosave key is now per version (`…:project:v2`), and older work migrates on first start. |
| Web Worker for import | Done | Touchstone files over 256 kB are parsed in a module worker. Applying the network to a trace stays on the main thread, but is decimated while you drag (10k points × 6 elements ≈ 75 ms per full evaluation, measured). Moving that work to a worker is left for v0.3, alongside the optimizer and Monte Carlo. |
| Version archive and menu | Done (added) | `versions.json`, `scripts/build-archives.mjs`, and the header badge. Every release stays live at `/vX.Y/`. |

## Version 0.3 — analysis tools

| Add-on | Why | Design notes |
| --- | --- | --- |
| Optimizer | Tune element values toward a target (for example, VSWR ≤ 1.5 across a band). | Start with Nelder–Mead or Levenberg–Marquardt on band-weighted |Γ|², limited to locked or unlocked elements. Run it in a worker. |
| Tolerance and Monte Carlo cloud | Shows how sensitive a match is to component tolerance (±5% L, ±0.1 pF C). | Plot the scatter cloud at f0 plus the yield percentage against a VSWR mask. |
| Amplifier circles | Input and output stability circles, constant-gain circles (G_A, G_P, G_T), noise circles, and the K–Δ and μ tests (Pozar Ch. 12). | The S2P importer already loads all four S-parameters. Noise circles also need the noise block (Fmin, Γopt, Rn), which the parser currently skips. |
| Full N-port renormalization and de-embedding | Today only 1-port data is renormalized. | Use S′ = A⁻¹(S − Γ)(I − ΓS)⁻¹A (Kurokawa power waves). Add cascading of S2P fixtures and de-embedding (T-parameters). |
| Time-domain view (TDR) | Shows where a discontinuity sits along the line. It mirrors the low-pass and band-pass modes found in VNAs and in [scikit-rf's time-domain tools](https://scikit-rf.readthedocs.io/en/latest/examples/networktheory/Time%20Domain.html). | Use an inverse FFT with Kaiser windows and time gating, then convert the gated result back to a Smith trace. |
| Touchstone 2.1 extras | Mixed-mode and per-port reference keywords from the [IBIS Touchstone 2.1 specification](https://ibis.org/touchstone_ver2.1/) (ratified January 2024). | The parser architecture already reads keywords; it needs more parameter keywords and matrix formats. |

## Version 0.4 — hardware and learning

| Add-on | Why | Design notes |
| --- | --- | --- |
| Live NanoVNA over Web Serial | Stream live sweeps straight onto the chart with nothing to install, much like the community [NanoVNA web client](https://nanovna.com/?page_id=26). | The [Web Serial API](https://developer.chrome.com/docs/capabilities/serial) works only in Chromium-based browsers, so treat it as progressive enhancement. Parse the `scan`/`data` text protocol in a worker and reuse the trace and marker system. |
| Guided lessons mode | Step-by-step textbook problems with checkpoints, for example "rotate 0.3λ toward the generator — now read the WTG". | Make the lessons data-driven (JSON), with checks run against kernel values within a set tolerance. |
| 3D / Riemann-sphere Smith chart | Shows |Γ| > 1 (active devices) and infinity without clipping. See [3D Smith chart](https://www.3dsmithchart.com/). | Use a separate WebGL view that shares the kernel. |
| Printable worksheet export | Export a high-resolution, paper-style chart with your constructions, for homework. | Use the existing SVG export at A4/Letter size, with an optional blank chart. |
| Localisation and units | Switch between metric and imperial lengths and between decimal comma and point. | Run every displayed number through `units.ts`. |

## Engineering and quality items

- Add Playwright end-to-end tests: Pozar Ex. 2.2 through the UI, matching-synthesis "apply" flows, and touch gestures, run in CI next to the Vitest kernel tests.
- Add property-based tests (fast-check) for the transforms: Γ ↔ z round trips, |Γ| preserved by lossless lines, cascade associativity.
- Run an accessibility audit with axe-core in CI, and add keyboard construction of compass and protractor objects.
- Add a performance budget: keep the bundle (gzip) under 150 kB of JS, excluding KaTeX fonts, and make the first chart render on a mid-range phone in under 1 second.
