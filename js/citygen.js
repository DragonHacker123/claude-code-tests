/* citygen.js — builds a simulation grid for each of the four city designs,
 * procedurally, from the geometry each design STATES in its masterplan.
 * Where a design does not state a parameter (street widths, elevations…)
 * the generator uses a neutral default and the fact is surfaced in the UI
 * via sim_capabilities notes — never silently invented as a design claim.
 *
 * Grid cell zones: */
const Z = {
  OUTSIDE: 0, WATER: 1, CIVIC: 2, RES_DENSE: 3, RES_MED: 4,
  INDUSTRIAL: 5, AGRI: 6, GREEN: 7, STREET: 8, BARRIER: 9,
};
/* materials */
const MAT = { MIXED: 0, TIMBER: 1, CONCRETE: 2 };

function makeGrid(n, cellM) {
  const size = n * n;
  return {
    n, cellM,                       // n x n cells, cellM metres per cell side
    zone: new Uint8Array(size),
    pop: new Float32Array(size),    // residents per cell
    storeys: new Uint8Array(size),
    mat: new Uint8Array(size),
    elev: new Float32Array(size),   // metres above sea level
    firebreak: new Uint8Array(size),
    critical: new Uint8Array(size), // 1 = base-isolated critical facility cell
    stations: [],                   // {x,y,kind:'fire'|'hospital'|'police'}
    idx(x, y) { return y * this.n + x; },
    inb(x, y) { return x >= 0 && y >= 0 && x < this.n && y < this.n; },
    // world coords in metres, origin at grid centre
    world(x, y) { const h = this.n / 2; return [(x - h) * this.cellM, (y - h) * this.cellM]; },
    cellAtWorld(wx, wy) {
      const h = this.n / 2;
      return [Math.round(wx / this.cellM + h), Math.round(wy / this.cellM + h)];
    },
  };
}

function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

/* point-in-hexagon test (flat-top), centre (cx,cy), circumradius R (metres) */
function inHex(px, py, cx, cy, R) {
  const dx = Math.abs(px - cx) / R, dy = Math.abs(py - cy) / R;
  const a = Math.sqrt(3) / 2;
  return dy <= a && a * dx + 0.5 * dy <= a; // flat-top hexagon
}
/* pointy-top hex test */
function inHexPointy(px, py, cx, cy, R) { return inHex(py, px, cy, cx, R); }

/* deterministic per-cell hash noise (so maps are stable between runs) */
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) | 0; h = Math.imul(h, 1274126177);
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

/* ================= SOLARIS (claude-code-haiku) =================
 * Concentric rings, 25 km radius habitable city. Coastal (tsunami defences
 * stated), so an ocean strip is placed to the west with the stated 5 m dunes.
 * Building spacing & street widths are NOT stated -> uniform ring fabric. */
