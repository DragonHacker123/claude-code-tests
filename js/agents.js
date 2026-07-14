/* agents.js — simplified Prison-Architect-style population simulation.
 * ~400 agents sample the population; each has four needs (housing, safety,
 * employment, wellbeing) whose BASELINES derive from what the design states
 * (housing floor, job guarantee/UBS, crime target, QoL floors) and which
 * REACT to disasters and to the design's stated reserves/response capacity. */
(function () {
  const { Z } = window.CityGen;

  const N_AGENTS = 400;

  class Agents {
    constructor(grid, city, sim) {
      this.grid = grid; this.city = city; this.sim = sim;
      this.list = [];
      this.history = { wellbeing: [], unrest: [], displaced: [] };
      this.tick = 0;
      this.baselines = this.deriveBaselines();
      this.spawn();
    }

    deriveBaselines() {
      const f = this.city.figures;
      const has = (k) => f[k] && f[k].status !== 'missing';
      // Housing baseline: floor m2 stated -> 78..88 depending on generosity
      let housing = 70, notes = [];
      if (has('housing_floor_m2_per_person')) {
        const m2 = parseFloat(f.housing_floor_m2_per_person.value) || 30;
        housing = 70 + Math.min(18, (m2 - 25) * 1.6);
      } else notes.push('housing floor not stated — neutral baseline');
      // Employment: job guarantee raises floor
      const mech = JSON.stringify(f.economic_model.mechanisms || '').toLowerCase();
      let employment = mech.includes('job guarantee') ? 85 : 68;
      // Safety: crime target normalised per metric type (not cross-comparable —
      // used only to set THIS city's baseline confidence, never to rank cities)
      let safety = 75;
      if (has('crime_target')) {
        const m = f.crime_target.metric;
        const v = f.crime_target.value;
        if (m === 'homicide') safety = v <= 0.5 ? 90 : v <= 1 ? 88 : 80;
        else if (m === 'violent crime') safety = v <= 150 ? 84 : 76;
        else safety = v <= 20 ? 88 : 78; // total crime target
      } else notes.push('crime target not stated — neutral safety baseline');
      // Wellbeing: QoL floors breadth (noise + green + commute all quantified?)
      let wellbeing = 70;
      for (const k of ['noise_limit_db', 'commute_target', 'green_cover_pct']) if (has(k)) wellbeing += 5;
      return { housing, employment, safety, wellbeing: Math.min(88, wellbeing), notes };
    }

    spawn() {
      const g = this.grid;
      // build sampling table of populated cells
      const cells = [];
      for (let i = 0; i < g.pop.length; i++) if (g.pop[i] > 0 && g.storeys[i] > 0) cells.push(i);
      const civic = [];
      for (let i = 0; i < g.pop.length; i++) if (g.zone[i] === Z.CIVIC || g.zone[i] === Z.INDUSTRIAL) civic.push(i);
      const popPerAgent = g.totalPop / N_AGENTS;
      for (let k = 0; k < N_AGENTS; k++) {
        const home = cells[(Math.random() * cells.length) | 0];
        const work = Math.random() < 0.7
          ? cells[(Math.random() * cells.length) | 0]      // local/mixed-use job
          : civic[(Math.random() * Math.max(1, civic.length)) | 0] || home;
        const b = this.baselines;
        this.list.push({
          home, work, at: home,
          x: home % g.n, y: (home / g.n) | 0,
          tx: home % g.n, ty: (home / g.n) | 0,
          represents: popPerAgent,
          housing: jitter(b.housing), safety: jitter(b.safety),
          employment: jitter(b.employment), wellbeing: jitter(b.wellbeing),
          displaced: false, avg: 70,
          phase: Math.random(),
        });
      }
    }

    shelterCell(fromI) {
      // nearest civic/green cell that is undamaged & dry
      const g = this.grid, sim = this.sim;
      const fx = fromI % g.n, fy = (fromI / g.n) | 0;
      let best = fromI, bd = 1e9;
      for (let i = 0; i < g.pop.length; i += 3) {
        if (g.zone[i] !== Z.CIVIC && g.zone[i] !== Z.GREEN) continue;
        if (sim.damage && sim.damage[i] >= 0.4) continue;
        if (sim.floodDepth && sim.floodDepth[i] > 0.15) continue;
        if (sim.fire && sim.fire.state[i] !== 0) continue;
        const d = Math.hypot((i % g.n) - fx, ((i / g.n) | 0) - fy);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }

    cellHazard(i) {
      const sim = this.sim;
      let h = 0;
      if (sim.fire && sim.fire.state[i] === 1) h = 1;
      else if (sim.fire && sim.fire.state[i] === 2) h = 0.8;
      if (sim.floodDepth && sim.floodDepth[i] > 0.15) h = Math.max(h, Math.min(1, sim.floodDepth[i] / 2 + 0.4));
      if (sim.damage && sim.damage[i] >= 0.75) h = Math.max(h, 0.95);
      else if (sim.damage && sim.damage[i] >= 0.4) h = Math.max(h, 0.6);
      return h;
    }

    step(dt) {
      const g = this.grid, sim = this.sim, b = this.baselines;
      this.tick += dt;
      // recovery capacity from stated reserves & response
      const f = this.city.figures;
      const reserveH = f.local_reserve_hours && f.local_reserve_hours.status !== 'missing' ? parseFloat(f.local_reserve_hours.value) || 0 : 0;
      const foodM = f.food_reserve_months && f.food_reserve_months.status !== 'missing' ? parseFloat(f.food_reserve_months.value) || 0 : 0;
      const recovery = 0.02 + (reserveH >= 72 ? 0.015 : 0) + Math.min(0.02, foodM * 0.002);

      let displaced = 0, unrestCount = 0, wbSum = 0;
      const anyEvent = (sim.fire && !sim.fire.done) || sim.floodDepth || sim.damage;

      for (const a of this.list) {
        // --- movement: commute wander, or flee/shelter ---
        const homeHaz = this.cellHazard(a.home);
        const workHaz = this.cellHazard(a.work);
        if (homeHaz > 0.5 && !a.displaced) {
          a.displaced = true;
          a.shelter = this.shelterCell(a.home);
          a.housing = Math.max(5, a.housing - 55 * homeHaz);
          a.safety = Math.max(5, a.safety - 35 * homeHaz);
        }
        if (a.displaced) {
          const s = a.shelter;
          a.tx = s % g.n; a.ty = (s / g.n) | 0;
          displaced++;
        } else {
          // daily rhythm home<->work
          const atWork = (this.tick * 0.02 + a.phase) % 1 < 0.4;
          const dest = atWork ? a.work : a.home;
          a.tx = dest % g.n; a.ty = (dest / g.n) | 0;
        }
        const sp = 0.5 * dt * 3;
        a.x += Math.sign(a.tx - a.x) * Math.min(sp, Math.abs(a.tx - a.x));
        a.y += Math.sign(a.ty - a.y) * Math.min(sp, Math.abs(a.ty - a.y));

        // --- needs dynamics ---
        if (workHaz > 0.5) a.employment = Math.max(10, a.employment - 20 * dt);
        // ambient fear: nearby active hazard lowers safety
        const ci = g.idx(Math.round(a.x), Math.round(a.y));
        const nearHaz = this.cellHazard(ci);
        if (nearHaz > 0) a.safety = Math.max(5, a.safety - 18 * nearHaz * dt);
        // drift back to baseline at recovery rate (design reserves speed it up)
        const drift = (v, base, rate) => v + (base - v) * rate * dt;
        a.housing = a.displaced ? Math.min(a.housing, 45) : drift(a.housing, b.housing, recovery);
        a.safety = drift(a.safety, anyEvent ? b.safety * 0.75 : b.safety, recovery * (anyEvent ? 0.7 : 1.4));
        a.employment = drift(a.employment, b.employment, recovery);
        // wellbeing follows the other three
        const target = (a.housing + a.safety + a.employment) / 3 * (b.wellbeing / 80);
        a.wellbeing = drift(a.wellbeing, Math.min(95, target), 0.06);
        a.avg = (a.housing + a.safety + a.employment + a.wellbeing) / 4;
        if (a.avg < 40) unrestCount++;
        wbSum += a.wellbeing;
        // displaced agents recover if their home area is safe again
        if (a.displaced && this.cellHazard(a.home) < 0.2 && (!sim.damage || sim.damage[a.home] < 0.4)) {
          if (Math.random() < recovery * dt * 2) { a.displaced = false; a.housing = Math.max(a.housing, 55); }
        }
      }
      const wellbeing = wbSum / this.list.length;
      const unrest = unrestCount / this.list.length * 100;
      if ((this.tick | 0) % 2 === 0) {
        this.history.wellbeing.push(wellbeing);
        this.history.unrest.push(unrest);
        this.history.displaced.push(displaced);
        if (this.history.wellbeing.length > 600) {
          this.history.wellbeing.shift(); this.history.unrest.shift(); this.history.displaced.shift();
        }
      }
      this.stats = {
        wellbeing, unrest,
        displaced, displacedPop: Math.round(displaced * (g.totalPop / N_AGENTS)),
        agents: this.list.length,
      };
    }
  }

  function jitter(v) { return Math.max(5, Math.min(98, v + (Math.random() - 0.5) * 14)); }

  window.CityAgents = { Agents, N_AGENTS };
})();
