# Roadmap and future add-ons

Version 0.1 is the first build: the analytic math kernel plus the interactive drafting layer. These add-ons are grouped by priority. Each one also lists the main design point to settle before building it.

## Version 0.2 — finish the Phase 1 MVP

| Add-on | Why | Design notes |
| --- | --- | --- |
| Drag-and-drop schematic strip | You can already reorder the chain with arrows. A small horizontal schematic would let users drag elements directly, so the topology is visible at a glance. | It should render from the same `elements[]` array as the chart, so the chain is still the only source of truth. |
| Nonideal components | Real inductors and capacitors have finite Q and self-resonance. With finite Q, a "lossless" match turns into a spiral. | Add an optional `{ q, srf, esr }` per lumped element. Use Q(f) = Q0 at f0. The model for self-resonant frequency (SRF) is a series RLC (for an L, add a parallel C). Pozar §6.1 and vendor datasheets cover these models. |
| Pi and T synthesis with a chosen loaded Q | This lets users set bandwidth on purpose. An L-section fixes Q at √(R_high/R_low − 1). | Build it as two L-sections back to back through a virtual resistance R_v = R_high/(1 + Q²) for a Pi, or the dual for a T. Draw the chosen Q arc on the chart. |
| Double- and triple-stub tuners | Classic textbook content (Pozar §5.3). The "forbidden region" circle is a strong teaching aid. | Draw the rotated g = 1 circle. Show the forbidden region when y_L falls inside g > 1/sin²βd. |
| Multi-section transformers | Binomial and Chebyshev (Pozar §5.6–5.8). Shows the trade-off between bandwidth and ripple. | It needs a small synthesis table for N ≤ 7. Check the results against Pozar Tables 5.1 and 5.2. |
| IndexedDB project library | `localStorage` holds about 5 MB, and large Touchstone files do not fit. | Keep the current JSON schema (`browser-smith-chart` v1) and store the files in a key-value database. |
| Web Worker for sweeps and import | Keeps the UI at 60 fps on 10k-point files and Monte Carlo runs. | The kernel is pure and DOM-free, so it can run in a worker with no changes. |

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
