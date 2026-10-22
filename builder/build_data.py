"""
Duracell KPI – data builder
===========================

Reads the raw Excel files (the same ones the Power BI report used) and writes
ONE summary file, docs/data/report.json, that the web report reads.

Only aggregated numbers go into report.json: no staff names, e-mails, store
names or answers. Store names are replaced by an anonymous number.

Run:  python builder/build_data.py            (or double-click build.bat)

Paths are set in builder/config.json. Every path is relative to the repo
folder unless you give a full path (e.g. your OneDrive folder).

Business rules (copied from Duracell KPI New1.pbix)
--------------------------------------------------
* Target store list = "KPI Store List". Every store is matched to it by
  UPPER(TRIM(store name)). Stores that don't match are left out.
* OSA source per banner:
    - Pick N Pay Family, Spar, Kwikspar, Superspar  -> survey (Form Report,
      Question Group = OSA, Answer = "yes")
    - every other banner                            -> weekly Inventory files:
      a store + product + week line is 100% if Store SOH > 0, else 0%.
      Only "Active" articles count. Inventory "Site Name" is matched to the
      KPI store list through "Cleaned Store List".
* Forward share = pegs of a brand / pegs of all brands (Question Group =
  FORWARD SHARE).
* Numeric distribution (Spar) = share of store + product + month cells in
  "Spar Sales 4 Distr" with Sales > 0. Products come from the
  "Spar Product Map" sheet; Cluster ID 5 is excluded.
* PnP FSU = stores answering "yes" to the two FSU questions / stores that
  answered them.
"""

import glob
import json
import os
import re
import sys
from datetime import datetime

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

SURVEY_BANNER_WORDS = ["pick n pay family", "spar"]  # contains-match, like the DAX
FSU_QUESTIONS = {
    "IS AN FSU CURRENTLY IMPLEMENTED IN-STORE?",
    "IF NO FSU IS PRESENT, HAS A SIDE PANEL (POWERWING) BEEN IMPLEMENTED AS AN ALTERNATIVE?",
}
BRANDS = ["DURACELL", "ENERGIZER", "EVEREADY", "SUPERPOWER", "HOUSEBRAND", "OTHER"]


def log(msg):
    print(msg, flush=True)


def path(p):
    return p if os.path.isabs(p) else os.path.join(ROOT, p)


def clean_key(s):
    """Text.Upper(Text.Trim(Text.Clean(x))) – same as the Power Query keys."""
    return (
        s.astype("string")
        .str.replace(r"[\x00-\x1f\x7f]", "", regex=True)
        .str.strip()
        .str.upper()
    )


def strip_cols(df):
    df.columns = [str(c).strip() for c in df.columns]
    return df


def month_start(series):
    d = pd.to_datetime(series, errors="coerce")
    return d.dt.to_period("M").dt.to_timestamp()


# --------------------------------------------------------------------------
# Load
# --------------------------------------------------------------------------

def load_config():
    with open(os.path.join(HERE, "config.json"), encoding="utf-8") as f:
        return json.load(f)


def load_store_list(cfg):
    df = strip_cols(pd.read_excel(path(cfg["kpi_store_list"])))
    df["key"] = clean_key(df["STORE NAME"])
    df = df[df["key"].notna() & (df["key"] != "")]
    df["month"] = month_start(df["MONTH"])
    # Dim Store = one row per store; latest month's attributes win
    dim = (
        df.sort_values("month")
        .groupby("key")
        .agg(BANNER=("BANNER", "last"), REGION=("REGION", "last"),
             DIVISION=("DIVISION", "last"), CHANNEL=("CHANNEL", "last"))
        .reset_index()
    )
    for c in ["BANNER", "REGION", "DIVISION", "CHANNEL"]:
        dim[c] = dim[c].astype("string").str.strip()
    universe = df[["key", "month"]].dropna().drop_duplicates()
    log(f"  KPI Store List: {len(dim)} stores, months {sorted(universe.month.dt.strftime('%Y-%m').unique())}")
    return dim, universe


