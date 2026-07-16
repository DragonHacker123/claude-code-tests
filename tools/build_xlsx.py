#!/usr/bin/env python3
"""Build city_comparison.xlsx from data/normalized_cities.json.

Missing figures are written as the literal string "MISSING — <reason>" and
shaded, never left blank or coerced to 0. Derived figures are tagged. The
workbook has four sheets: Overview, Full Comparison, Data Gaps, and Legend.
"""
import json
import pathlib
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

ROOT = pathlib.Path(__file__).resolve().parent.parent
data = json.loads((ROOT / "data" / "normalized_cities.json").read_text())
cities = data["cities"]

# ---- styles ----
HDR = Font(bold=True, color="FFFFFF", size=11)
HDR_FILL = PatternFill("solid", fgColor="1F2A44")
TITLE = Font(bold=True, size=14, color="1F2A44")
SUB = Font(italic=True, size=9, color="666666")
LABEL = Font(bold=True, size=10)
MISS_FILL = PatternFill("solid", fgColor="FBE4D5")   # soft orange
MISS_FONT = Font(color="C0504D", italic=True, size=10)
DER_FONT = Font(color="1F6FC0", size=10)
WRAP = Alignment(wrap_text=True, vertical="top")
TOP = Alignment(vertical="top")
CENTER = Alignment(horizontal="center", vertical="top")
thin = Side(style="thin", color="D9D9D9")
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)

CITY_COLORS = {"solaris": "3987E5", "meridian-s": "199E70", "civitas": "C98500", "meridian-f": "9085E9", "resilient-city": "D55181"}

ROWS = [
    ("— Scale & form —", None),
    ("population", "Population"),
    ("urban_area_km2", "Urban area (km²)"),
    ("gross_density_per_km2", "Gross density (people/km²)"),
    ("built_up_density_per_km2", "Built-up density (people/km²)"),
    ("hinterland_km2", "Hinterland footprint (km²)"),
    ("building_storeys_typical", "Typical building storeys"),
    ("building_materials", "Primary building materials"),
    ("street_width_m", "Street width (m)"),
    ("building_spacing", "Building spacing / block grid"),
    ("gas_grid", "Gas grid / ignition source"),
    ("— Structural resilience —", None),
    ("seismic_design_basis", "Seismic design basis"),
    ("base_isolation_scope", "Base isolation scope"),
    ("soft_storey_ban", "Soft-storey ban"),
    ("drift_capacity_m", "Lateral drift capacity (m)"),
    ("quake_survival_target_pct", "Quake survival target (%)"),
    ("tsunami_design_height_m", "Tsunami / surge design height (m)"),
    ("flood_defence_layers", "Flood defence layers"),
    ("site_elevation_model", "Site elevation / terrain data"),
    ("stormwater_drainage", "Stormwater drainage"),
    ("wind_design", "Wind design"),
    ("— Emergency response —", None),
    ("fire_stations", "Fire stations"),
    ("fire_response_median_min", "Fire response, median (min)"),
    ("fire_response_p95_min", "Fire response, tail (min)"),
    ("ems_response_median_min", "EMS response, median (min)"),
    ("ems_ambulances", "Ambulances"),
    ("police_response_target_min", "Police response (min)"),
    ("police_stations", "Police stations"),
    ("hospitals", "Hospitals"),
    ("response_degraded_scenario", "Degraded-response (post-disaster) analysis"),
    ("— Crime, economy, society —", None),
    ("crime_target", "Crime target (see metric)"),
    ("prison_target", "Incarceration target (per 100k)"),
    ("economic_model", "Economic model"),
    ("gini_target", "Gini coefficient target"),
    ("— Self-sufficiency —", None),
    ("energy_demand_avg_mw", "Energy demand, average (MW)"),
    ("energy_demand_peak_mw", "Energy demand, peak (MW)"),
    ("energy_mix", "Energy mix"),
    ("battery_storage_gwh", "Battery storage (GWh)"),
    ("energy_autonomy_days", "Energy autonomy (days)"),
    ("water_demand", "Water demand (m³/day)"),
    ("water_sources", "Water sources"),
    ("water_reserve_days", "Water reserve (days)"),
    ("food_self_sufficiency", "Food self-sufficiency"),
    ("food_reserve_months", "Food reserve (months)"),
    ("— Quality of life —", None),
    ("housing_floor_m2_per_person", "Housing floor (m²/person)"),
    ("noise_limit_db", "Noise limits"),
    ("commute_target", "Commute / 15-min-city target"),
    ("local_reserve_hours", "Local emergency reserves"),
]