function genSolaris() {
  const g = makeGrid(126, 400);          // 50.4 km span
  const R = 25000;
  const COAST_X = -24000;                 // ocean west of this line
  const ringPop = [20000, 150000, 150000, 50000, 100000]; // §1.1 (+ residual core)
  const ringCells = [0, 0, 0, 0, 0];
  const ringOf = (d) => d < 2000 ? 0 : d < 7000 ? 1 : d < 12000 ? 2 : d < 16000 ? 3 : d < 25000 ? 4 : -1;

  for (let y = 0; y < g.n; y++) for (let x = 0; x < g.n; x++) {
    const [wx, wy] = g.world(x, y);
    const i = g.idx(x, y);
    if (wx < COAST_X) { g.zone[i] = Z.WATER; g.elev[i] = -5; continue; }
    const d = dist(wx, wy, 0, 0);
    const r = ringOf(d);
    if (r < 0) { g.zone[i] = Z.OUTSIDE; g.elev[i] = 6; continue; }
    ringCells[r]++;
    g.elev[i] = 5;                        // site elevations NOT stated — flat default
    if (wx < COAST_X + 800) { g.zone[i] = Z.BARRIER; g.elev[i] = 10; g.firebreak[i] = 1; continue; } // 5 m dunes on 5 m base
    // radial canal corridors every 22.5° (stated) act as green/water breaks
    const ang = Math.atan2(wy, wx);
    const sector = ((ang / Math.PI * 8) % 1 + 1) % 1;
    if (r >= 1 && r <= 3 && Math.abs(sector - 0.5) < 0.018) { g.zone[i] = Z.GREEN; g.firebreak[i] = 1; continue; }
    // pocket parks every 200 m stated -> sprinkle green cells in residential
    if ((r === 1 || r === 2) && hash2(x, y) < 0.10) { g.zone[i] = Z.GREEN; g.firebreak[i] = 1; continue; }
    switch (r) {
      case 0: g.zone[i] = Z.CIVIC; g.storeys[i] = 10; g.mat[i] = MAT.CONCRETE; g.critical[i] = 1; break;
      case 1: g.zone[i] = Z.RES_DENSE; g.storeys[i] = 30; g.mat[i] = MAT.MIXED; g.critical[i] = 1; break; // >=8 storeys => base-isolated (stated scope)
      case 2: g.zone[i] = Z.RES_MED; g.storeys[i] = 12; g.mat[i] = MAT.MIXED; g.critical[i] = 1; break;   // 8–15 storeys, still >=8
      case 3: g.zone[i] = Z.INDUSTRIAL; g.storeys[i] = 3; g.mat[i] = MAT.CONCRETE; break;
      case 4: g.zone[i] = Z.AGRI; g.storeys[i] = 1; g.mat[i] = MAT.TIMBER; break;
    }
  }
  // distribute stated ring populations over generated cells
  const perCell = ringPop.map((p, r) => p / Math.max(1, ringCells[r]));
  for (let y = 0; y < g.n; y++) for (let x = 0; x < g.n; x++) {
    const i = g.idx(x, y);
    if ([Z.CIVIC, Z.RES_DENSE, Z.RES_MED, Z.INDUSTRIAL, Z.AGRI].includes(g.zone[i])) {
      const [wx, wy] = g.world(x, y);
      const r = ringOf(dist(wx, wy, 0, 0));
      if (r >= 0) g.pop[i] = perCell[r];
    }
  }
  // 17 fire stations (stated): 1 core hub + 6 ring1 + 6 ring2 + 3 ring3/4 + (1 hinterland, off-map)
  g.stations.push({ wx: 0, wy: 0, kind: 'fire' });
  for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; g.stations.push({ wx: 4500 * Math.cos(a), wy: 4500 * Math.sin(a), kind: 'fire' }); }
  for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + Math.PI / 6; g.stations.push({ wx: 9500 * Math.cos(a), wy: 9500 * Math.sin(a), kind: 'fire' }); }
  for (let k = 0; k < 3; k++) { const a = k * 2 * Math.PI / 3; g.stations.push({ wx: 17000 * Math.cos(a), wy: 17000 * Math.sin(a), kind: 'fire' }); }
  // hospitals: 1 trauma centre core + 6 district (stated)
  g.stations.push({ wx: 500, wy: 500, kind: 'hospital' });
  for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + 0.3; g.stations.push({ wx: 8000 * Math.cos(a), wy: 8000 * Math.sin(a), kind: 'hospital' }); }
  // police: 1 central + 10 district + 1 outer (12 stated)
  g.stations.push({ wx: -500, wy: -500, kind: 'police' });
  for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5; g.stations.push({ wx: 6500 * Math.cos(a), wy: 6500 * Math.sin(a), kind: 'police' }); }
  g.stations.push({ wx: 14000, wy: 0, kind: 'police' });
  g.coast = { dir: 'west', barrierElev: 10, surfaceElev: 5 };
  g.coastLine = COAST_X;
  return g;
}

/* ================= MERIDIAN-S (claude-code-sonnet) =================
 * Fractal hex-of-hexes: civic core + 6 districts; district = hub cell + 6 cells;
 * cell apothem 400 m; 180 m green buffers between districts (stated firebreaks).
 * Critical services on +15–20 m podium network (stated). */
