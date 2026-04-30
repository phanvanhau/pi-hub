---
name: csv-query-skill
description: Multi-CSV querying, filtering, joining, ranking and report generation. Use when the user asks to query, filter, rank, aggregate, or report across one or more CSV files — including cross-file joins on a shared key, numeric/string filtering, top-N ranking, and markdown report output. Triggered by phrases like "filter the CSV", "rank cities", "join these files", "show me the top N", "generate a report from CSV", or when the user references .csv source files.
---

# CSV Query Skill

You are in **CSV query mode**. Your job is to translate the user's natural language query into a precise, executable `awk` (or `mlr`/`csvkit`) pipeline that operates across one or more CSV files, then present the results in a clean, readable format.

---

## Phase 1 — Discover & Inspect Source Files

Before writing any query, you must understand the structure of the source files.

### Step 1 — Identify files

If the user referenced specific files (e.g. `@output/cities.csv`), use those.
If not, search for CSV files in the project:

```bash
find . -name "*.csv" | head -20
```

### Step 2 — Inspect each file's structure

For each relevant file, run:

```bash
head -3 <file.csv>
awk -F',' 'NR==1 {print NF, $0}' <file.csv>
```

This reveals:
- Column count (`NF`)
- Column names and their positions (col index for `awk`)
- Data format (casing, spacing in numbers, BOM, encoding)

### Step 3 — Discover unique values for filter columns

When the user filters by a categorical column (e.g. "factor", "sector", "type"), always verify the exact stored values first:

```bash
awk -F',' 'NR>1 {print $N}' <file.csv> | sort -u
```

This prevents silent mismatches due to accents, casing, or trailing spaces.

### Step 4 — Check for encoding issues

```bash
# Detect BOM
head -c 3 <file.csv> | xxd | head -1

# Check for Windows line endings
file <file.csv>
```

> See [references/encoding-gotchas.md](references/encoding-gotchas.md) for fixes.

---

## Phase 2 — Parse the User Query

Decompose the user's natural language request into structured query parameters:

| Parameter | Description | Example |
|---|---|---|
| **Sources** | Which CSV files are involved | `output/classement_opinions.csv` |
| **Join key** | Shared column used to link files | `city_name` |
| **Filters** | Column + operator + value per file | `score > 3.3`, `sector == "public"` |
| **Columns** | Which columns to include in output | `city_name`, `score`, `department` |
| **Aggregations** | Min/max/list per group | best school rank, school list |
| **Sort** | Column + direction | `score DESC` |
| **Limit** | Top-N results | `20` |
| **Output format** | Raw CSV, markdown table, report | markdown table |

If any parameter is ambiguous (e.g. user says "affordable" without a threshold), make a reasonable assumption and state it clearly in the output, or ask one targeted clarification question.

---

## Phase 3 — Select the Right Tool

Choose the tool based on file complexity:

| Scenario | Tool | Reason |
|---|---|---|
| Clean CSV, no quoted commas | `awk` | Fast, no dependencies |
| Fields with commas inside quotes | `mlr` or `csvkit` | Handles RFC 4180 quoting |
| Complex multi-key joins | `mlr` | Named fields, cleaner syntax |
| Interactive exploration | `csvkit` (`csvstat`, `csvgrep`) | Human-friendly output |

> See [references/tool-comparison.md](references/tool-comparison.md) for detailed comparison.

---

## Phase 4 — Build & Execute the Query

### 4a — Single file query

Use the single-file pattern from [references/awk-patterns.md](references/awk-patterns.md):

```bash
awk -F',' 'NR==1 || ($3=="94" && $4+0 > 3.3)' file.csv
```

### 4b — Multi-file join (2–3 files)

Use the multi-pass pattern. Each file gets its own `awk` block:

```
FNR==NR          → process ARGV[1] (first file)
FILENAME==ARGV[2] → process ARGV[2] (second file)
FILENAME==ARGV[3] → process ARGV[3] (third file)
END              → join maps + sort + print
```

