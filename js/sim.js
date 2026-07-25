/* sim.js — disaster engines. Each engine parameterises itself ONLY from what
 * the selected design states (materials, spacing, response times, defence
 * heights, seismic basis). Where a figure is missing the engine uses a
 * neutral assumption and reports it through Sim.assumptions so the UI can
 * show "not stated in source" instead of pretending. */
(function () {
  const { Z, MAT } = window.CityGen;

  const N8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

  class Sim {
    constructor(grid, city) {
      this.grid = grid;
      this.city = city;              // normalized city record
      this.fire = null;              // active fire sim
      this.floodDepth = null;        // Float32Array water depth per cell
      this.damage = null;            // Float32Array 0..1 quake damage per cell
      this.destroyedStations = new Set();
      this.clock = 0;                // sim minutes
      this.log = [];
      this.assumptions = [];
      this.stats = {};               // live stats consumed by UI
    }

    note(msg) { this.log.unshift(`[t+${this.clock.toFixed(0)}m] ${msg}`); if (this.log.length > 60) this.log.pop(); }

    /* ---------- FIRE ---------- */
    fig(name) { const f = this.city.figures[name]; return f && f.status !== 'missing' ? f.value : null; }

    startFire(cx, cy) {
      const g = this.grid, i = g.idx(cx, cy);
      if (g.storeys[i] === 0) { this.note('Ignition point has no building — pick a built cell.'); return false; }
      if (!this.fire) {
        this.fire = {
          state: new Uint8Array(g.n * g.n),     // 0 none, 1 burning, 2 burned
          intensity: new Float32Array(g.n * g.n),
          ignitedAt: this.clock,
          crews: [],
          firstArrival: null,
          suppressed: 0,
        };
        // spread parameters from the design's own statements
        const matStated = this.fig('building_materials');
        const spacing = this.city.figures.building_spacing;
        const streetW = this.city.figures.street_width_m;
        // spread probability normalised by cell size so the effective spread
        // speed (m/min) is comparable across the four grids
        this.fire.spreadBase = 0.45 * (30 / g.cellM);
        // stated firebreak/spacing info slows spread; missing info = no credit taken
        this.fire.gapFactor = 1.0;
        if (streetW && streetW.status === 'stated') this.fire.gapFactor *= 0.8;
        if (spacing && spacing.status === 'stated') this.fire.gapFactor *= 0.85;
        if (!spacing || spacing.status === 'missing') {
          this.assumptions.push('Building spacing not stated in source — spread over unbroken fabric assumed (worst case).');
        }
        if (!matStated) this.assumptions.push('Materials not stated — mixed construction assumed.');
        this.dispatchCrews(cx, cy);
      }
      this.fire.state[i] = 1; this.fire.intensity[i] = 1;
      this.note(`Fire ignited at cell (${cx},${cy})${g.pop[i] ? `, ~${Math.round(g.pop[i])} residents in block` : ''}.`);
      return true;
    }

    dispatchCrews(cx, cy) {
      const g = this.grid;
      const respMed = this.fig('fire_response_median_min') || 5; // stated median
      const alive = g.stations.filter(s => (s.kind === 'fire' || s.kind === 'micro') && !this.destroyedStations.has(s));
      if (!this.fig('fire_response_median_min'))
        this.assumptions.push('Fire response time not stated — 5 min generic median assumed.');
      // each surviving station sends one crew; arrival scales the design's stated
      // median by relative distance (stated numbers stay the anchor, not our guess)
      const dists = alive.map(s => {
        const [sx, sy] = g.cellAtWorld(s.wx, s.wy);
        return { s, sx, sy, d: Math.hypot(sx - cx, sy - cy) };
      }).sort((a, b) => a.d - b.d);
      const medianDist = dists.length ? dists[Math.floor(dists.length / 2)].d : 1;
      for (const { s, sx, sy, d } of dists.slice(0, Math.max(4, Math.ceil(dists.length / 2)))) {
        const eta = Math.max(1, respMed * (0.4 + 0.6 * d / Math.max(1, medianDist)));
        // micro-posts are paramedic e-bike/AED posts, not fire apparatus — token suppression only
        this.fire.crews.push({ station: s, x: sx, y: sy, tx: cx, ty: cy, eta: this.clock + eta, state: 'moving', power: s.kind === 'micro' ? 0.15 : 1 });
      }
      this.note(`${this.fire.crews.length} crews dispatched (design median response ${respMed} min).`);
    }

    stepFire(dt) {
      const f = this.fire; if (!f) return;
      const g = this.grid;
      // second alarm: a growing fire pulls in every remaining station
      if (!f.secondAlarm) {
        let burningNow = 0, bx = 0, by = 0;
        for (let i = 0; i < f.state.length; i++) if (f.state[i] === 1) { burningNow++; bx += i % g.n; by += (i / g.n) | 0; }
        if (burningNow > 25) {
          f.secondAlarm = true;
          const cx = Math.round(bx / burningNow), cy = Math.round(by / burningNow);
          const already = new Set(f.crews.map(c => c.station));
          for (const s of g.stations) {
            if (s.kind !== 'fire' && s.kind !== 'micro') continue;
            if (already.has(s) || this.destroyedStations.has(s)) continue;
            const [sx, sy] = g.cellAtWorld(s.wx, s.wy);
            const respMed = this.fig('fire_response_median_min') || 5;
            f.crews.push({ station: s, x: sx, y: sy, tx: cx, ty: cy, eta: this.clock + respMed * 1.5, state: 'moving', power: s.kind === 'micro' ? 0.15 : 1 });
          }
          this.note('Second alarm — all remaining stations dispatched.');
        }
      }
      const matFac = (m) => m === MAT.TIMBER ? 1.3 : m === MAT.CONCRETE ? 0.6 : 1.0;
      // crews move/arrive
      let onScene = 0;
      for (const cr of f.crews) {
        if (cr.state === 'moving') {
          if (this.clock >= cr.eta) {
            cr.state = 'onscene'; cr.x = cr.tx; cr.y = cr.ty;
            if (f.firstArrival === null) {
              f.firstArrival = this.clock - f.ignitedAt;
              this.note(`First crew on scene ${f.firstArrival.toFixed(1)} min after ignition.`);
            }
          } else {
            const t = 1 - (cr.eta - this.clock) / Math.max(0.1, cr.eta - f.ignitedAt);
            const [sx, sy] = g.cellAtWorld(cr.station.wx, cr.station.wy);
            cr.x = sx + (cr.tx - sx) * Math.min(1, t); cr.y = sy + (cr.ty - sy) * Math.min(1, t);
          }
        }
        if (cr.state === 'onscene') onScene++;
      }
      // spread (probabilistic cellular, dt in minutes)
      const toIgnite = [];
      for (let i = 0; i < f.state.length; i++) {
        if (f.state[i] !== 1) continue;
        const x = i % g.n, y = (i / g.n) | 0;
        for (const [dx, dy] of N8) {
          const nx = x + dx, ny = y + dy;
          if (!g.inb(nx, ny)) continue;
          const j = g.idx(nx, ny);
          if (f.state[j] !== 0) continue;
          const zn = g.zone[j];
          if (zn === Z.WATER || zn === Z.OUTSIDE) continue;
          let p = f.spreadBase * matFac(g.mat[j]) * f.gapFactor * dt;
          if (g.firebreak[j] || zn === Z.GREEN || zn === Z.BARRIER) p *= 0.06;
          else if (zn === Z.STREET) p *= 0.22;
          else if (zn === Z.AGRI) p *= 0.55;
          if (g.storeys[j] === 0 && zn !== Z.GREEN && zn !== Z.STREET && zn !== Z.AGRI) p *= 0.2;
          if (Math.random() < p) toIgnite.push(j);
        }
        // burnout
        f.intensity[i] -= dt * 0.04;
        if (f.intensity[i] <= 0) { f.state[i] = 2; }
      }
      for (const j of toIgnite) { f.state[j] = 1; f.intensity[j] = 1; }
      // suppression: each on-scene crew extinguishes near its position
      for (const cr of f.crews) {
        if (cr.state !== 'onscene') continue;
        // move crew toward nearest burning cell
        let best = -1, bd = 1e9;
        for (let i = 0; i < f.state.length; i++) {
          if (f.state[i] !== 1) continue;
          const x = i % g.n, y = (i / g.n) | 0;
          const d = Math.hypot(x - cr.x, y - cr.y);
          if (d < bd) { bd = d; best = i; }
        }
        if (best < 0) continue;
        const bx = best % g.n, by = (best / g.n) | 0;
        cr.x += Math.sign(bx - cr.x) * Math.min(1.4 * dt * 3, Math.abs(bx - cr.x));
        cr.y += Math.sign(by - cr.y) * Math.min(1.4 * dt * 3, Math.abs(by - cr.y));
        if (bd < 3) {
          for (const [dx, dy] of [[0, 0], ...N8]) {
            const nx = Math.round(cr.x) + dx, ny = Math.round(cr.y) + dy;
            if (!g.inb(nx, ny)) continue;
            const j = g.idx(nx, ny);
            if (f.state[j] === 1 && Math.random() < 0.5 * cr.power * dt * 3) {
              f.state[j] = 2; f.intensity[j] = 0; this.fire.suppressed++;
            }
          }
        }
      }
      // stats
      let burning = 0, burned = 0, popAffected = 0;
      for (let i = 0; i < f.state.length; i++) {
        if (f.state[i] === 1) { burning++; popAffected += g.pop[i]; }
        else if (f.state[i] === 2) { burned++; popAffected += g.pop[i]; }
      }
      this.stats.fire = {
        burning, burned,
        areaKm2: (burning + burned) * (g.cellM / 1000) ** 2,
        popAffected: Math.round(popAffected),
        firstArrival: f.firstArrival,
        crewsOnScene: onScene,
      };
      if (burning === 0 && (burned > 0)) {
        this.note(`Fire out. ${burned} blocks lost (${this.stats.fire.areaKm2.toFixed(2)} km²).`);
        this.fire.done = true;
      }
    }

    /* ---------- FLOOD ---------- */
    startFlood(surgeM, mode) {
      const g = this.grid;
      this.floodDepth = new Float32Array(g.n * g.n);
      this.floodSurge = surgeM;
      this.floodMode = mode; // 'surge' | 'rain'
      const cap = this.city.sim_capabilities.flood;
      if (g.coast.barrierAssumed)
        this.assumptions.push(`Coastal barrier height is NOT stated in this design — simulation assumes ${g.coast.barrierElev} m (flagged, see data notes).`);
      this.note(mode === 'surge'
        ? `Storm surge / tsunami of ${surgeM} m triggered (design barrier ~${g.coast.barrierElev} m${g.coast.barrierAssumed ? ', ASSUMED' : ', stated'}).`
        : `Extreme rainfall event triggered (${surgeM} m equivalent ponding).`);
      if (cap.confidence === 'low') this.note('⚠ Low confidence: source design lacks elevation/drainage figures.');
    }

    stepFlood(dt) {
      if (!this.floodDepth) return;
      const g = this.grid, surge = this.floodSurge;
      const next = this.floodDepth;
      // source cells
      if (this.floodMode === 'surge') {
        // water surface at ocean cells = surge height above sea level (0 m),
        // so depth there = surge − elev (ocean bed sits below 0)
        for (let i = 0; i < next.length; i++) {
          if (g.zone[i] === Z.WATER) next[i] = Math.max(next[i], surge - g.elev[i]);
        }
      } else {
        // rain: uniform accumulation on land, drains via green/water
        for (let i = 0; i < next.length; i++) {
          if (g.zone[i] !== Z.WATER && g.zone[i] !== Z.OUTSIDE) next[i] += surge * 0.02 * dt;
        }
      }
      // simple hydraulic relaxation: water flows to lower total head
      const n = g.n;
      for (let pass = 0; pass < 2; pass++) {
        for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
          const i = y * n + x;
          const hi = g.elev[i] + next[i];
          for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
            const j = (y + dy) * n + (x + dx);
            const hj = g.elev[j] + next[j];
            const diff = hi - hj;
            if (diff > 0.05 && next[i] > 0.02) {
              const flow = Math.min(next[i], diff / 2) * 0.4 * dt;
              next[i] -= flow;
              if (g.zone[j] !== Z.WATER) next[j] += flow;
            }
          }
        }
        // drainage: green wedges/floodways and water absorb
        for (let i = 0; i < next.length; i++) {
          if (next[i] <= 0) continue;
          if (g.zone[i] === Z.GREEN) next[i] = Math.max(0, next[i] - 0.10 * dt);
          else next[i] = Math.max(0, next[i] - 0.005 * dt); // generic infiltration
        }
      }
      // stats
      let flooded = 0, popAffected = 0, deep = 0;
      for (let i = 0; i < next.length; i++) {
        if (g.zone[i] === Z.WATER) continue;
        if (next[i] > 0.15) { flooded++; popAffected += g.pop[i]; if (next[i] > 1) deep++; }
      }
      this.stats.flood = {
        areaKm2: flooded * (g.cellM / 1000) ** 2,
        popAffected: Math.round(popAffected),
        deepCells: deep,
        surge,
      };
    }

    /* ---------- EARTHQUAKE ---------- */
    triggerQuake(mag) {
      const g = this.grid;
      this.damage = new Float32Array(g.n * g.n);
      // design basis from the source, or flagged generic
      let basis = 8.0, basisStated = true;
      const sb = this.city.figures.seismic_design_basis;
      // Only a MAGNITUDE counts as a basis we can score damage against. A return
      // period ("2,475-year event") or a performance framework ("MCE, Immediate
      // Occupancy") is a real design basis but not a magnitude — those fall back
      // to a generic M8.0 and are flagged, rather than having a stray number
      // (the "2" of "2,475") misread as a magnitude.
      const sbTxt = String(sb.value);
      const basisMatch = sb.status === 'missing' ? null
        : (sbTxt.match(/\bM\s*(\d(?:\.\d+)?)/i) || sbTxt.match(/(\d(?:\.\d+)?)\s*Mw/i));
      if (!basisMatch) {
        basisStated = false;
        this.assumptions.push('Seismic design basis states no magnitude in source (return period or performance framework only) — generic M8.0 MCE assumed (flagged).');
      } else {
        basis = parseFloat(basisMatch[1]);
      }
      const softBan = this.city.figures.soft_storey_ban;
      const exceed = mag - basis;   // how far beyond design basis
      const baseP = exceed <= -1 ? 0.02 : exceed <= 0 ? 0.05 + 0.05 * (exceed + 1) : 0.10 + 0.28 * Math.min(2, exceed);
      let collapsed = 0, heavy = 0, moderate = 0, popExposed = 0, critSaved = 0;
      for (let i = 0; i < g.n * g.n; i++) {
        if (g.storeys[i] === 0) continue;
        let p = baseP;
        p *= g.mat[i] === MAT.TIMBER ? 0.8 : g.mat[i] === MAT.CONCRETE ? 0.95 : 1.0; // CLT lighter mass
        p *= 1 + (g.storeys[i] > 12 ? 0.35 : g.storeys[i] > 8 ? 0.2 : 0);
        if (softBan && softBan.value === true) p *= 0.75;   // stated soft-storey ban removes dominant collapse mode
        if (g.critical[i]) { p *= 0.12; critSaved++; }       // base isolation (scope per design)
        const r = Math.random();
        let d = 0;
        if (r < p * 0.25) d = 0.9;         // collapse
        else if (r < p * 0.6) d = 0.55;    // heavy
        else if (r < p) d = 0.25;          // moderate
        this.damage[i] = d;
        if (d >= 0.75) { collapsed++; popExposed += g.pop[i]; }
        else if (d >= 0.4) { heavy++; popExposed += g.pop[i] * 0.5; }
        else if (d > 0) moderate++;
      }
      // stations: unisolated stations can be lost when quake exceeds basis;
      // all four designs base-isolate their stations to some degree — but only
      // fable & sonnet/opus state it for stations explicitly.
      this.destroyedStations.clear();
      const isoScope = String(this.city.figures.base_isolation_scope.value || '');
      const stationsIsolated = /station|hub|micro|emergency/i.test(isoScope);
      const lossP = stationsIsolated ? Math.max(0, exceed) * 0.08 : 0.15 + Math.max(0, exceed) * 0.2;
      for (const s of this.grid.stations) {
        if (Math.random() < lossP) this.destroyedStations.add(s);
      }
      // post-quake ignitions: designs with a gas grid unknown get ignition risk;
      // Meridian-F states all-electric (no gas) -> ignitions suppressed.
      const gas = this.city.figures.gas_grid;
      let ignitions = 0;
      const allElectric = gas.status === 'stated' && /none|all-electric/i.test(String(gas.value));
      if (!allElectric && (collapsed + heavy) > 0) {
        ignitions = Math.min(4, Math.max(1, Math.round((collapsed + heavy) / 400)));
        if (gas.status === 'missing') this.assumptions.push('Gas grid / ignition sources not stated — post-quake ignition risk assumed present.');
      }
      const ignited = [];
      for (let k = 0; k < ignitions; k++) {
        for (let tries = 0; tries < 200; tries++) {
          const i = (Math.random() * g.n * g.n) | 0;
          if (this.damage[i] >= 0.4 && g.storeys[i] > 0) { ignited.push(i); break; }
        }
      }
      for (const i of ignited) this.startFire(i % g.n, (i / g.n) | 0);
      this.stats.quake = {
        magnitude: mag, basis, basisStated,
        collapsed, heavy, moderate,
        popExposed: Math.round(popExposed),
        stationsLost: this.destroyedStations.size,
        stationsTotal: g.stations.filter(s => s.kind === 'fire' || s.kind === 'micro').length,
        ignitions: ignited.length,
      };
      this.note(`M${mag.toFixed(1)} earthquake (design basis M${basis}${basisStated ? '' : ' ASSUMED'}): ${collapsed} blocks collapsed, ${heavy} heavy damage, ${this.destroyedStations.size} stations lost${allElectric ? ', no gas ignitions (all-electric city, stated)' : `, ${ignited.length} fires ignited`}.`);
    }

    step(dt) {
      this.clock += dt;
      if (this.fire && !this.fire.done) this.stepFire(dt);
      if (this.floodDepth) this.stepFlood(dt);
    }

    reset() {
      this.fire = null; this.floodDepth = null; this.damage = null;
      this.destroyedStations.clear();
      this.clock = 0; this.stats = {}; this.assumptions = []; this.log = [];
    }
  }

  window.CitySim = { Sim };
})();