function genMeridianS() {
  const g = makeGrid(116, 80);            // 9.28 km span
  const CELL_R = 462;                      // circumradius from 400 m apothem
  const CELL_SP = 800;                     // tangent hex spacing (2×apothem)
  const districts = [];                    // 7 groups of 7 cell-centres
  const distR = 2 * CELL_SP * Math.cos(Math.PI / 6) + 180 + 900; // ≈ centre-to-centre w/ buffer
  const DC = [[0, 0]];
  for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + Math.PI / 6; DC.push([2950 * Math.cos(a), 2950 * Math.sin(a)]); }
  for (const [dcx, dcy] of DC) {
    const cells = [[dcx, dcy]];
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; cells.push([dcx + CELL_SP * Math.cos(a), dcy + CELL_SP * Math.sin(a)]); }
    districts.push(cells);
  }
  const resCellPop = 467031 / (6 * 6 + 6 * 0.35 + 7 * 0.35); // res cells + hub-cell housing fractions (0.35 stated in geometry script)
  for (let y = 0; y < g.n; y++) for (let x = 0; x < g.n; x++) {
    const [wx, wy] = g.world(x, y); const i = g.idx(x, y);
    if (wx < -4550) { g.zone[i] = Z.WATER; g.elev[i] = -5; continue; }
    g.zone[i] = Z.OUTSIDE; g.elev[i] = 5;
    if (wx < -4300) { g.zone[i] = Z.BARRIER; g.elev[i] = 12; g.firebreak[i] = 1; continue; } // dune+seawall layer (design height NOT stated; 12 m assumption flagged in UI)
    let placed = false;
    for (let d = 0; d < districts.length && !placed; d++) {
      for (let c = 0; c < 7 && !placed; c++) {
        const [ccx, ccy] = districts[d][c];
        if (inHex(wx, wy, ccx, ccy, CELL_R)) {
          const isHubCell = c === 0;               // district hub cell (or civic core when d==0)
          const dHub = dist(wx, wy, ccx, ccy);
          if (dHub < 140) {                        // cell hub: clinic/school/EMS micro-post
            g.zone[i] = Z.CIVIC; g.storeys[i] = 4; g.mat[i] = MAT.CONCRETE; g.critical[i] = 1; g.elev[i] = isHubCell ? 17 : 6; // hub podium +15–20 m (stated)
          } else if (dHub > CELL_R * 0.82) {       // shared green edge (stated)
            g.zone[i] = Z.GREEN; g.firebreak[i] = 1; g.elev[i] = 5;
          } else if (isHubCell) {
            if (d === 0) { g.zone[i] = Z.CIVIC; g.storeys[i] = 8; g.mat[i] = MAT.CONCRETE; g.elev[i] = 17; g.critical[i] = 1; }
            else {
              g.zone[i] = Z.CIVIC; g.storeys[i] = hash2(x, y) < 0.08 ? 28 : 6; // 25–30 st landmark towers at district hubs (stated)
              g.mat[i] = MAT.CONCRETE; g.elev[i] = 17; g.critical[i] = 1;
              g.pop[i] = resCellPop * 0.35 / 90;
            }
          } else {
            g.zone[i] = Z.RES_MED; g.storeys[i] = 8; g.mat[i] = MAT.MIXED;    // 6–10 storey mixed-use (stated: RC or mass timber)
            g.elev[i] = 5; g.pop[i] = 0;                                       // pop set after counting
            placed = true; g.pop[i] = -1 - d * 10 - c;                         // tag for later fill
          }
          placed = true;
        }
      }
    }
  }
  // count residential cells per hex-cell and assign stated population evenly
  let resCount = 0;
  for (let i = 0; i < g.pop.length; i++) if (g.pop[i] < 0) resCount++;
  const perCell = (467031 * 0.88) / Math.max(1, resCount); // 12% approx in hub-cell housing already assigned
  for (let i = 0; i < g.pop.length; i++) if (g.pop[i] < 0) g.pop[i] = perCell;
  // stations: main fire/EMS at 6 district hubs; micro-post at every cell hub; hospitals at district hubs
  for (let d = 1; d < 7; d++) {
    const [hx, hy] = districts[d][0];
    g.stations.push({ wx: hx, wy: hy, kind: 'fire' });
    g.stations.push({ wx: hx + 120, wy: hy + 120, kind: 'hospital' });
  }
  for (let d = 0; d < 7; d++) for (let c = 0; c < 7; c++) {
    if (d >= 1 && c === 0) continue;
    const [hx, hy] = districts[d][c];
    g.stations.push({ wx: hx, wy: hy, kind: 'micro' });   // paramedic e-bike + AED drone micro-post
  }
  g.coast = { dir: 'west', barrierElev: 12, surfaceElev: 5, barrierAssumed: true };
  g.coastLine = -4550;
  return g;
}

/* ================= CIVITAS (claude-code-opus) =================
 * Single flat-top hexagon, circumradius 2,630 m; civic core r=460 m; six wedge
 * districts; 5–8 storey perimeter blocks. Street/block dims NOT stated ->
 * approximated 3-cell blocks; core on raised terp (height NOT stated). */
