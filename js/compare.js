/* compare.js — comparison view across the four normalised designs.
 * Missing figures render as an explicit MISSING badge, never as blank/0. */
(function () {
  const ROWS = [
    ['population', 'Population'],
    ['urban_area_km2', 'Urban area (km²)'],
    ['gross_density_per_km2', 'Gross density (/km²)'],
    ['built_up_density_per_km2', 'Built-up density (/km²)'],
    ['hinterland_km2', 'Hinterland (km²)'],
    ['building_storeys_typical', 'Typical storeys'],
    ['building_materials', 'Materials'],
    ['street_width_m', 'Street width (m)'],
    ['building_spacing', 'Building spacing'],
    ['gas_grid', 'Gas grid / ignition'],
    ['seismic_design_basis', 'Seismic design basis'],
    ['base_isolation_scope', 'Base isolation scope'],
    ['soft_storey_ban', 'Soft-storey ban'],
    ['quake_survival_target_pct', 'Quake survival target (%)'],
    ['tsunami_design_height_m', 'Tsunami design height (m)'],
    ['flood_defence_layers', 'Flood defence layers'],
    ['site_elevation_model', 'Site elevation data'],
    ['wind_design', 'Wind design'],
    ['fire_stations', 'Fire stations'],
    ['fire_response_median_min', 'Fire response median (min)'],
    ['fire_response_p95_min', 'Fire response tail (min)'],
    ['ems_response_median_min', 'EMS response median (min)'],
    ['police_response_target_min', 'Police response (min)'],
    ['response_degraded_scenario', 'Degraded-response analysis'],
    ['crime_target', 'Crime target'],
    ['economic_model', 'Economic model'],
    ['gini_target', 'Gini target'],
    ['energy_demand_avg_mw', 'Energy demand avg (MW)'],
    ['energy_demand_peak_mw', 'Energy demand peak (MW)'],
    ['battery_storage_gwh', 'Battery storage (GWh)'],
    ['energy_autonomy_days', 'Energy autonomy (days)'],
    ['water_demand', 'Water demand (m³/day)'],
    ['water_reserve_days', 'Water reserve (days)'],
    ['food_self_sufficiency', 'Food self-sufficiency'],
    ['food_reserve_months', 'Food reserve (months)'],
    ['housing_floor_m2_per_person', 'Housing floor (m²/person)'],
    ['noise_limit_db', 'Noise limits'],
    ['commute_target', 'Commute target'],
    ['local_reserve_hours', 'Local emergency reserves'],
  ];

  function fmtVal(fig) {
    if (!fig) return { html: '<span class="badge miss">not in schema</span>' };
    if (fig.status === 'missing') {
      return { html: `<span class="badge miss" title="${esc(fig.note || 'not reported in source repo')}">MISSING</span>`, miss: true };
    }
    let v = fig.value;
    if (typeof v === 'number') v = v >= 10000 ? v.toLocaleString('en-US') : String(v);
    else if (typeof v === 'boolean') v = v ? 'yes' : 'no';
    else if (typeof v === 'object') v = Object.entries(v).map(([k, x]) => `${k} ${x}%`).join(', ');
    let extra = '';
    if (fig.status === 'derived') extra = ' <span class="badge der" title="' + esc(fig.source || '') + '">derived</span>';
    if (fig.metric) v = `${v} (${fig.metric}/100k)`;
    const title = esc([fig.definition, fig.note, fig.source && 'Source: ' + fig.source].filter(Boolean).join('\n'));
    return { html: `<span title="${title}">${esc(String(v))}</span>${extra}` };
  }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

  function build(container, data, colors) {
    const cities = data.cities;
    let html = `<div class="warnbox"><strong>Read this first — comparability warnings from normalisation:</strong><ul>` +
      data.comparability_warnings.map(w => `<li>${esc(w)}</li>`).join('') + `</ul></div>`;

    // city cards
    html += '<div class="cards">';
    for (const c of cities) {
      const missCount = Object.values(c.figures).filter(f => f.status === 'missing').length;
      const total = Object.keys(c.figures).length;
      html += `<div class="card" style="border-top: 3px solid ${colors[c.id]}">
        <h3><span class="dot" style="background:${colors[c.id]}"></span>${esc(c.name)}</h3>
        <div class="cardsub">${esc(c.repo)}</div>
        <canvas class="mini" data-city="${c.id}" width="180" height="180"></canvas>
        <div class="cardstats">
          <div><span>${(c.figures.population.value / 1000).toFixed(0)}k</span> residents</div>
          <div><span>${esc(String(c.figures.urban_area_km2.value))}</span> km² urban</div>
          <div><span>${missCount}/${total}</span> figures missing</div>
        </div>
      </div>`;
    }
    html += '</div>';

    // full table
    html += '<div class="tablewrap"><table><thead><tr><th>Figure</th>' +
      cities.map(c => `<th><span class="dot" style="background:${colors[c.id]}"></span>${esc(c.name)}</th>`).join('') +
      '</tr></thead><tbody>';
    for (const [key, label] of ROWS) {
      html += `<tr><td class="rowlabel">${esc(label)}</td>`;
      for (const c of cities) {
        const f = fmtVal(c.figures[key]);
        html += `<td class="${f.miss ? 'missCell' : ''}">${f.html}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    html += `<p class="footnote">Hover any value for its definition, caveats and source location. “derived” = arithmetic on stated figures (formula in tooltip). MISSING = the source repo does not report this figure; nothing was inferred. Full schema: <code>data/normalized_cities.json</code>.</p>`;
    container.innerHTML = html;

    // draw minimaps
    for (const cv of container.querySelectorAll('canvas.mini')) {
      const id = cv.dataset.city;
      const grid = window.CityGen.buildCity(id);
      drawMini(cv, grid);
    }
  }

  function drawMini(canvas, grid) {
    const ctx = canvas.getContext('2d');
    const off = document.createElement('canvas');
    off.width = grid.n; off.height = grid.n;
    const octx = off.getContext('2d');
    const img = octx.createImageData(grid.n, grid.n);
    const ZC = window.Render.ZONE_COLORS;
    for (let i = 0; i < grid.n * grid.n; i++) {
      const hex = ZC[grid.zone[i]] || '#0d0d0d';
      img.data[i * 4] = parseInt(hex.slice(1, 3), 16) + grid.storeys[i];
      img.data[i * 4 + 1] = parseInt(hex.slice(3, 5), 16) + grid.storeys[i];
      img.data[i * 4 + 2] = parseInt(hex.slice(5, 7), 16) + grid.storeys[i];
      img.data[i * 4 + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#898781';
    ctx.font = '9px system-ui';
    ctx.fillText(`${(grid.n * grid.cellM / 1000).toFixed(0)} km across`, 6, canvas.height - 6);
  }

  window.CompareView = { build };
})();
