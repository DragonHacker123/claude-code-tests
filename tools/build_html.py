#!/usr/bin/env python3
"""Generate a phone-friendly, self-contained comparison page from
data/normalized_cities.json. Emits TWO files from one template:

  build/city_comparison_page.html  — artifact body (style + markup, no doc wrappers)
  city_comparison.html             — full standalone document (repo + download)

Static HTML, no JS, no external assets → opens in any phone browser.
Missing figures are shown as an orange MISSING chip with the reason; derived
figures are tagged; nothing is inferred.
"""
import json
import pathlib
import html

ROOT = pathlib.Path(__file__).resolve().parent.parent
data = json.loads((ROOT / "data" / "normalized_cities.json").read_text())
cities = data["cities"]

COLORS = {"solaris": "#3987e5", "meridian-s": "#199e70", "civitas": "#c98500",
          "meridian-f": "#9085e9", "resilient-city": "#d55181"}

SECTIONS = [
    ("Scale & form", [
        ("population", "Population"), ("urban_area_km2", "Urban area (km²)"),
        ("gross_density_per_km2", "Gross density (/km²)"),
        ("built_up_density_per_km2", "Built-up density (/km²)"),
        ("hinterland_km2", "Hinterland (km²)"),
        ("building_storeys_typical", "Typical storeys"),
        ("building_materials", "Materials"), ("street_width_m", "Street width (m)"),
        ("building_spacing", "Building spacing"), ("gas_grid", "Gas grid / ignition"),
    ]),
    ("Structural resilience", [
        ("seismic_design_basis", "Seismic design basis"),
        ("base_isolation_scope", "Base isolation scope"),
        ("soft_storey_ban", "Soft-storey ban"),
        ("drift_capacity_m", "Drift capacity (m)"),
        ("quake_survival_target_pct", "Quake survival target (%)"),
        ("tsunami_design_height_m", "Tsunami design height (m)"),
        ("flood_defence_layers", "Flood defence layers"),
        ("site_elevation_model", "Site elevation data"),
        ("stormwater_drainage", "Stormwater drainage"), ("wind_design", "Wind design"),
        ("firebreaks", "Firebreaks"), ("green_cover_pct", "Green cover (%)"),
    ]),
    ("Emergency response", [
        ("fire_stations", "Fire stations"),
        ("fire_response_median_min", "Fire response median (min)"),
        ("fire_response_p95_min", "Fire response tail (min)"),
        ("ems_response_median_min", "EMS response median (min)"),
        ("ems_ambulances", "Ambulances"),
        ("police_response_target_min", "Police response (min)"),
        ("police_stations", "Police stations"), ("hospitals", "Hospitals"),
        ("response_degraded_scenario", "Degraded-response analysis"),
    ]),
    ("Crime, economy, society", [
        ("crime_target", "Crime target"), ("prison_target", "Incarceration target (/100k)"),
        ("economic_model", "Economic model"), ("gini_target", "Gini target"),
    ]),
    ("Self-sufficiency", [
        ("energy_demand_avg_mw", "Energy demand avg (MW)"),
        ("energy_demand_peak_mw", "Energy demand peak (MW)"),
        ("energy_mix", "Energy mix"), ("battery_storage_gwh", "Battery storage (GWh)"),
        ("energy_autonomy_days", "Energy autonomy (days)"),
        ("water_demand", "Water demand (m³/day)"),
        ("water_sources", "Water sources"), ("water_reserve_days", "Water reserve (days)"),
        ("food_self_sufficiency", "Food self-sufficiency"),
        ("food_reserve_months", "Food reserve (months)"),
    ]),
    ("Quality of life", [
        ("housing_floor_m2_per_person", "Housing floor (m²/person)"),
        ("noise_limit_db", "Noise limits"), ("commute_target", "Commute target"),
        ("local_reserve_hours", "Local emergency reserves"),
    ]),
]

e = lambda s: html.escape(str(s))


