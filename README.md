# Duracell KPI – web report

A web version of the **Duracell KPI New1** Power BI report. It's a plain website, so your Client can open it in any browser without a Power BI licence. GitHub Pages hosts it for free.

**Pages:** Executive Summary · Spar · PnP Franchise · PnP Corporate · Checkers · Shoprite · PnP FSU.
**Filters:** Channel, Division, Year Month and Region, like the Power BI slicers.

## How it works

```
Excel files (stay on your PC)  ──►  build.bat  ──►  docs/data/report.json  ──►  GitHub Pages website
```

* `build.bat` runs `builder/build_data.py`. The script reads the same Excel files the Power BI report used and writes one summary file, `docs/data/report.json`.
* The website (`docs/`) reads that file and works out every number in the browser.
* **Nothing private goes online.** `report.json` only holds counts and totals. It has no staff names, e-mails, store names or free-text answers, and stores show up as anonymous numbers. The raw Excel files are kept out of GitHub by `.gitignore`.

## Setup (one time)

1. **Install Python 3** from python.org. Tick *"Add Python to PATH"* during the install.
2. **Put the source files in `source_data/`** (or point `builder/config.json` at your OneDrive folders, see below):
   * `Form Report*.xlsx` (sheet *Submission Answers*). Several Form Report files are fine; they are combined.
   * `KPI Store List.xlsx`
   * `Cleaned Store List.xlsx`
   * `Spar Sales 4 Distr.xlsx` (sheets *Store_Ranking* and *Spar Product Map*)
   * `inventory/Inventory Duracell dd.mm.yyyy.xlsx`: all the weekly files
3. **Double-click `build.bat`.** It installs pandas and openpyxl the first time, then builds `docs/data/report.json`.
4. **Create the GitHub site.** The easiest way is [GitHub Desktop](https://desktop.github.com):
   * File → *Add local repository* → choose this folder → *create a repository* → **Publish repository**. Untick *"Keep this code private"*, because free GitHub Pages needs a public repository.
   * On github.com, open the repository → **Settings → Pages** → *Source: Deploy from a branch* → Branch **main**, folder **/docs** → Save.
   * After a minute or two the site is live at `https://<your-account>.github.io/<repository-name>/`. Send that link to your Client.

## Weekly update

1. Drop the new `Inventory Duracell dd.mm.yyyy.xlsx` into `source_data/inventory/`, and replace the Form Report, Store List or Spar Sales files if they changed.
2. Double-click `build.bat`.
3. In GitHub Desktop: **Commit to main** → **Push origin**. The site updates within a minute or two.

## Using your OneDrive folders directly

Edit `builder/config.json`. Use forward slashes or doubled backslashes:

```json
{
  "form_report_glob": "C:/Users/TimThring/OneDrive - Meridian Group/Power BI - Power BI Source Channel - Power BI Source Channel/Duracell/New KPI Data/Form Report*.xlsx",
  "kpi_store_list": "C:/Users/TimThring/OneDrive - Meridian Group/Power BI - Power BI Source Channel - Power BI Source Channel/Duracell/KPI Store List.xlsx",
  "cleaned_store_list": "C:/Users/TimThring/OneDrive - Meridian Group/Power BI - Power BI Source Channel - Power BI Source Channel/Duracell/Cleaned Store List.xlsx",
  "spar_sales": "C:/Users/TimThring/OneDrive - Meridian Group/Power BI - Power BI Source Channel - Power BI Source Channel/Duracell/Spar Sales 4 Distr.xlsx",
  "inventory_glob": "C:/Users/TimThring/OneDrive - Meridian Group/Power BI - Power BI Source Channel - Power BI Source Channel/Duracell/Stockfix Data/Inventory Duracell*.xlsx",
  "inventory_history": "source_data/inventory_history_from_pbix.csv.gz",
  "stockfix_product_map": "builder/reference/stockfix_product_map.csv"
}
```

`inventory_history_from_pbix.csv.gz` holds the weekly stock lines that were already loaded in the Power BI file (Jan–Sep 2026). It's only used for weeks that have no Inventory file. Once every weekly file is in the inventory folder, you can delete it, or set `"inventory_history": ""`.

`builder/reference/stockfix_product_map.csv` is the *Stockfix Product Map* (article description → standard product), taken from the Power BI file. Add a row when a new article appears. You can also point the setting at your own `Stockfix Product.xlsx`.

## Business rules (same as the Power BI model)

| Measure | Rule |
|---|---|
| Store list | Every store is matched to **KPI Store List** on UPPER(TRIM(store name)). Stores not on the list are left out. |
| **OSA Products On Shelf %** | **PnP Family, Spar, Kwikspar, Superspar** use the survey: Form Report, Question Group *OSA*, "yes" ÷ all answers. **All other banners** use the weekly Inventory files: a store + product + week line is 100% when *Store SOH* > 0, otherwise 0%. Only *Active* articles count. Inventory site names are matched through **Cleaned Store List**. Each store gets its own %, then the stores are averaged (like the DAX `AVERAGEX`). |
| Stockfix OSA % | Inventory lines on shelf ÷ all inventory lines (PnP Corporate, Shoprite, region tables). |
| Brand shares | Pegs for the brand ÷ pegs for all brands (Question Group *FORWARD SHARE*). |
| Numeric distribution (Spar) | Store + product + month cells in *Spar Sales 4 Distr* with Sales > 0 ÷ all cells. Uses products in *Spar Product Map*. Cluster 5 is excluded. |
| PnP FSU | Stores answering "yes" to *"Is an FSU currently implemented in-store?"* or the Powerwing question ÷ stores that answered. |
| Store Completion | KPI-list stores with a submission in the selected months ÷ KPI-list stores for those months. |
| Targets | OSA 90%, Duracell 65%, Energizer 35%, Eveready 40%. Cells below target are shaded. |

## Privacy note

On a free GitHub account the repository and the website are **public**. Anyone who has (or guesses) the link can open the report and its summary numbers. The page asks search engines not to index it. If the Client data must stay behind a login, host the same `docs/` folder on a service with password protection instead (for example Cloudflare Pages with Cloudflare Access, or a private GitHub Enterprise Pages site). No code changes are needed.

## Files

```
build.bat                     double-click to rebuild the data
requirements.txt              Python packages (pandas, openpyxl)
builder/build_data.py         reads the Excel files, writes docs/data/report.json
builder/config.json           where the Excel files are
builder/reference/            Stockfix product map (from the Power BI file)
docs/                         the website (GitHub Pages serves this folder)
  index.html, app.js, style.css, assets/, data/report.json
source_data/                  your Excel files – never uploaded (see .gitignore)
```