def load_survey(cfg):
    files = sorted(glob.glob(path(cfg["form_report_glob"])))
    if not files:
        sys.exit("No Form Report file found – check form_report_glob in config.json")
    parts = []
    for f in files:
        log(f"  Form Report: {os.path.basename(f)}")
        d = strip_cols(pd.read_excel(f, sheet_name="Submission Answers"))
        parts.append(d)
    df = pd.concat(parts, ignore_index=True).drop_duplicates()
    df["key"] = clean_key(df["Customer Name"])
    df["month"] = month_start(df["MONTH"])
    df["qg"] = df["Question Group"].astype("string").str.strip().str.upper()
    df["ans"] = df["Answer"].astype("string").str.strip()
    df["product"] = df["Product"].astype("string").str.strip()
    df["date"] = pd.to_datetime(df["Date"], errors="coerce")
    return df


def load_cleaned_store_map(cfg):
    c = strip_cols(pd.read_excel(path(cfg["cleaned_store_list"])))
    c["k"] = clean_key(c["Store Name"])
    c["ck"] = clean_key(c["Cleaned Store NAME"])
    c = c.dropna(subset=["k", "ck"])
    # A few raw names map to two cleaned names; keep the first so no line is counted twice
    return c.drop_duplicates("k").set_index("k")["ck"]


def load_stockfix_product_map(cfg):
    p = path(cfg["stockfix_product_map"])
    m = pd.read_excel(p) if p.lower().endswith((".xlsx", ".xls")) else pd.read_csv(p)
    m = strip_cols(m)
    m["k"] = clean_key(m["Article Description"])
    m = m.dropna(subset=["Product"])
    return m.drop_duplicates("k").set_index("k")["Product"].astype("string").str.strip()


def load_inventory(cfg, store_map, product_map):
    files = sorted(glob.glob(path(cfg["inventory_glob"])))
    log(f"  Inventory files: {len(files)}")
    parts = []
    for f in files:
        d = strip_cols(pd.read_excel(f))
        d = d[["Week Ending", "Site Name", "Article Description", "Store SOH", "Article Status"]]
        parts.append(d)
    if parts:
        inv = pd.concat(parts, ignore_index=True)
        inv["week"] = pd.to_datetime(inv["Week Ending"], errors="coerce").dt.normalize()
        inv = inv[inv["Article Status"].astype("string").str.strip().str.upper() == "ACTIVE"]
        inv["store_key"] = clean_key(inv["Site Name"]).map(store_map)
        inv["product"] = clean_key(inv["Article Description"]).map(product_map)
        inv["soh"] = pd.to_numeric(inv["Store SOH"], errors="coerce").fillna(0)
        inv = inv.dropna(subset=["store_key", "product", "week"])
        inv = inv[["week", "store_key", "product", "soh"]]
    else:
        inv = pd.DataFrame(columns=["week", "store_key", "product", "soh"])

    # Optional history (weeks already loaded in Power BI). Only used for weeks
    # that are NOT in the Inventory files, so new files always win.
    hist_p = cfg.get("inventory_history")
    if hist_p and os.path.exists(path(hist_p)):
        h = pd.read_csv(path(hist_p))
        h = h.rename(columns={"Week Ending": "week", "STORE NAME": "store_key",
                              "Standardized Product": "product", "Store SOH": "soh"})
        h["week"] = pd.to_datetime(h["week"]).dt.normalize()
        h["store_key"] = clean_key(h["store_key"])
        h = h[~h["week"].isin(set(inv["week"].unique()))]
        log(f"  Inventory history: {h['week'].nunique()} extra weeks from {os.path.basename(hist_p)}")
        inv = pd.concat([inv, h[["week", "store_key", "product", "soh"]]], ignore_index=True)

    # One line per store + product + week (Fact Stockfix OSA)
    g = inv.groupby(["week", "store_key", "product"], as_index=False)["soh"].sum()
    g["present"] = (g["soh"] > 0).astype(int)
    g["month"] = g["week"].dt.to_period("M").dt.to_timestamp()
    log(f"  Inventory lines: {len(g)} store/product/weeks, {g['week'].nunique()} weeks")
    return g