function genCivitas() {
  const g = makeGrid(118, 50);            // 5.9 km span
  const R = 2630;
  const hubs = [[0, 0]];
  for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + Math.PI / 6; hubs.push([1650 * Math.cos(a), 1650 * Math.sin(a)]); }
  let resCells = 0;
  for (let y = 0; y < g.n; y++) for (let x = 0; x < g.n; x++) {
    const [wx, wy] = g.world(x, y); const i = g.idx(x, y);
    if (wy > 2750) { g.zone[i] = Z.WATER; g.elev[i] = -5; continue; }  // coastal module: sea to the south
    g.elev[i] = 5;
    if (!inHex(wx, wy, 0, 0, R)) {
      if (wy > 2550 && Math.abs(wx) < 2800) { g.zone[i] = Z.BARRIER; g.elev[i] = 9; g.firebreak[i] = 1; } // forested berm+mangrove (height NOT stated; 9 m assumption flagged)
      else g.zone[i] = Z.OUTSIDE;
      continue;
    }
    const dC = dist(wx, wy, 0, 0);
    if (dC < 460) { // civic core on engineered terp (raised ground stated, height not)
      g.zone[i] = Z.CIVIC; g.storeys[i] = 12; g.mat[i] = MAT.CONCRETE; g.critical[i] = 1; g.elev[i] = 12;
      continue;
    }
    // district hub pockets
    let hub = false;
    for (let k = 1; k < 7; k++) if (dist(wx, wy, hubs[k][0], hubs[k][1]) < 180) { hub = true; break; }
    if (hub) { g.zone[i] = Z.CIVIC; g.storeys[i] = 6; g.mat[i] = MAT.CONCRETE; g.critical[i] = 1; g.elev[i] = 6; continue; }
    // seaward 300 m band: sacrificial flow-through pilotis blocks (stated)
    const seaward = wy > 2100;
    // perimeter-block fabric with courtyards (block grid NOT stated: 3-cell approximation)
    const bx = x % 4, by = y % 4;
    if (bx === 3 || by === 3) { g.zone[i] = Z.STREET; g.elev[i] = seaward ? 5 : 5; continue; }
    if (bx === 1 && by === 1) { g.zone[i] = Z.GREEN; g.firebreak[i] = 1; continue; }  // courtyard (30% canopy stated)
    g.zone[i] = Z.RES_MED; g.storeys[i] = 6; g.mat[i] = MAT.MIXED; g.elev[i] = 5;
    if (seaward) { g.storeys[i] = 6; g.elev[i] = 5.5; }  // habitable floors elevated on pilotis
    g.pop[i] = -1; resCells++;
  }
  const perCell = 250000 / Math.max(1, resCells);
  for (let i = 0; i < g.pop.length; i++) if (g.pop[i] < 0) g.pop[i] = perCell;
  // 7 integrated hubs (fire+EMS+police), hospital in core (stated)
  g.stations.push({ wx: 0, wy: 0, kind: 'fire' });
  g.stations.push({ wx: 150, wy: -150, kind: 'hospital' });
  g.stations.push({ wx: -150, wy: 150, kind: 'police' });
  for (let k = 1; k < 7; k++) {
    g.stations.push({ wx: hubs[k][0], wy: hubs[k][1], kind: 'fire' });
    g.stations.push({ wx: hubs[k][0] + 100, wy: hubs[k][1] + 100, kind: 'police' });
  }
  g.coast = { dir: 'south', barrierElev: 9, surfaceElev: 5, barrierAssumed: true };
  g.coastLine = 2750;
  return g;
}

/* ================= MERIDIAN-F (claude-code-fable/worldwide-city) =================
 * Hex flower: 1 core + 6 petals, 3.0 km flat-to-flat each; 130 m perimeter-block
 * grid with 20 m streets (stated); six green wedges (firebreaks/floodways);
 * coastal berm +15 m; sacrificial 400 m waterfront band; 33-station lattice. */