def value_html(fig):
    if fig is None:
        return '<span class="miss">MISSING</span><span class="reason">not in schema</span>'
    if fig.get("status") == "missing":
        reason = fig.get("note", "not reported in source repo")
        return f'<span class="miss">MISSING</span><span class="reason">{e(reason)}</span>'
    v = fig["value"]
    if isinstance(v, bool):
        v = "yes" if v else "no"
    elif isinstance(v, (int, float)) and not isinstance(v, bool):
        v = f"{v:,}" if abs(v) >= 10000 else v
    elif isinstance(v, dict):
        v = ", ".join(f"{k} {x}%" for k, x in v.items())
    elif isinstance(v, list):
        v = ", ".join(str(x) for x in v)
    txt = e(v)
    if fig.get("unit") and str(fig["unit"]) not in str(v):
        txt += f' <span class="unit">{e(fig["unit"])}</span>'
    if fig.get("metric"):
        txt += f' <span class="unit">[{e(fig["metric"])}/100k]</span>'
    tag = '<span class="der">derived</span>' if fig.get("status") == "derived" else ""
    cap_bits = []
    if fig.get("definition"):
        cap_bits.append(e(fig["definition"]))
    elif fig.get("note"):
        cap_bits.append(e(fig["note"]))
    cap = f'<span class="reason">{cap_bits[0]}</span>' if cap_bits else ""
    return f'<span class="v">{txt}</span>{tag}{cap}'


def body_html():
    out = []
    out.append('<main class="wrap">')
    out.append('<header class="masthead">')
    out.append('<p class="eyebrow">Normalised comparison</p>')
    out.append('<h1>Five self-sufficient city blueprints, one honest schema</h1>')
    out.append('<p class="lede">Four designs from Claude models (Haiku, Sonnet, Opus, Fable) '
               'and one from ChatGPT, each built from the same brief. Where a design does not '
               'state a figure it is marked <span class="miss inline">MISSING</span> — never inferred.</p>')
    out.append('</header>')

    # legend chips
    out.append('<section class="legend">')
    for c in cities:
        f = c["figures"]
        miss = sum(1 for x in f.values() if x.get("status") == "missing")
        col = COLORS[c["id"]]
        pop = f["population"]["value"]
        out.append(
            f'<div class="chip" style="--c:{col}">'
            f'<span class="dot"></span>'
            f'<span class="cname">{e(c["name"])}</span>'
            f'<span class="cmeta">{pop:,} · {miss} gaps</span>'
            f'</div>')
    out.append('</section>')

    # comparability warnings
    out.append('<details class="warn" open><summary>Read first — why some columns aren\'t directly comparable</summary><ul>')
    for w in data["comparability_warnings"]:
        out.append(f'<li>{e(w)}</li>')
    out.append('</ul></details>')

    # figure blocks grouped by section
    for title, rows in SECTIONS:
        out.append(f'<h2 class="sec">{e(title)}</h2>')
        for key, label in rows:
            out.append('<div class="fig">')
            out.append(f'<div class="figname">{e(label)}</div>')
            out.append('<div class="vals">')
            for c in cities:
                col = COLORS[c["id"]]
                fig = c["figures"].get(key)
                miss_cls = " ismiss" if (fig is None or fig.get("status") == "missing") else ""
                out.append(
                    f'<div class="cell{miss_cls}" style="--c:{col}">'
                    f'<div class="clab"><span class="dot"></span>{e(c["name"])}</div>'
                    f'<div class="cval">{value_html(fig)}</div>'
                    f'</div>')
            out.append('</div></div>')

    out.append(f'<footer class="foot">Generated {e(data["generated"])} from '
               f'<code>data/normalized_cities.json</code> (schema v{e(data["schema_version"])}). '
               f'The full spreadsheet is <code>city_comparison.xlsx</code>.</footer>')
    out.append('</main>')
    return "\n".join(out)


