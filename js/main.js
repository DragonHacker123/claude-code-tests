/* main.js — app wiring: city selection, tabs, tools, sim loop, live stats. */
(function () {
  const DATA = window.CITY_DATA;
  const COLORS = { 'solaris': '#3987e5', 'meridian-s': '#199e70', 'civitas': '#c98500', 'meridian-f': '#9085e9', 'resilient-city': '#d55181' };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  let currentId = 'meridian-f';
  let grid = null, sim = null, agents = null;
  let mapView = null, spark = null;
  let tool = 'inspect';
  let running = false, speed = 1, lastT = 0, popSimOn = false;

  function cityRec(id) { return DATA.cities.find(c => c.id === id); }

  /* ---------- init ---------- */
  function init() {
    // city buttons
    const bar = $('#citybar');
    for (const c of DATA.cities) {
      const b = document.createElement('button');
      b.className = 'citybtn';
      b.dataset.id = c.id;
      b.innerHTML = `<span class="dot" style="background:${COLORS[c.id]}"></span>${c.name}<small>${c.figures.population.value.toLocaleString('en-US')} · ${c.repo.split('/')[0]}</small>`;
      b.onclick = () => selectCity(c.id);
      bar.appendChild(b);
    }
    mapView = new window.Render.MapView($('#map'));
    mapView.onClick = onMapClick;
    spark = new window.Render.Sparkline($('#spark'), []);

    $$('.tabbtn').forEach(b => b.onclick = () => {
      $$('.tabbtn').forEach(x => x.classList.toggle('active', x === b));
      $('#compareView').style.display = b.dataset.tab === 'compare' ? '' : 'none';
      $('#sandboxView').style.display = b.dataset.tab === 'sandbox' ? '' : 'none';
      if (b.dataset.tab === 'compare' && !$('#compareView').dataset.built) {
        window.CompareView.build($('#compareView'), DATA, COLORS);
        $('#compareView').dataset.built = '1';
      }
    });

    $$('.toolbtn').forEach(b => b.onclick = () => {
      tool = b.dataset.tool;
      $$('.toolbtn').forEach(x => x.classList.toggle('active', x === b));
      $('#floodParams').style.display = tool === 'flood' ? '' : 'none';
      $('#quakeParams').style.display = tool === 'quake' ? '' : 'none';
      updateToolHint();
    });

    $('#btnRun').onclick = () => { running = !running; $('#btnRun').textContent = running ? '❚❚ Pause' : '▶ Run'; };
    $('#btnReset').onclick = resetSim;
    $('#speed').oninput = (e) => { speed = parseFloat(e.target.value); $('#speedLabel').textContent = speed + '×'; };
    $('#surge').oninput = (e) => $('#surgeLabel').textContent = e.target.value + ' m';
    $('#mag').oninput = (e) => $('#magLabel').textContent = 'M' + parseFloat(e.target.value).toFixed(1);
    $('#btnQuake').onclick = () => {
      ensureSim();
      sim.triggerQuake(parseFloat($('#mag').value));
      running = true; $('#btnRun').textContent = '❚❚ Pause';
    };
    $('#btnSurge').onclick = () => {
      ensureSim();
      sim.startFlood(parseFloat($('#surge').value), 'surge');
      running = true; $('#btnRun').textContent = '❚❚ Pause';
    };
    $('#btnRain').onclick = () => {
      ensureSim();
      sim.startFlood(parseFloat($('#surge').value), 'rain');
      running = true; $('#btnRun').textContent = '❚❚ Pause';
    };
    $('#btnPop').onclick = () => {
      popSimOn = !popSimOn;
      $('#btnPop').textContent = popSimOn ? '⏹ Stop population sim' : '👥 Start population sim';
      if (popSimOn && !agents) { agents = new window.CityAgents.Agents(grid, cityRec(currentId), sim); showBaselines(); }
      running = true; $('#btnRun').textContent = '❚❚ Pause';
    };
    $('#chkStations').onchange = (e) => mapView.showStations = e.target.checked;
    $('#chkAgents').onchange = (e) => mapView.showAgents = e.target.checked;

    selectCity(currentId);
    requestAnimationFrame(loop);
  }

  function selectCity(id) {
    currentId = id;
    $$('.citybtn').forEach(b => b.classList.toggle('active', b.dataset.id === id));
    grid = window.CityGen.buildCity(id);
    sim = new window.CitySim.Sim(grid, cityRec(id));
    agents = null; popSimOn = false;
    $('#btnPop').textContent = '👥 Start population sim';
    mapView.setGrid(grid);
    running = false; $('#btnRun').textContent = '▶ Run';
    renderCapabilities();
    updateToolHint();
    updateStats();
    $('#log').innerHTML = '';
    $('#baselines').innerHTML = '';
    const c = cityRec(id);
    $('#cityTitle').innerHTML = `<span class="dot" style="background:${COLORS[id]}"></span> ${c.name} <small>${c.repo} · ${grid.n}×${grid.n} cells @ ${grid.cellM} m — generated from the design's stated geometry</small>`;
  }

  function ensureSim() { if (!sim) sim = new window.CitySim.Sim(grid, cityRec(currentId)); }

  function resetSim() {
    sim.reset();
    if (agents) { agents = popSimOn ? new window.CityAgents.Agents(grid, cityRec(currentId), sim) : null; }
    running = false; $('#btnRun').textContent = '▶ Run';
    updateStats();
    $('#log').innerHTML = '';
  }

  function onMapClick(x, y) {
    const i = grid.idx(x, y);
    if (tool === 'fire') {
      if (sim.startFire(x, y)) { running = true; $('#btnRun').textContent = '❚❚ Pause'; }
    } else if (tool === 'flood') {
      // click marks a local ponding origin for rain mode; surge uses the coast
      sim.startFlood(parseFloat($('#surge').value), 'rain');
      if (sim.floodDepth) sim.floodDepth[i] = parseFloat($('#surge').value);
      running = true; $('#btnRun').textContent = '❚❚ Pause';
    } else {
      // inspect
      const Z = window.CityGen.Z;
      const zoneNames = ['outside', 'water', 'civic', 'residential (dense)', 'residential', 'industrial/port', 'agriculture', 'green', 'street', 'coastal barrier'];
      const [wx, wy] = grid.world(x, y);
      $('#inspect').innerHTML = `<strong>Cell (${x},${y})</strong> — ${zoneNames[grid.zone[i]]}<br>
        ~${Math.round(grid.pop[i])} residents · ${grid.storeys[i]} storeys · elev ${grid.elev[i].toFixed(1)} m
        ${grid.critical[i] ? ' · <em>base-isolated critical facility</em>' : ''}
        ${grid.firebreak[i] ? ' · firebreak' : ''}<br>
        <small>${(wx / 1000).toFixed(1)}, ${(wy / 1000).toFixed(1)} km from centre</small>`;
    }
  }

  function updateToolHint() {
    const cap = cityRec(currentId).sim_capabilities;
    const capOf = { fire: cap.fire, flood: cap.flood, quake: cap.quake, inspect: null, pop: cap.population }[tool];
    const el = $('#toolHint');
    if (!capOf) { el.innerHTML = tool === 'inspect' ? 'Click any cell to inspect it.' : ''; el.className = 'hint'; return; }
    el.className = 'hint conf-' + capOf.confidence;
    el.innerHTML = `<strong>Data confidence: ${capOf.confidence.toUpperCase()}</strong> — ${capOf.notes}`;
  }

  function renderCapabilities() {
    const c = cityRec(currentId);
    const box = $('#capabilities');
    box.innerHTML = '<h4>What this design specifies (per its own repo)</h4>' +
      ['fire', 'flood', 'quake', 'population'].map(k => {
        const cap = c.sim_capabilities[k];
        return `<div class="capline conf-${cap.confidence}"><span class="capname">${k}</span><span class="conf">${cap.confidence}</span><p>${cap.notes}</p></div>`;
      }).join('');
  }

  function showBaselines() {
    if (!agents) return;
    const b = agents.baselines;
    $('#baselines').innerHTML = `<h4>Agent need baselines (derived from stated design)</h4>
      <div class="blgrid">
        <div>Housing <span>${b.housing.toFixed(0)}</span></div>
        <div>Safety <span>${b.safety.toFixed(0)}</span></div>
        <div>Employment <span>${b.employment.toFixed(0)}</span></div>
        <div>Wellbeing <span>${b.wellbeing.toFixed(0)}</span></div>
      </div>` +
      (b.notes.length ? `<p class="footnote">⚠ ${b.notes.join('; ')}</p>` : '');
  }

  /* ---------- loop ---------- */
  function loop(t) {
    const dtms = Math.min(100, t - lastT); lastT = t;
    if (running) {
      const dt = dtms / 1000 * speed; // 1 real second = 1 sim minute at 1×
      sim.step(dt);
      if (popSimOn && agents) agents.step(dt);
      updateStats();
    }
    mapView.draw(sim, popSimOn ? agents : null);
    if (agents && popSimOn) {
      spark.series = [
        { name: 'wellbeing', color: '#0ca30c', data: agents.history.wellbeing },
        { name: 'unrest', color: '#d03b3b', data: agents.history.unrest },
      ];
      spark.draw();
    }
    requestAnimationFrame(loop);
  }

  function tile(label, value, cls) {
    return `<div class="tile ${cls || ''}"><div class="tv">${value}</div><div class="tl">${label}</div></div>`;
  }

  function updateStats() {
    const s = sim.stats;
    let html = '';
    html += tile('Sim clock', sim.clock < 90 ? sim.clock.toFixed(0) + ' min' : (sim.clock / 60).toFixed(1) + ' h');
    if (s.fire) {
      html += tile('Burning blocks', s.fire.burning, s.fire.burning ? 'crit' : '');
      html += tile('Burned area', s.fire.areaKm2.toFixed(2) + ' km²');
      html += tile('Pop. affected (fire)', s.fire.popAffected.toLocaleString('en-US'), 'warn');
      html += tile('First crew arrival', s.fire.firstArrival === null ? 'en route' : s.fire.firstArrival.toFixed(1) + ' min');
      html += tile('Crews on scene', s.fire.crewsOnScene);
    }
    if (s.flood) {
      html += tile('Flooded area', s.flood.areaKm2.toFixed(2) + ' km²', 'warn');
      html += tile('Pop. affected (flood)', s.flood.popAffected.toLocaleString('en-US'), 'warn');
    }
    if (s.quake) {
      html += tile('Collapsed blocks', s.quake.collapsed, s.quake.collapsed ? 'crit' : '');
      html += tile('Heavy damage', s.quake.heavy, 'warn');
      html += tile('Pop. exposed (quake)', s.quake.popExposed.toLocaleString('en-US'), 'crit');
      html += tile('Stations lost', `${s.quake.stationsLost}/${s.quake.stationsTotal}`);
    }
    if (agents && agents.stats && popSimOn) {
      html += tile('Avg wellbeing', agents.stats.wellbeing.toFixed(0) + '/100', agents.stats.wellbeing < 50 ? 'warn' : 'good');
      html += tile('Unrest', agents.stats.unrest.toFixed(0) + '%', agents.stats.unrest > 25 ? 'crit' : '');
      html += tile('Displaced (est.)', agents.stats.displacedPop.toLocaleString('en-US'));
    }
    $('#tiles').innerHTML = html;
    // log + assumptions
    $('#log').innerHTML = sim.log.slice(0, 14).map(l => `<div>${l}</div>`).join('');
    const A = [...new Set(sim.assumptions)];
    $('#assumptions').innerHTML = A.length
      ? '<h4>⚠ Assumptions forced by missing source data</h4>' + A.map(a => `<div class="assump">${a}</div>`).join('')
      : '';
  }

  window.addEventListener('DOMContentLoaded', init);
})();