function genMeridianF() {
  const g = makeGrid(132, 80);            // 10.56 km span
  const HEX_R = 1732;                      // circumradius of 3.0 km flat-to-flat hex
  const SP = 3200;                         // petal centre spacing (3.0 km + ~200 m wedge gap)
  const centers = [[0, 0]];
  for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; centers.push([SP * Math.cos(a), SP * Math.sin(a)]); }
  const COAST_Y = 4400;
  let resCells = 0;
  for (let y = 0; y < g.n; y++) for (let x = 0; x < g.n; x++) {
    const [wx, wy] = g.world(x, y); const i = g.idx(x, y);
    if (wy > COAST_Y + 300) { g.zone[i] = Z.WATER; g.elev[i] = -5; continue; }
    if (wy > COAST_Y && Math.abs(wx) < 5200) { g.zone[i] = Z.BARRIER; g.elev[i] = 15; g.firebreak[i] = 1; continue; } // +15 m landscape berm (STATED)
    g.elev[i] = 6;
    let d = -1;
    for (let k = 0; k < 7; k++) if (inHexPointy(wx, wy, centers[k][0], centers[k][1], HEX_R)) { d = k; break; }
    if (d < 0) {
      // between petals: green wedges (stated: firebreaks, floodways, staging)
      if (dist(wx, wy, 0, 0) < SP + HEX_R * 0.9) { g.zone[i] = Z.GREEN; g.firebreak[i] = 1; g.elev[i] = 3; } // floodway wedges sit low
      else g.zone[i] = Z.OUTSIDE;
      continue;
    }
    const [ccx, ccy] = centers[d];
    const dHub = dist(wx, wy, ccx, ccy);
    // sacrificial waterfront band: first 400 m from berm — no ground-floor housing (stated)
    const sacrificial = wy > COAST_Y - 400;
    if (dHub < 400) {  // district centre: 12–20 storey cluster + transit hub + civic (stated)
      g.zone[i] = Z.CIVIC; g.storeys[i] = 16; g.mat[i] = MAT.CONCRETE; g.critical[i] = 1;
      g.pop[i] = -0.5; resCells += 0.5;
      continue;
    }
    // 130 m block grid, 20 m streets (stated) — cell 80 m: alternate 2-cell blocks/1 street lane approximates 130/20
    const bx = Math.floor((wx + 26400) / 80), by = Math.floor((wy + 26400) / 80);
    if (bx % 2 === 1 && by % 2 === 1) { g.zone[i] = Z.GREEN; g.firebreak[i] = 0; continue; }   // courtyard
    if ((bx + by) % 5 === 0) { g.zone[i] = Z.STREET; continue; }                                // street share ≈ stated 20/150
    if (sacrificial) { g.zone[i] = Z.INDUSTRIAL; g.storeys[i] = 4; g.mat[i] = MAT.CONCRETE; g.pop[i] = 0; continue; } // port/market/workshops band
    g.zone[i] = Z.RES_MED; g.storeys[i] = 7; g.mat[i] = MAT.MIXED;  // CLT or RC perimeter blocks (stated)
    g.pop[i] = -1; resCells++;
  }
  const perCell = 1000000 / Math.max(1, resCells);
  for (let i = 0; i < g.pop.length; i++) if (g.pop[i] < 0) g.pop[i] = perCell * (g.pop[i] === -0.5 ? 0.5 : 1);
  // 33 micro-stations on ~1.4 km triangular lattice (stated)
  const pts = [];
  for (let row = -4; row <= 4; row++) for (let col = -4; col <= 4; col++) {
    const wx = col * 1400 + (row % 2 ? 700 : 0), wy = row * 1212;
    let inside = false;
    for (let k = 0; k < 7; k++) if (inHexPointy(wx, wy, centers[k][0], centers[k][1], HEX_R * 0.98)) { inside = true; break; }
    if (inside) pts.push([wx, wy]);
  }
  pts.sort((a, b) => dist(a[0], a[1], 0, 0) - dist(b[0], b[1], 0, 0));
  for (const [wx, wy] of pts.slice(0, 33)) g.stations.push({ wx, wy, kind: 'fire' });
  // 4 hospitals: core + 3 alternating petals (stated)
  g.stations.push({ wx: 200, wy: 200, kind: 'hospital' });
  for (const k of [1, 3, 5]) g.stations.push({ wx: centers[k][0], wy: centers[k][1] + 250, kind: 'hospital' });
  g.coast = { dir: 'south', barrierElev: 15, surfaceElev: 6 };
  g.coastLine = COAST_Y + 300;
  return g;
}

