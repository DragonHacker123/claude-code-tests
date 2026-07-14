# City Design Sandbox

An interactive stress-test of four independently-designed *self-sufficient,
worldwide-replicable city* blueprints, normalised to one schema and run through
fire, flood, earthquake and a needs-based population simulation.

The four source designs were each built from the same brief but by different
models, and they disagree — in scale, in what they measure, and in how much
detail they commit to. This project's whole point is to compare them **honestly**:
where a design doesn't state a figure, it is marked `MISSING`, never inferred.

| Design | Source repo | Form | Population |
|---|---|---|---|
| **Solaris** | `claude-code-haiku` | Concentric rings, 25 km radius | 520,000 |
| **Meridian (Sonnet)** | `claude-code-sonnet` | Fractal hex-of-hexes | 467,031 |
| **CIVITAS** | `claude-code-opus` | Single hexagon module | 250,000 |
| **Meridian (Fable)** | `claude-code-fable/worldwide-city` | Hex flower (7 districts) | 1,000,000 |

## Deliverables

| File | What it is |
|---|---|
| **`index.html`** | The sandbox web app — open it in a browser (or serve the folder). No build step, no network. |
| **`data/normalized_cities.json`** | The single source of truth: every key figure from all four repos in one schema, each tagged `stated` / `derived` / `missing`. |
| **`city_comparison.xlsx`** | The spreadsheet comparison (4 sheets: Overview, Full Comparison, Data Gaps, Legend). Missing figures are shaded orange and labelled; derived figures are blue with the formula in a cell comment. |
| **`js/`** | App source: `citygen.js` (builds each city's sim grid from its stated geometry), `sim.js` (fire/flood/quake engines), `agents.js` (population sim), `compare.js`, `render.js`, `main.js`. |
| **`tools/`** | `gen_data_js.py` (regenerates `js/data.js` from the JSON), `build_xlsx.py` (regenerates the spreadsheet). |

## Running it

```bash
# Option A — just open it
open index.html            # data is bundled into js/data.js, so file:// works

# Option B — serve (identical result)
python3 -m http.server 8000   # then open http://localhost:8000
```

**Regenerate derived artifacts** after editing `data/normalized_cities.json`:

```bash
python3 tools/gen_data_js.py   # -> js/data.js (what the app reads)
python3 tools/build_xlsx.py    # -> city_comparison.xlsx  (needs: pip install openpyxl)
```

## Using the sandbox

1. **Pick a design** from the top bar. The map is generated procedurally from
   *that design's own* stated geometry (ring radii, hex sizes, block grid,
   station layout, coastal defences).
2. **Compare tab** — side-by-side minimaps of all four forms, the full
   normalised table (hover any cell for its source and definition), and the
   comparability warnings you must read before ranking anything.