def render(fig):
    """Return (text, kind) where kind in {'val','derived','missing'}."""
    if fig is None:
        return ("MISSING — figure not in schema", "missing")
    if fig.get("status") == "missing":
        note = fig.get("note", "not reported in source repo")
        return (f"MISSING — {note}", "missing")
    v = fig["value"]
    if isinstance(v, bool):
        v = "yes" if v else "no"
    elif isinstance(v, dict):
        v = ", ".join(f"{k}: {x}%" for k, x in v.items())
    elif isinstance(v, list):
        v = ", ".join(str(x) for x in v)
    txt = str(v)
    if fig.get("unit") and fig["unit"] not in txt:
        txt = f"{txt} {fig['unit']}"
    if fig.get("metric"):
        txt = f"{txt}  [{fig['metric']}/100k]"
    kind = "derived" if fig.get("status") == "derived" else "val"
    return (txt, kind)


wb = Workbook()

# ============ Sheet 1: Overview ============
ws = wb.active
ws.title = "Overview"
ws["A1"] = "Four Self-Sufficient City Blueprints — Normalised Comparison"
ws["A1"].font = TITLE
ws["A2"] = f"Generated {data['generated']} from data/normalized_cities.json (schema v{data['schema_version']}). " \
           "MISSING = the source repo does not report this figure; nothing was inferred."
ws["A2"].font = SUB
ws.merge_cells("A1:F1"); ws.merge_cells("A2:F2")

r = 4
ws.cell(r, 1, "City").font = HDR
headers = ["City", "Repo", "Population", "Urban area (km²)", "Gross density (/km²)", "Figures missing"]
for c, h in enumerate(headers, 1):
    cell = ws.cell(r, c, h)
    cell.font = HDR; cell.fill = HDR_FILL; cell.border = BORDER; cell.alignment = CENTER
r += 1
for city in cities:
    f = city["figures"]
    miss = sum(1 for x in f.values() if x.get("status") == "missing")
    total = len(f)
    vals = [city["name"], city["repo"], f["population"]["value"],
            f["urban_area_km2"]["value"], f["gross_density_per_km2"]["value"],
            f"{miss} of {total}"]
    for c, v in enumerate(vals, 1):
        cell = ws.cell(r, c, v); cell.border = BORDER; cell.alignment = TOP
        if c == 1:
            cell.font = Font(bold=True, color=CITY_COLORS[city["id"]])
    r += 1

r += 1
ws.cell(r, 1, "Comparability warnings — read before using any cross-city figure:").font = LABEL
r += 1
for w in data["comparability_warnings"]:
    cell = ws.cell(r, 1, "•  " + w)
    cell.font = Font(color="C0504D", size=10); cell.alignment = WRAP
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=6)
    ws.row_dimensions[r].height = 42
    r += 1

widths = [22, 30, 14, 16, 18, 16]
for c, w in enumerate(widths, 1):
    ws.column_dimensions[get_column_letter(c)].width = w

# ============ Sheet 2: Full Comparison ============
ws2 = wb.create_sheet("Full Comparison")
ws2.cell(1, 1, "Figure").font = HDR; ws2.cell(1, 1).fill = HDR_FILL; ws2.cell(1, 1).border = BORDER
for c, city in enumerate(cities, 2):
    cell = ws2.cell(1, c, city["name"])
    cell.font = HDR; cell.fill = PatternFill("solid", fgColor=CITY_COLORS[city["id"]])
    cell.border = BORDER; cell.alignment = CENTER
ws2.freeze_panes = "B2"

row = 2
for key, label in ROWS:
    if label is None:   # section header
        cell = ws2.cell(row, 1, key)
        cell.font = Font(bold=True, italic=True, color="1F2A44")
        cell.fill = PatternFill("solid", fgColor="EDF0F5")
        for c in range(2, len(cities) + 2):
            ws2.cell(row, c).fill = PatternFill("solid", fgColor="EDF0F5")
        row += 1
        continue
    lc = ws2.cell(row, 1, label); lc.font = LABEL; lc.alignment = WRAP; lc.border = BORDER
    for c, city in enumerate(cities, 2):
        txt, kind = render(city["figures"].get(key))
        cell = ws2.cell(row, c, txt); cell.alignment = WRAP; cell.border = BORDER
        if kind == "missing":
            cell.fill = MISS_FILL; cell.font = MISS_FONT
        elif kind == "derived":
            cell.font = DER_FONT
        else:
            cell.font = Font(size=10)
        # attach source/definition/note as a cell comment
        fig = city["figures"].get(key)
        if fig and fig.get("status") != "missing":
            bits = []
            for k in ("source", "definition", "note"):
                if fig.get(k):
                    bits.append(f"{k}: {fig[k]}")
            if bits:
                from openpyxl.comments import Comment
                cell.comment = Comment("\n".join(bits), "normaliser")
    ws2.row_dimensions[row].height = 46
    row += 1