def load_spar_sales(cfg, store_map):
    p = path(cfg["spar_sales"])
    sr = strip_cols(pd.read_excel(p, sheet_name="Store_Ranking"))
    pm = strip_cols(pd.read_excel(p, sheet_name="Spar Product Map"))
    pm["k"] = clean_key(pm["Product"])
    pm = pm.dropna(subset=["Standardized Product"]).drop_duplicates(["k", "Standardized Product"])
    std_products = sorted(pm["Standardized Product"].astype(str).str.strip().unique())

    sr["store"] = clean_key(sr["Geography"])
    sr = sr[sr["store"].notna() & (sr["store"] != "") & (sr["store"] != "ALL STORES")]
    sr["pk"] = clean_key(sr["Product"])
    sr["sales"] = pd.to_numeric(sr["Sales"], errors="coerce").fillna(0)
    m = re.compile(r"(\d{2})-(\d{2})-(\d{4})")
    sr["month"] = sr["Time"].astype(str).map(
        lambda t: pd.Timestamp(int(m.search(t).group(3)), int(m.search(t).group(2)), 1) if m.search(t) else pd.NaT)
    sr["cluster_id"] = sr["Cluster ID"].astype("string").str.strip()

    first = lambda s: s.dropna().iloc[0] if s.dropna().size else None
    stores = sr.groupby(["month", "store"]).agg(
        cluster=("Cluster", first), dc=("Managing_DC", first), cluster_id=("cluster_id", first)
    ).reset_index()
    mapped = sr.merge(pm[["k", "Standardized Product"]], left_on="pk", right_on="k")
    sales = mapped.groupby(["month", "store", "Standardized Product"])["sales"].sum()

    grid = stores.merge(pd.DataFrame({"Standardized Product": std_products}), how="cross")
    grid = grid.join(sales, on=["month", "store", "Standardized Product"])
    grid["score"] = (grid["sales"].fillna(0) > 0).astype(int)
    grid = grid[grid["cluster_id"] != "5"]
    grid["kpi_key"] = grid["store"].map(store_map)
    log(f"  Spar sales: {grid['store'].nunique()} stores, {len(std_products)} mapped products, "
        f"months {sorted(grid.month.dt.strftime('%Y-%m').unique())}")
    return grid


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------

