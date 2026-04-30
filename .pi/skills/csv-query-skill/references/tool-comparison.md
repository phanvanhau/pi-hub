# Tool Comparison Reference

Choosing the right tool for CSV processing.

---

## Quick Decision Matrix

| Scenario | Best Tool |
|---|---|
| Clean CSV, 1 file, quick filter | `awk` or `grep` |
| Clean CSV, multi-file join | `awk` |
| CSV with quoted fields / embedded commas | `mlr` or `csvkit` |
| Named-column access (no index guessing) | `mlr` |
| SQL-style querying (`WHERE`, `JOIN`, `GROUP BY`) | `duckdb` or `sqlite3` |
| Interactive exploration / statistics | `csvkit` (`csvstat`, `csvlook`) |
| Large files (> 1M rows) | `duckdb` |
| Scripted pipeline with transformations | `mlr` |

---

## awk

**Best for:** Clean CSVs, fast one-liners, multi-file joins, portable scripts.

```bash
# Filter + join across 3 files
awk -F',' 'FNR==NR { map[$2]=$4; next } $2 in map { print $0, map[$2] }' \
    file1.csv file2.csv
```

**Pros:**
- Available everywhere (no install)
- Extremely fast
- Full programming language (arrays, loops, regex)
- Multi-file pass pattern is powerful

**Cons:**
- Column access by index ($1, $2...) — fragile if columns change
- Does NOT handle quoted commas (`"Smith, John"`)
- Sorting requires bubble sort or piping to `sort`
- Verbose for complex transformations

---

## mlr (Miller)

**Install:** `brew install miller` / `apt install miller`

**Best for:** Pipelines, named columns, complex transforms, RFC 4180 CSV.

```bash
# Filter with named columns
mlr --csv filter '$score > 3.3 && $department == "94"' file.csv

# Join two files on city_name
mlr --csv join -f file1.csv -j city_name file2.csv

# Sort + head
mlr --csv sort -nr score then head -n 20 file.csv

# Aggregate: group by city, collect school names
mlr --csv group-by city then put '$schools = joinx($school_name, "|")' file.csv
```

**Pros:**
- Named field access (`$city_name` not `$2`)
- Handles quoted commas correctly
- Pipeline-friendly (`then` chaining)
- Built-in sort, join, group-by, stats

**Cons:**
- Requires installation
- Slightly slower than `awk` for simple cases
- Syntax can be verbose for multi-file joins

---

## csvkit

**Install:** `pip install csvkit`

**Best for:** Exploration, quick inspection, simple filters by column name.

```bash
# Inspect structure and stats
csvstat file.csv

# Filter by column name and value
csvgrep -c factor -m "Général" file.csv
csvgrep -c score -r "^[4-9]" file.csv   # regex match

# Join two CSVs on a key column
csvjoin -c city_name file1.csv file2.csv

# Pretty-print
csvlook file.csv | head -20

# SQL on CSV
csvsql --query "SELECT city_name, score FROM file WHERE score > 3.3" file.csv
```

**Pros:**
- Most human-readable syntax
- Handles all CSV edge cases (BOM, CRLF, quoted fields)
- `csvsql` gives full SQL on CSV files
- `csvstat` for instant data profiling

**Cons:**
- Python dependency
- Slower than `awk`/`mlr` for large files
- `csvjoin` loads both files in memory

---

## duckdb

**Install:** `brew install duckdb` / download binary

**Best for:** Large files, complex SQL, multi-file joins with full SQL syntax.

```bash
# Launch and query CSV directly
duckdb -c "
SELECT
    c.city_name,
    c.department_code,
    c.score AS general_score,
    s.score AS house_price
FROM 'output/classement_opinions.csv' c
JOIN 'output/statistiques_nationales.csv' s
  ON c.city_name = s.city_name
WHERE c.factor = 'Général'
  AND c.score > 3.3
  AND s.factor = 'Prix immobilier moyen'
  AND CAST(REPLACE(s.score, ' ', '') AS INTEGER) <= 6000
ORDER BY c.score DESC
LIMIT 20
"
```

**Pros:**
- Full SQL (`JOIN`, `GROUP BY`, `HAVING`, `WINDOW`, subqueries)
- Handles millions of rows efficiently
- Auto-detects CSV schema
- Can read multiple files with wildcards: `FROM 'output/*.csv'`

**Cons:**
- Requires install
- Overkill for simple filters
- SQL syntax for string manipulation can be verbose

---

## grep

**Best for:** Quick pattern scan when column precision is not needed.

```bash
# Fast scan (not column-aware!)
grep "Général" file.csv
grep -E "^[^,]+,94," file.csv   # rough column filter
```

**Pros:** Fastest, always available
**Cons:** Not column-aware, fragile on partial matches

---

## Comparison Summary

| Feature | awk | mlr | csvkit | duckdb | grep |
|---|:---:|:---:|:---:|:---:|:---:|
| Column-aware | ✅ (by index) | ✅ (by name) | ✅ (by name) | ✅ (by name) | ❌ |
| Quoted field handling | ❌ | ✅ | ✅ | ✅ | ❌ |
| Multi-file join | ✅ (manual) | ✅ | ✅ | ✅ (SQL) | ❌ |
| In-memory aggregation | ✅ | ✅ | ✅ | ✅ | ❌ |
| Sort | ⚠️ (bubble/pipe) | ✅ | ✅ | ✅ | ❌ |
| Large files (> 1M rows) | ⚠️ | ✅ | ❌ | ✅ | ✅ |
| No install required | ✅ | ❌ | ❌ | ❌ | ✅ |
| SQL syntax | ❌ | ❌ | ⚠️ (csvsql) | ✅ | ❌ |
| Speed (relative) | ⚡⚡⚡ | ⚡⚡ | ⚡ | ⚡⚡⚡ | ⚡⚡⚡⚡ |