ws2.column_dimensions["A"].width = 30
for c in range(2, len(cities) + 2):
    ws2.column_dimensions[get_column_letter(c)].width = 40

# ============ Sheet 3: Data Gaps ============
ws3 = wb.create_sheet("Data Gaps")
ws3.cell(1, 1, "Every MISSING figure, per city — what the source repo does not report").font = TITLE
ws3.merge_cells("A1:D1")
hdr = ["City", "Figure", "Why it matters / reason recorded", ""]
for c, h in enumerate(["City", "Figure", "Reason recorded in schema"], 1):
    cell = ws3.cell(3, c, h); cell.font = HDR; cell.fill = HDR_FILL; cell.border = BORDER
row = 4
gap_counts = {}
for city in cities:
    for key, label in ROWS:
        if label is None:
            continue
        fig = city["figures"].get(key)
        if fig and fig.get("status") == "missing":
            gap_counts[city["name"]] = gap_counts.get(city["name"], 0) + 1
            ws3.cell(row, 1, city["name"]).font = Font(bold=True, color=CITY_COLORS[city["id"]])
            ws3.cell(row, 2, label).alignment = WRAP
            rc = ws3.cell(row, 3, fig.get("note", "not reported")); rc.alignment = WRAP; rc.font = Font(size=10)
            for c in range(1, 4):
                ws3.cell(row, c).border = BORDER
            ws3.row_dimensions[row].height = 30
            row += 1
ws3.column_dimensions["A"].width = 20
ws3.column_dimensions["B"].width = 34
ws3.column_dimensions["C"].width = 90

# ============ Sheet 4: Legend ============
ws4 = wb.create_sheet("Legend")
ws4.cell(1, 1, "Legend & method").font = TITLE
notes = [
    ("Status tags", ""),
    ("(plain)", "Figure stated explicitly in the source repo (masterplan, script, or data file)."),
    ("blue text", "DERIVED — arithmetic on stated figures; the formula is in the cell comment."),
    ("orange fill 'MISSING'", "The source repo does NOT report this figure. No value was inferred or invented."),
    ("cell comments", "Hover a value for its source location, precise definition, and caveats."),
    ("", ""),
    ("Why figures are not directly comparable", ""),
    ("Crime targets", "Different metrics: Solaris = total crime, Meridian-S = violent crime, CIVITAS & Meridian-F = homicide. Never rank on this column."),
    ("Response times", "Different definitions: some are travel-only, some end-to-end (incl. dispatch+turnout). Each cell comment states which."),
    ("Density", "Solaris's area includes agricultural rings inside the city boundary; the others exclude hinterland."),
    ("", ""),
    ("Source repos", ""),
    ("Solaris", "claude-code-haiku — concentric rings, 25 km radius, 520k people"),
    ("Meridian (Sonnet)", "claude-code-sonnet — fractal hex-of-hexes, 467k people"),
    ("CIVITAS", "claude-code-opus — single hexagon module, 250k people"),
    ("Meridian (Fable)", "claude-code-fable/worldwide-city — hex flower, 1M people"),
    ("Resilient City (ChatGPT)", "chat-gpt-code/resilient-city — 5x5 square grid of 2 km districts, 1M people (added later; a ChatGPT design, not a Claude-model one)"),
]
r = 3
for a, b in notes:
    ca = ws4.cell(r, 1, a); ca.font = LABEL if b == "" else Font(size=10, bold=(a and not b))
    if a in ("Status tags", "Why figures are not directly comparable", "Source repos"):
        ca.font = Font(bold=True, size=12, color="1F2A44")
    cb = ws4.cell(r, 2, b); cb.alignment = WRAP; cb.font = Font(size=10)
    if a == "blue text":
        ca.font = DER_FONT
    if "MISSING" in a:
        ca.fill = MISS_FILL; ca.font = MISS_FONT
    ws4.row_dimensions[r].height = 28
    r += 1
ws4.column_dimensions["A"].width = 26
ws4.column_dimensions["B"].width = 100

out = ROOT / "city_comparison.xlsx"
wb.save(out)
print("wrote", out)
print("gap counts:", gap_counts)