Always apply these defensive fixes in every pass:
```awk
gsub(/\r/, "")                    # strip Windows CR
gsub(/^\xef\xbb\xbf/, "", $1)    # strip UTF-8 BOM
```

### 4c — City name normalisation (cross-file case mismatch)

When joining files where city names are stored differently (e.g. `Boulogne-Billancourt` vs `BOULOGNE BILLANCOURT`):

```awk
# Build lookup: UPPERCASE_NO_HYPHEN → original name
for (city in map_from_file1) {
    up = toupper(city)
    gsub(/-/, " ", up)
    up_to_orig[up] = city
}
# Then look up school_city (uppercase) in up_to_orig
```

### 4d — Aggregations

**Best rank per city:**
```awk
if (!(city in best_rank) || rank < best_rank[city])
    best_rank[city] = rank
```

**Concatenated list per city (pipe-separated):**
```awk
entry = name "(" sector ")(" rank ")"
if (city in list) list[city] = list[city] "|" entry
else              list[city] = entry
```

**Remove spaces from numeric fields (e.g. `"10 306"`):**
```awk
gsub(/ /, "", $4); value = $4+0
```

### 4e — In-memory sort (top-N)

```awk
# Bubble sort descending by score (suitable for N < 500)
for (i = 1; i <= n; i++)
    for (j = i+1; j <= n; j++)
        if (scores[cities[i]]+0 < scores[cities[j]]+0) {
            tmp = cities[i]; cities[i] = cities[j]; cities[j] = tmp
        }

# Print top N
for (i = 1; i <= (n < LIMIT ? n : LIMIT); i++)
    print i "," cities[i] "," scores[cities[i]] ...
```

For large datasets (> 500 rows), prefer piping output to `sort`:
```bash
awk '...' file.csv | sort -t',' -k3 -rn | head -20
```

### 4f — Execute the query

Run the command with `bash`. Always verify the output row count:

```bash
<awk command> | wc -l
```

If 0 results: debug by checking filter values with Phase 1 Step 3.

---

## Phase 5 — Format & Present Results

### 5a — Markdown table

Convert CSV output to a markdown table. Use column headers from the CSV header row.
Format numbers with spaces as thousands separators (e.g. `5952` → `5 952 €`).

### 5b — Annotate the table

After the table, always include:
- Total result count
- Any filters that eliminated the most rows (e.g. "No cities from dept 75 passed the price filter")
- Tie-breaking rule used for equal scores

### 5c — Key observations (when generating a full report)

Group observations by theme:
- 💰 **Affordability** — cheapest/most expensive cities, % price range
- 🏫 **Schools** — best school rank, most schools, mix of sectors
- 🌿 **Quality of life** — top sub-factor scores
- 👥 **Demographics** — population size, income, age
- 🏆 **Standout cities** — best overall value, hidden gems

### 5d — Profile-based recommendations (when requested)

For each family/user profile, recommend a city with reasoning:
- Budget-conscious → lowest price + acceptable score
- School quality → best school rank regardless of price
- Balanced → highest Général score within median price
- Nature/quiet → top Environnement score + low density
- Urban convenience → top Vie pratique + large population

---

## Phase 6 — Optional: Save Report to File

If the user asks to save or generate a report file:

1. Use `write` to create `report.md` (or a user-specified path)
2. Structure: criteria summary → results table → extended scores → observations → profile recommendations
3. Confirm: `✅ Report saved to: <path>`


---

## Reminders

- **Always inspect files before querying** — column positions and exact values can differ from what the user assumes.
- **Never assume column positions** — always confirm from `head -1 file.csv`.
- **State your assumptions** — if you pick a threshold or default filter, tell the user.
- **Show the awk command** — always show the full command used so the user can rerun or adapt it.
- **Debug silently first** — if 0 results, diagnose with `sort -u` on filter columns before asking the user.
- **Large files warning** — if a file has > 50k rows, warn and suggest `mlr` or `duckdb` over `awk`.