3. **Sandbox tab** — pick a tool and act on the map:
   - 🔥 **Fire** — click a building to ignite it. Spread uses the design's stated
     materials, spacing/firebreaks and street widths; crews arrive on the design's
     stated response times.
   - 🌊 **Flood** — trigger a coastal surge/tsunami (scaled against the design's
     stated barrier height) or extreme rainfall, or click to pond water locally.
   - 🫨 **Earthquake** — set a magnitude; damage is scored against the design's
     stated seismic basis, base-isolation scope and soft-storey rules, and can
     knock out stations and (if the design doesn't ban gas) start fires.
   - 👥 **Population sim** — ~400 sampled agents with housing / safety /
     employment / wellbeing needs whose baselines come from the design's stated
     standards (housing floor, job guarantee, crime target, QoL floors) and which
     react live to the disasters above. Watch wellbeing, unrest and displacement.
4. **Data confidence** is shown for every tool. Where a design is missing the
   detail needed to simulate something accurately, the app says so in the UI and
   lists the assumption it was forced to make — it does not quietly guess.

## How the "honesty" rule works in the simulation

The engines are anchored to **stated** figures and degrade transparently when a
figure is missing:

- **Fire** takes credit for narrower streets or firebreak buffers *only if the
  design states them*. Solaris states neither street widths nor block spacing, so
  its fire spreads over unbroken fabric (worst case) and the UI flags that as a
  forced assumption. Meridian (Fable) states a 130 m block grid, 20 m streets and
  wedge firebreaks, so it earns the containment those buy.
- **Earthquake** reads each design's magnitude basis. CIVITAS and Meridian
  (Sonnet) give a performance framework but **no magnitude number**, so the app
  assumes a generic M8.0 MCE and says so. Meridian (Fable) states it bans gas and
  is all-electric, so its quakes don't spawn fires; the others, silent on gas, do.
- **Flood** scales against the stated barrier height where given (Meridian-F +15 m,
  Solaris 15 m tsunami design). Where the barrier height is **not** stated
  (Meridian-S, CIVITAS), the app picks a placeholder, flags it as assumed, and the
  flood tool runs at low confidence. No design maps terrain, so a single gentle
  coastal slope is applied **identically to all four** — a shared assumption that
  never favours one design.
- **Population** baselines are derived, not asserted: a stated job guarantee lifts
  the employment baseline; a stated 35 m² housing floor lifts housing; quantified
  noise/green/commute floors lift wellbeing. Missing standards fall back to a
  neutral baseline (noted on-screen).

---

# Data gaps found in the source repos

Normalising four independent designs surfaced **45 missing figures** and several
structural incompatibilities. Here is what was missing and how each was handled.

## Missing-figure counts

| Design | Figures missing (of 49) | Simulation impact |
|---|---|---|
| Meridian (Fable) | 5 | Lowest — richest, most quantified design |
| Solaris | 10 | Fire/flood at **low** confidence (no spacing, no terrain) |
| Meridian (Sonnet) | 14 | Flood tsunami height missing; fire OK via firebreaks |
| CIVITAS | 16 | No seismic magnitude; flood defences unnumbered |

The full per-figure list with reasons is in the **Data Gaps** sheet of the xlsx
and in `data/normalized_cities.json` (`status: "missing"` entries).

## The gaps that most affected simulation

- **Building spacing / street widths.** Only Meridian (Fable) dimensions its
  fabric (130 m blocks, 20 m streets). Solaris, Meridian (Sonnet) and CIVITAS
  describe typologies but give no grid dimensions, so intra-city fire spread is
  approximated from density and flagged. **Handling:** no credit taken for
  spacing that isn't stated; the app shows the forced worst-case assumption.
- **Seismic design magnitude.** Solaris (M9.0) and Meridian (Fable) (site MCE,
  M8+/M7) commit to a number. CIVITAS and Meridian (Sonnet) give only a
  performance framework ("Life Safety / Immediate Occupancy", "M9-class"). **Handling:**
  a generic M8.0 MCE is assumed for the unnumbered ones and labelled `ASSUMED` in
  the readout.
- **Tsunami / surge design height.** Solaris (15 m) and Meridian (Fable) (+15 m
  berm) state it. Meridian (Sonnet) references "the design tsunami height" without
  ever giving it; CIVITAS's coastal defences are entirely unnumbered. **Handling:**
  a placeholder barrier height is used and marked assumed; the flood tool drops to
  low confidence for those designs.
- **Terrain / elevation.** No design publishes a heightmap. **Handling:** one
  gentle coast-to-inland slope is applied identically to all four so surge
  physics are sane and even-handed.
- **Gas grid / ignition sources.** Only Meridian (Fable) explicitly states it is
  all-electric with no gas (removing the post-quake ignition source). **Handling:**
  designs silent on gas are assumed to carry post-quake ignition risk (flagged).

## Structural incompatibilities (recorded as comparability warnings)

These aren't missing values — they're cases where the same column means different
things, so ranking on them would be dishonest. All three are surfaced at the top
of the Compare tab and the xlsx Overview:

1. **Crime targets are different metrics.** Solaris: 15 *total* crimes/100k.
   Meridian (Sonnet): <150 *violent* crimes/100k. CIVITAS: <1 *homicide*/100k.
   Meridian (Fable): <0.5 *homicide*/100k. Each carries a `metric` field; they are
   never compared as a single number.
2. **Response times use different definitions.** Some designs report travel-only
   time, others end-to-end (call → on-scene, including dispatch and turnout). Each
   figure carries a `definition` field noting which.
3. **Density basis differs.** Solaris's stated area includes agricultural rings
   *inside* the city boundary; the others exclude their hinterland. Solaris never
   states a built-up-only density, so that cell is `MISSING` rather than a
   misleading whole-footprint average.

## A data-quality note (not a gap, but recorded)

Solaris's food self-sufficiency is **internally inconsistent** between sections of
its own masterplan (a "60% of grains" target header vs. a "2.25 Mt/yr grain
surplus" claim vs. an iteration-log note that 50% of meat must be imported). This
is recorded verbatim in the schema's `note` field rather than silently reconciled —
the normalisation reports what the source says, contradictions included.

## What was deliberately **not** done

- No figure was invented to fill a blank. Missing means missing.
- No design was "helped" by importing another design's number.
- Simulation placeholder assumptions (generic magnitudes, barrier heights, the
  coastal slope) are applied evenly and surfaced in the UI — they drive the
  *simulation*, and are never written back into the comparison data as if the
  design had stated them.