STYLE = """
<style>
:root{
  --bg:#f5f6f8; --panel:#ffffff; --ink:#171a21; --ink2:#4a5060; --muted:#7c8494;
  --line:#e3e6ec; --line2:#eef0f4; --accent:#2f5d8a;
  --miss-bg:#fdeee6; --miss-ink:#b4531f; --miss-line:#eeb591;
  --der:#2f6fbf;
  --shadow:0 1px 2px rgba(20,28,45,.05),0 8px 24px rgba(20,28,45,.05);
}
@media (prefers-color-scheme:dark){
  :root:where(:not([data-theme=light])){
    --bg:#0f1216; --panel:#171b21; --ink:#f2f4f8; --ink2:#b7bfce; --muted:#828b9c;
    --line:#262c35; --line2:#1e232b; --accent:#7fb0e0;
    --miss-bg:#2a1c14; --miss-ink:#e79463; --miss-line:#5a3a26; --der:#7fb0e0;
    --shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.35);
  }
}
:root[data-theme=dark]{
  --bg:#0f1216; --panel:#171b21; --ink:#f2f4f8; --ink2:#b7bfce; --muted:#828b9c;
  --line:#262c35; --line2:#1e232b; --accent:#7fb0e0;
  --miss-bg:#2a1c14; --miss-ink:#e79463; --miss-line:#5a3a26; --der:#7fb0e0;
  --shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.35);
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;
  -webkit-text-size-adjust:100%;}
.wrap{max-width:1040px;margin:0 auto;padding:22px 16px 60px}
.masthead{padding:14px 0 20px;border-bottom:1px solid var(--line)}
.eyebrow{margin:0 0 8px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:650}
h1{margin:0 0 12px;font-size:clamp(24px,5.5vw,38px);line-height:1.12;letter-spacing:-.02em;text-wrap:balance;font-weight:750}
.lede{margin:0;max-width:64ch;color:var(--ink2);font-size:clamp(15px,3.4vw,17px)}
.legend{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0 4px}
.chip{display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--line);
  border-left:3px solid var(--c);border-radius:10px;padding:8px 12px;box-shadow:var(--shadow)}
.chip .dot{width:9px;height:9px;border-radius:50%;background:var(--c);flex:none}
.cname{font-weight:650;font-size:14px}
.cmeta{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.warn{background:var(--panel);border:1px solid var(--line);border-radius:12px;
  margin:18px 0 8px;padding:2px 16px;box-shadow:var(--shadow)}
.warn summary{cursor:pointer;font-weight:650;padding:12px 0;color:var(--ink);font-size:14.5px}
.warn ul{margin:0 0 14px;padding-left:20px;color:var(--ink2)}
.warn li{margin:6px 0;font-size:14px}
h2.sec{margin:34px 0 10px;font-size:13px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--muted);font-weight:700;padding-bottom:8px;border-bottom:1px solid var(--line)}
.fig{padding:14px 0;border-bottom:1px solid var(--line2)}
.figname{font-weight:650;font-size:15px;margin-bottom:10px}
.vals{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
@media(max-width:860px){.vals{grid-template-columns:repeat(2,1fr)}}
@media(max-width:460px){.vals{grid-template-columns:1fr}}
.cell{background:var(--panel);border:1px solid var(--line);border-top:2px solid var(--c);
  border-radius:9px;padding:9px 11px;min-width:0}
.cell.ismiss{background:var(--miss-bg);border-color:var(--miss-line);border-top-color:var(--miss-line)}
.clab{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);
  font-weight:600;margin-bottom:5px;text-transform:uppercase;letter-spacing:.03em}
.clab .dot{width:7px;height:7px;border-radius:50%;background:var(--c);flex:none}
.cval{font-size:14px;line-height:1.4;overflow-wrap:break-word}
.cval .v{font-weight:600;font-variant-numeric:tabular-nums}
.unit{color:var(--muted);font-weight:400;font-size:12.5px}
.miss{display:inline-block;background:transparent;color:var(--miss-ink);border:1px solid var(--miss-ink);
  border-radius:20px;padding:0 8px;font-size:10.5px;font-weight:700;letter-spacing:.05em;vertical-align:middle}
.miss.inline{padding:0 6px}
.der{display:inline-block;margin-left:6px;color:var(--der);border:1px solid var(--der);
  border-radius:20px;padding:0 7px;font-size:10px;font-weight:600;vertical-align:middle}
.reason{display:block;margin-top:4px;color:var(--muted);font-size:12px;line-height:1.35}
.foot{margin-top:40px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
code{background:var(--line2);padding:1px 5px;border-radius:4px;font-size:12.5px}
</style>
"""

body = body_html()

# 1) artifact body fragment (style + markup, no doc wrappers)
build_dir = ROOT / "build"
build_dir.mkdir(exist_ok=True)
(build_dir / "city_comparison_page.html").write_text(STYLE + "\n" + body)

# 2) full standalone document
standalone = f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>City blueprints — normalised comparison</title>
{STYLE}
</head><body>
{body}
</body></html>
"""
(ROOT / "city_comparison.html").write_text(standalone)
print("wrote build/city_comparison_page.html and city_comparison.html")