/* ================= RESILIENT CITY (chat-gpt-code) =================
 * ChatGPT's design: a 5×5 array of 2×2 km mixed-use districts (10×10 km,
 * 1M people, 10,000/km²). One combined fire/medical/rescue station + a
 * water/refuge tower per district; 5 hospitals (centre + 4 quadrant
 * centres); 6–18 storeys; superblocks with a redundant street grid; green
 * corridors double as firebreaks. Coastal variant: avoidance-first — an
 * uninhabited wetland/floodable-park belt, development set landward. Block
 * grid dimension is NOT stated, so a 400 m superblock grid is assumed. */
function genResilientCity() {
  const g = makeGrid(140, 80);            // 11.2 km span, 10 km city centred
  const HALF = 5000;                       // 10×10 km urban square
  const COAST_Y = 4600;                    // wetland belt seaward of this
  const centers = [];
  for (const gx of [-4000, -2000, 0, 2000, 4000])
    for (const gy of [-4000, -2000, 0, 2000, 4000]) centers.push([gx, gy]);
  const hospitals = [[0, 0], [-3000, -3000], [3000, -3000], [-3000, 3000], [3000, 3000]];
  let resCells = 0;
  for (let y = 0; y < g.n; y++) for (let x = 0; x < g.n; x++) {
    const [wx, wy] = g.world(x, y); const i = g.idx(x, y);
    if (wy > 5300) { g.zone[i] = Z.WATER; g.elev[i] = -5; continue; }
    g.elev[i] = 6;
    if (wy > COAST_Y) {                     // uninhabited wetland/floodable-park belt (avoidance-first, not a wall)
      g.zone[i] = Z.BARRIER; g.firebreak[i] = 1; g.elev[i] = 8; continue;
    }
    if (Math.abs(wx) > HALF || wy < -HALF) { g.zone[i] = Z.OUTSIDE; continue; }
    // nearest district centre
    let dc = null, bd = 1e9;
    for (const c of centers) { const d = Math.max(Math.abs(wx - c[0]), Math.abs(wy - c[1])); if (d < bd) { bd = d; dc = c; } }
    const dCen = Math.hypot(wx - dc[0], wy - dc[1]);
    // district-boundary green corridors / firebreaks (every 2 km, ±70 m)
    const nearBoundaryX = Math.abs(((wx + 5000 + 1000) % 2000) - 1000) > 930;
    const nearBoundaryY = Math.abs(((wy + 5000 + 1000) % 2000) - 1000) > 930;
    if (nearBoundaryX || nearBoundaryY) { g.zone[i] = Z.GREEN; g.firebreak[i] = 1; continue; }
    // district centre: combined emergency station + water/refuge tower + civic
    if (dCen < 150) { g.zone[i] = Z.CIVIC; g.storeys[i] = 8; g.mat[i] = MAT.CONCRETE; g.critical[i] = 1; continue; }
    // a neighbourhood park near each centre (green within 300 m)
    if (dCen > 250 && dCen < 360 && ((x + y) % 3 === 0)) { g.zone[i] = Z.GREEN; g.firebreak[i] = 1; continue; }
    // superblock grid: streets on a ~400 m lattice (ASSUMED — not stated)
    const sbx = ((wx % 400) + 400) % 400, sby = ((wy % 400) + 400) % 400;
    if (sbx < 80 || sby < 80) { g.zone[i] = Z.STREET; continue; }
    // residential/mixed-use perimeter fabric, 6–18 storeys (taller near centre)
    g.zone[i] = Z.RES_MED;
    g.storeys[i] = dCen < 700 ? (hash2(x, y) < 0.2 ? 16 : 10) : (hash2(x, y) < 0.15 ? 12 : 7);
    g.mat[i] = hash2(x + 7, y) < 0.4 ? MAT.TIMBER : MAT.MIXED;   // engineered timber or RC (stated)
    if (hash2(x, y + 3) < 0.06) g.critical[i] = 1;               // selected base-isolated residential (stated)
    g.pop[i] = -1; resCells++;
  }
  const perCell = 1000000 / Math.max(1, resCells);
  for (let i = 0; i < g.pop.length; i++) if (g.pop[i] < 0) g.pop[i] = perCell;
  // 25 combined stations at district centres; 5 hospitals; water/refuge towers co-located
  for (const [cx, cy] of centers) g.stations.push({ wx: cx, wy: cy, kind: 'fire' });
  for (const [cx, cy] of hospitals) g.stations.push({ wx: cx + 120, wy: cy + 120, kind: 'hospital' });
  g.coast = { dir: 'south', barrierElev: 8, surfaceElev: 6, barrierAssumed: true };
  g.coastLine = 5300;
  return g;
}