def main():
    cfg = load_config()
    log("Reading source files…")
    dim, universe = load_store_list(cfg)
    survey = load_survey(cfg)
    store_map = load_cleaned_store_map(cfg)
    product_map = load_stockfix_product_map(cfg)
    inv = load_inventory(cfg, store_map, product_map)
    spar = load_spar_sales(cfg, store_map)

    # --- dimensions --------------------------------------------------------
    dim = dim.sort_values(["BANNER", "REGION", "key"]).reset_index(drop=True)
    store_idx = {k: i for i, k in enumerate(dim["key"])}
    lists = {c: sorted(dim[c].dropna().unique().tolist()) for c in ["BANNER", "REGION", "DIVISION", "CHANNEL"]}
    ix = lambda c, v: lists[c].index(v) if isinstance(v, str) and v in lists[c] else -1
    use_survey = dim["BANNER"].fillna("").str.lower().map(lambda b: any(w in b for w in SURVEY_BANNER_WORDS))

    all_months = sorted(set(survey["month"].dropna()) | set(inv["month"].dropna()) |
                        set(universe["month"].dropna()) | set(spar["month"].dropna()))
    month_idx = {m: i for i, m in enumerate(all_months)}

    survey = survey[survey["key"].isin(store_idx)].copy()
    survey["s"] = survey["key"].map(store_idx)
    survey["m"] = survey["month"].map(month_idx)
    survey = survey.dropna(subset=["m"])
    survey["m"] = survey["m"].astype(int)

    # --- OSA: survey --------------------------------------------------------
    o = survey[(survey["qg"] == "OSA") & survey["ans"].notna() & (survey["ans"] != "")
               & survey["product"].notna() & (survey["product"] != "")].copy()
    o["yes"] = (o["ans"].str.upper() == "YES").astype(int)
    osa_s = o.groupby(["s", "m", "product"]).agg(p=("yes", "sum"), n=("yes", "size")).reset_index()

    # --- OSA: inventory -----------------------------------------------------
    inv = inv[inv["store_key"].isin(store_idx)].copy()
    inv["s"] = inv["store_key"].map(store_idx)
    inv["m"] = inv["month"].map(month_idx).astype(int)
    osa_i = inv.groupby(["s", "m", "product"]).agg(p=("present", "sum"), n=("present", "size")).reset_index()

    products = sorted(set(osa_s["product"]) | set(osa_i["product"]))
    prod_idx = {p: i for i, p in enumerate(products)}

    # --- Forward share --------------------------------------------------------
    f = survey[survey["qg"] == "FORWARD SHARE"].copy()
    f["pegs"] = pd.to_numeric(f["ans"], errors="coerce")
    f["brand"] = f["product"].str.upper()
    f = f[f["brand"].isin(BRANDS) & f["pegs"].notna()]
    fs = f.groupby(["s", "m", "brand"])["pegs"].sum().reset_index()

    # --- Visits (stores with a submission) --------------------------------------
    visits = survey[survey["date"].notna()][["s", "m"]].drop_duplicates()

    # --- FSU -------------------------------------------------------------------
    fsu = survey[(survey["qg"] == "FSU COMPLIANCE")
                 & survey["Question"].astype("string").str.strip().str.upper().isin(FSU_QUESTIONS)
                 & survey["ans"].notna() & (survey["ans"] != "")].copy()
    fsu["yes"] = (fsu["ans"].str.upper() == "YES").astype(int)
    fsu = fsu.groupby(["s", "m"])["yes"].max().reset_index()

    # --- Store universe ----------------------------------------------------------
    uni = universe[universe["key"].isin(store_idx)].copy()
    uni["s"] = uni["key"].map(store_idx)
    uni["m"] = uni["month"].map(month_idx)

    # --- Spar numeric distribution ------------------------------------------------
    nd_products = sorted(spar["Standardized Product"].unique())
    clusters = sorted(spar["cluster"].dropna().astype(str).unique())
    dcs = sorted(spar["dc"].dropna().astype(str).unique())
    spar["s"] = spar["kpi_key"].map(store_idx).fillna(-1).astype(int)
    spar["m"] = spar["month"].map(month_idx).astype(int)
    nd = spar.groupby(["s", "m", "Standardized Product", "cluster", "dc"], dropna=False)["score"].agg(["sum", "size"]).reset_index()

    # --- last data date -----------------------------------------------------------
    last_dates = [survey["date"].max(), inv["week"].max() if len(inv) else pd.NaT]
    last = max(d for d in last_dates if pd.notna(d))

    def rows(df, cols):
        return df[cols].astype(object).values.tolist()

    out = {
        "generated": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "lastDataDate": last.strftime("%Y-%m-%d"),
        "months": [m.strftime("%Y-%m") for m in all_months],
        "banners": lists["BANNER"], "regions": lists["REGION"],
        "divisions": lists["DIVISION"], "channels": lists["CHANNEL"],
        "products": products, "brands": BRANDS,
        "ndProducts": nd_products, "clusters": clusters, "dcs": dcs,
        # store: [banner, region, division, channel, useSurvey(1/0)]
        "stores": [[ix("BANNER", r.BANNER), ix("REGION", r.REGION), ix("DIVISION", r.DIVISION),
                    ix("CHANNEL", r.CHANNEL), int(u)] for r, u in zip(dim.itertuples(), use_survey)],
        # [store, month, product, present, checks]
        "osaSurvey": [[int(a), int(b), prod_idx[c], int(d), int(e)] for a, b, c, d, e in rows(osa_s, ["s", "m", "product", "p", "n"])],
        "osaInventory": [[int(a), int(b), prod_idx[c], int(d), int(e)] for a, b, c, d, e in rows(osa_i, ["s", "m", "product", "p", "n"])],
        # [store, month, brand, pegs]
        "share": [[int(a), int(b), BRANDS.index(c), float(d)] for a, b, c, d in rows(fs, ["s", "m", "brand", "pegs"])],
        "visits": [[int(a), int(b)] for a, b in rows(visits, ["s", "m"])],
        "universe": [[int(a), int(b)] for a, b in rows(uni, ["s", "m"])],
        "fsu": [[int(a), int(b), int(c)] for a, b, c in rows(fsu, ["s", "m", "yes"])],
        # [store or -1, month, product, cluster, dc, sold cells, all cells]
        "nd": [[int(r[0]), int(r[1]), nd_products.index(r[2]),
                clusters.index(str(r[3])) if pd.notna(r[3]) else -1,
                dcs.index(str(r[4])) if pd.notna(r[4]) else -1, int(r[5]), int(r[6])]
               for r in nd.itertuples(index=False, name=None)],
    }
    os.makedirs(path("docs/data"), exist_ok=True)
    target = path("docs/data/report.json")
    with open(target, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))
    log(f"\nWrote {target} ({os.path.getsize(target)/1e6:.1f} MB)")
    log(f"  stores {len(out['stores'])}, survey OSA rows {len(out['osaSurvey'])}, "
        f"inventory OSA rows {len(out['osaInventory'])}, share rows {len(out['share'])}")
    log(f"  last data date {out['lastDataDate']}")


if __name__ == "__main__":
    main()
