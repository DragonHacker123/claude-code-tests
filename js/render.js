/* render.js — canvas renderer for the city grid + simulation overlays.
 * Dark-surface palette; zone colours are muted so event overlays dominate. */
(function () {
  const { Z } = window.CityGen;

  const ZONE_COLORS = {
    [Z.OUTSIDE]: '#0d0d0d',
    [Z.WATER]: '#132430',
    [Z.CIVIC]: '#5a5648',
    [Z.RES_DENSE]: '#41403b',
    [Z.RES_MED]: '#393835',
    [Z.INDUSTRIAL]: '#332d26',
    [Z.AGRI]: '#232a1a',
    [Z.GREEN]: '#1c2b1c',
    [Z.STREET]: '#262624',
    [Z.BARRIER]: '#3e3a2c',
  };

  class MapView {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.scale = 1; this.ox = 0; this.oy = 0; // pan/zoom in canvas px
      this.grid = null;
      this._base = null; // offscreen base map
      this.showStations = true;
      this.showAgents = true;
      this._bindInput();
    }

    setGrid(grid) {
      this.grid = grid;
      this._base = document.createElement('canvas');
      this._base.width = grid.n; this._base.height = grid.n;
      const bctx = this._base.getContext('2d');
      const img = bctx.createImageData(grid.n, grid.n);
      for (let i = 0; i < grid.n * grid.n; i++) {
        const c = this._zoneColor(grid, i);
        img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
      }
      bctx.putImageData(img, 0, 0);
      this.fit();
    }

    _zoneColor(grid, i) {
      const hex = ZONE_COLORS[grid.zone[i]] || '#0d0d0d';
      let [r, g, b] = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
      // subtle per-cell variation + storey lightening so fabric reads as buildings
      const v = (hash(i) - 0.5) * 12;
      const s = grid.storeys[i] * 1.1;
      return [clamp(r + v + s), clamp(g + v + s), clamp(b + v + s)];
    }

    fit() {
      const { width, height } = this.canvas;
      const s = Math.min(width, height) / this.grid.n * 0.96;
      this.scale = s;
      this.ox = (width - this.grid.n * s) / 2;
      this.oy = (height - this.grid.n * s) / 2;
    }

    cellAt(px, py) {
      const r = this.canvas.getBoundingClientRect();
      const cx = (px - r.left) * (this.canvas.width / r.width);
      const cy = (py - r.top) * (this.canvas.height / r.height);
      const x = Math.floor((cx - this.ox) / this.scale);
      const y = Math.floor((cy - this.oy) / this.scale);
      return this.grid && this.grid.inb(x, y) ? [x, y] : null;
    }

    _bindInput() {
      let dragging = false, lx = 0, ly = 0, moved = 0;
      this.canvas.addEventListener('pointerdown', e => { dragging = true; moved = 0; lx = e.clientX; ly = e.clientY; });
      window.addEventListener('pointermove', e => {
        if (!dragging) return;
        const dpr = this.canvas.width / this.canvas.getBoundingClientRect().width;
        this.ox += (e.clientX - lx) * dpr; this.oy += (e.clientY - ly) * dpr;
        moved += Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly);
        lx = e.clientX; ly = e.clientY;
      });
      window.addEventListener('pointerup', e => {
        if (dragging && moved < 5 && this.onClick) {
          const c = this.cellAt(e.clientX, e.clientY);
          if (c) this.onClick(c[0], c[1], e);
        }
        dragging = false;
      });
      this.canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const r = this.canvas.getBoundingClientRect();
        const cx = (e.clientX - r.left) * (this.canvas.width / r.width);
        const cy = (e.clientY - r.top) * (this.canvas.height / r.height);
        this.ox = cx - (cx - this.ox) * f;
        this.oy = cy - (cy - this.oy) * f;
        this.scale *= f;
      }, { passive: false });
    }

    draw(sim, agents) {
      const ctx = this.ctx, g = this.grid;
      ctx.fillStyle = '#0d0d0d';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      if (!g) return;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this._base, this.ox, this.oy, g.n * this.scale, g.n * this.scale);

      const s = this.scale;
      const px = (x) => this.ox + x * s, py = (y) => this.oy + y * s;

      if (sim) {
        // flood overlay — sequential blue, deeper = darker
        if (sim.floodDepth) {
          for (let i = 0; i < sim.floodDepth.length; i++) {
            const d = sim.floodDepth[i];
            if (d <= 0.01) continue;
            const x = i % g.n, y = (i / g.n) | 0;
            const a = Math.min(0.85, 0.35 + d * 0.06);
            ctx.fillStyle = `rgba(57,135,229,${a.toFixed(2)})`;
            ctx.fillRect(px(x), py(y), s + 0.5, s + 0.5);
          }
        }
        // quake damage overlay
        if (sim.damage) {
          for (let i = 0; i < sim.damage.length; i++) {
            const d = sim.damage[i];
            if (d <= 0.05) continue;
            const x = i % g.n, y = (i / g.n) | 0;
            if (d >= 0.75) ctx.fillStyle = 'rgba(208,59,59,0.9)';        // collapsed — critical
            else if (d >= 0.4) ctx.fillStyle = 'rgba(236,131,90,0.75)';  // heavy — serious
            else ctx.fillStyle = 'rgba(250,178,25,0.45)';                 // moderate — warning
            ctx.fillRect(px(x), py(y), s + 0.5, s + 0.5);
          }
        }
        // fire overlay
        if (sim.fire) {
          for (let i = 0; i < sim.fire.state.length; i++) {
            const st = sim.fire.state[i];
            if (st === 0) continue;
            const x = i % g.n, y = (i / g.n) | 0;
            if (st === 2) { ctx.fillStyle = 'rgba(15,13,12,0.88)'; }      // burned out
            else {
              const flick = 0.75 + 0.25 * Math.sin(performance.now() / 90 + i);
              ctx.fillStyle = `rgba(${Math.round(208 + 40 * flick)},${Math.round(80 * flick + 40)},25,0.95)`;
            }
            ctx.fillRect(px(x), py(y), s + 0.5, s + 0.5);
          }
          // responding crews
          ctx.fillStyle = '#3987e5';
          for (const cr of sim.fire.crews) {
            if (cr.state !== 'onscene' && cr.state !== 'moving') continue;
            ctx.beginPath();
            ctx.arc(px(cr.x) + s / 2, py(cr.y) + s / 2, Math.max(2.5, s * 0.6), 0, 7);
            ctx.fill();
            ctx.strokeStyle = '#0d0d0d'; ctx.lineWidth = 1.5; ctx.stroke();
          }
        }
      }

      // stations
      if (this.showStations) {
        for (const st of g.stations) {
          const [cx, cy] = g.cellAtWorld(st.wx, st.wy);
          const X = px(cx) + s / 2, Y = py(cy) + s / 2;
          const destroyed = sim && sim.destroyedStations && sim.destroyedStations.has(st);
          ctx.globalAlpha = destroyed ? 0.35 : 1;
          if (st.kind === 'fire' || st.kind === 'micro') {
            ctx.fillStyle = st.kind === 'fire' ? '#e66767' : '#d55181';
            rectMark(ctx, X, Y, st.kind === 'fire' ? 5 : 3.5);
          } else if (st.kind === 'hospital') {
            ctx.fillStyle = '#ffffff'; rectMark(ctx, X, Y, 5);
            ctx.fillStyle = '#d03b3b'; ctx.fillRect(X - 3, Y - 1, 6, 2); ctx.fillRect(X - 1, Y - 3, 2, 6);
          } else if (st.kind === 'police') {
            ctx.fillStyle = '#3987e5'; rectMark(ctx, X, Y, 4);
          }
          if (destroyed) {
            ctx.strokeStyle = '#d03b3b'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(X - 4, Y - 4); ctx.lineTo(X + 4, Y + 4);
            ctx.moveTo(X + 4, Y - 4); ctx.lineTo(X - 4, Y + 4); ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
      }

      // agents
      if (agents && this.showAgents) {
        for (const a of agents.list) {
          ctx.fillStyle = a.displaced ? '#ec835a' : (a.avg < 40 ? '#fab219' : '#c3c2b7');
          ctx.fillRect(px(a.x) + s * 0.3, py(a.y) + s * 0.3, Math.max(1.6, s * 0.4), Math.max(1.6, s * 0.4));
        }
      }
    }
  }

  function rectMark(ctx, x, y, r) {
    ctx.beginPath();
    ctx.rect(x - r, y - r, 2 * r, 2 * r);
    ctx.fill();
    ctx.strokeStyle = '#0d0d0d'; ctx.lineWidth = 1; ctx.stroke();
  }
  function hash(i) { let h = (i * 2654435761) >>> 0; h ^= h >> 15; return (h % 1000) / 1000; }
  function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }

  /* sparkline chart for time series (wellbeing / unrest) */
  class Sparkline {
    constructor(canvas, series) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d');
      this.series = series; // [{name,color,data:[]}]
      this.max = 100;
    }
    draw() {
      const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#1a1a19'; ctx.fillRect(0, 0, W, H);
      // hairline grid at 0/50/100
      ctx.strokeStyle = '#2c2c2a'; ctx.lineWidth = 1;
      for (const v of [0.5]) {
        ctx.beginPath(); ctx.moveTo(0, H * v); ctx.lineTo(W, H * v); ctx.stroke();
      }
      const n = Math.max(...this.series.map(s => s.data.length), 2);
      for (const s of this.series) {
        if (s.data.length < 2) continue;
        ctx.strokeStyle = s.color; ctx.lineWidth = 2;
        ctx.beginPath();
        const start = Math.max(0, s.data.length - 240);
        for (let i = start; i < s.data.length; i++) {
          const x = (i - start) / Math.max(1, Math.min(240, n) - 1) * (W - 8) + 4;
          const y = H - 4 - (s.data[i] / this.max) * (H - 8);
          i === start ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  }

  window.Render = { MapView, Sparkline, ZONE_COLORS };
})();