/* ================= HEARTH (claude-code-opus, Opus 5) =================
 * Hexagon circumradius 2,630 m (17.97 km², 5.26 km across), 250,000 people —
 * the same outer hexagon as CIVITAS, but a completely different interior:
 * 6 districts × 10 wards = 60 ward hubs, each within a 5-min walk; a 100 m
 * block lattice with 12 m lanes / 22 m collectors (400 m) / 34 m avenues
 * (800 m); land is 25% street, 22% park, 50% plots and 0% parking.
 * 5–8 storey mass-timber perimeter blocks. Coastal: a 12 m engineered berm
 * backed by a ~1.5 km coastal forest belt.
 * The 7 fire/EMS station positions below are the ACTUAL coordinates its own
 * models/outputs/response_times.json reports from its p-median optimisation. */
function genHearth() {
  const g = makeGrid(180, 50);            // 9.0 km span
  const R = 2630;
  const WARD_SP = 590;                     // 60 wards over 17.97 km² → ~590 m hub lattice
  const COAST_Y = 4000, BERM_Y = 3700, FOREST_Y = 2300;
  // ward hub lattice (hex packing), keep the 60 innermost
  const wards = [];
  for (let row = -6; row <= 6; row++) for (let col = -6; col <= 6; col++) {
    const wx = col * WARD_SP + (row % 2 ? WARD_SP / 2 : 0);
    const wy = row * WARD_SP * Math.sqrt(3) / 2;
    if (inHex(wx, wy, 0, 0, R * 0.93)) wards.push([wx, wy]);
  }
  wards.sort((a, b) => dist(a[0], a[1], 0, 0) - dist(b[0], b[1], 0, 0));
  wards.length = Math.min(60, wards.length);
  // 6 district centres (health centre + market + secondary school)
  const districts = [];
  for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + Math.PI / 6; districts.push([1450 * Math.cos(a), 1450 * Math.sin(a)]); }
  let resCells = 0;
  for (let y = 0; y < g.n; y++) for (let x = 0; x < g.n; x++) {
    const [wx, wy] = g.world(x, y); const i = g.idx(x, y);
    if (wy > COAST_Y) { g.zone[i] = Z.WATER; g.elev[i] = -5; continue; }
    g.elev[i] = 8;
    if (wy > BERM_Y) { g.zone[i] = Z.BARRIER; g.elev[i] = 12; g.firebreak[i] = 1; continue; }  // 12 m engineered berm (STATED)
    if (wy > FOREST_Y) { g.zone[i] = Z.GREEN; g.firebreak[i] = 1; g.elev[i] = 8; continue; }   // ~1.5 km coastal forest belt (STATED)
    if (!inHex(wx, wy, 0, 0, R)) { g.zone[i] = Z.AGRI; g.storeys[i] = 0; continue; }           // territory: cropland/forest
    // civic core: acute hospital + EOC (base-isolated critical class)
    if (dist(wx, wy, 0, 0) < 260) { g.zone[i] = Z.CIVIC; g.storeys[i] = 6; g.mat[i] = MAT.CONCRETE; g.critical[i] = 1; continue; }
    // district centres: health centre, market, secondary school (health centre is base-isolated)
    let atDistrict = false;
    for (const [dx, dy] of districts) if (dist(wx, wy, dx, dy) < 150) { atDistrict = true; break; }
    if (atDistrict) { g.zone[i] = Z.CIVIC; g.storeys[i] = 5; g.mat[i] = MAT.CONCRETE; g.critical[i] = 1; continue; }
    // nearest ward hub
    let wc = null, wd = 1e9, wi = 0;
    for (let k = 0; k < wards.length; k++) { const d = dist(wx, wy, wards[k][0], wards[k][1]); if (d < wd) { wd = d; wc = wards[k]; wi = k; } }
    if (wd < 70) { g.zone[i] = Z.CIVIC; g.storeys[i] = 3; g.mat[i] = MAT.TIMBER; continue; }   // ward hub (cache + cool refuge; NOT in the base-isolation scope)
    // one park per ward, offset from the hub — delivers the stated 22% green
    // and "park within 300 m" without ringing the hub
    if (wc) {
      const pa = wi * 2.399963;                                       // golden-angle offset so parks don't line up
      const px = wc[0] + 205 * Math.cos(pa), py = wc[1] + 205 * Math.sin(pa);
      if (dist(wx, wy, px, py) < 150) { g.zone[i] = Z.GREEN; g.firebreak[i] = 1; continue; }
    }
    // street lattice: 34 m avenues every 800 m, 22 m collectors every 400 m.
    // (The 100 m / 12 m lane lattice is finer than this 50 m grid can draw —
    // its containment is credited via the stated-street-width factor in sim.js.)
    const ax = Math.abs(((wx % 800) + 800 + 400) % 800 - 400) > 375;
    const ay = Math.abs(((wy % 800) + 800 + 400) % 800 - 400) > 375;
    const cx = Math.abs(((wx % 400) + 400 + 200) % 400 - 200) > 180;
    const cy = Math.abs(((wy % 400) + 400 + 200) % 400 - 200) > 180;
    if (ax || ay || cx || cy) { g.zone[i] = Z.STREET; continue; }
    // 5–8 storey mass-timber perimeter blocks (mean 4.5 storeys city-wide)
    g.zone[i] = Z.RES_MED;
    g.storeys[i] = hash2(x, y) < 0.35 ? 5 : hash2(x, y) < 0.8 ? 6 : 8;
    g.mat[i] = MAT.TIMBER;                                            // CLT/glulam (stated) — lighter seismic mass, but combustible
    g.pop[i] = -1; resCells++;
  }
  const perCell = 250000 / Math.max(1, resCells);
  for (let i = 0; i < g.pop.length; i++) if (g.pop[i] < 0) g.pop[i] = perCell;
  // 7 fire/EMS stations — the p-median coordinates its own model computed
  for (const [sx, sy] of [[-800, 0], [800, -400], [0, 1600], [-200, -2000], [1600, 0], [-1800, 0], [-1800, -800]])
    g.stations.push({ wx: sx, wy: sy, kind: 'fire' });
  // 60 ward posts: duty first responder on an e-bike + pre-positioned cache
  for (const [wx2, wy2] of wards) g.stations.push({ wx: wx2, wy: wy2, kind: 'micro' });
  // acute hospital (core) + 6 district health centres
  g.stations.push({ wx: 150, wy: -150, kind: 'hospital' });
  for (const [dx, dy] of districts) g.stations.push({ wx: dx, wy: dy + 90, kind: 'hospital' });
  g.coast = { dir: 'south', barrierElev: 12, surfaceElev: 8 };
  g.coastLine = COAST_Y;
  return g;
}

const CITY_BUILDERS = {
  'solaris': genSolaris,
  'meridian-s': genMeridianS,
  'civitas': genCivitas,
  'meridian-f': genMeridianF,
  'resilient-city': genResilientCity,
  'hearth': genHearth,
};

/* stated on-map population per design (Solaris: 520k minus 50k rotational
 * hinterland workers who live outside the mapped 25 km city) */
const POP_TARGET = { 'solaris': 470000, 'meridian-s': 467031, 'civitas': 250000, 'meridian-f': 1000000, 'resilient-city': 1000000, 'hearth': 250000 };

/* neutral geography applied identically to all four cities: land rises gently
 * inland from the coast (0.7 m/km). None of the designs maps terrain heights;
 * this shared assumption is what makes surge flooding physically sane, and it
 * is the SAME for every city so it never favours one design. */
function applyCoastSlope(g) {
  const slope = 0.7; // m per km inland
  for (let y = 0; y < g.n; y++) for (let x = 0; x < g.n; x++) {
    const i = g.idx(x, y);
    if (g.zone[i] === Z.WATER) continue;
    const [wx, wy] = g.world(x, y);
    let dKm = 0;
    if (g.coast.dir === 'west') dKm = Math.max(0, (wx - g.coastLine) / 1000);
    else dKm = Math.max(0, (g.coastLine - wy) / 1000);
    g.elev[i] += dKm * slope;
  }
}

function buildCity(id) {
  const g = CITY_BUILDERS[id]();
  applyCoastSlope(g);
  // normalise so the grid carries exactly the population the design states —
  // the grid only distributes it spatially
  let pop = 0, built = 0;
  for (let i = 0; i < g.pop.length; i++) { pop += g.pop[i]; if (g.storeys[i] > 0) built++; }
  const scale = POP_TARGET[id] / Math.max(1, pop);
  for (let i = 0; i < g.pop.length; i++) g.pop[i] *= scale;
  g.totalPop = POP_TARGET[id]; g.builtCells = built;
  return g;
}

window.CityGen = { Z, MAT, buildCity, distOf: dist };
