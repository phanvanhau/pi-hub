# AWK Patterns Reference

A reusable pattern library for CSV processing with `awk`.

---

## Boilerplate: Safe Header + BOM + CR Handling

```awk
awk -F',' '
FNR==NR {
    if (FNR==1) next
    gsub(/\r/, "")
    gsub(/^\xef\xbb\xbf/, "", $1)
    # ... your logic ...
    next
}
' file.csv
```

---

## Single File Patterns

### Filter with header preserved
```bash
awk -F',' 'NR==1 || ($3=="94" && $4+0 > 3.3)' file.csv
```

### Case-insensitive string match
```bash
awk -F',' 'NR==1 || tolower($5)=="général"' file.csv
```

### Numeric range filter
```bash
awk -F',' 'NR==1 || ($4+0 >= 3.0 && $4+0 <= 4.5)' file.csv
```

### Multi-value column filter (IN operator equivalent)
```bash
awk -F',' 'NR==1 || $3=="92" || $3=="93" || $3=="94"' file.csv
```

### Strip spaces from numbers ("10 306" → 10306)
```bash
awk -F',' '{gsub(/ /, "", $4); if ($4+0 <= 6000) print}' file.csv
```

### Print specific columns only
```bash
awk -F',' 'NR==1 || $5=="Général" {print $2","$3","$4}' file.csv
```

---

## Multi-File Join Skeleton (3 files)

```awk
awk -F',' '
# ── File 1 ─────────────────────────────────────────────
FNR==NR {
    if (FNR==1) next
    gsub(/\r/, ""); gsub(/^\xef\xbb\xbf/, "", $1)
    if ($5 == "TARGET_FACTOR" && $4+0 > THRESHOLD) {
        map1[$2] = $4+0
        dept[$2] = $3
    }
    next
}

# ── File 2 ─────────────────────────────────────────────
FILENAME == ARGV[2] {
    if (FNR==1) next
    gsub(/\r/, ""); gsub(/^\xef\xbb\xbf/, "", $1)
    if ($5 == "PRICE_FACTOR") {
        val = $4; gsub(/ /, "", val)
        if (val+0 <= PRICE_LIMIT)
            map2[$2] = val+0
    }
    next
}

# ── File 3 ─────────────────────────────────────────────
FILENAME == ARGV[3] {
    if (FNR==1) next
    gsub(/\r/, ""); gsub(/^\xef\xbb\xbf/, "", $1)
    if ($1+0 <= RANK_LIMIT) {
        city = $2; rank = $1+0; name = $4; sector = $5
        if (!(city in best_rank) || rank < best_rank[city])
            best_rank[city] = rank
        entry = name "(" sector ")(" rank ")"
        school_list[city] = (city in school_list) ? school_list[city] "|" entry : entry
    }
    next
}

# ── JOIN + SORT + OUTPUT ────────────────────────────────
END {
    # Normalise file1 keys for cross-file matching
    for (city in map1) {
        up = toupper(city); gsub(/-/, " ", up)
        up_to_orig[up] = city
    }

    n = 0
    for (school_city in best_rank) {
        if (school_city in up_to_orig) {
            orig = up_to_orig[school_city]
            if (orig in map2) {
                n++; cities[n] = orig
                scores[orig] = map1[orig]
                prices[orig] = map2[orig]
                dept_out[orig] = dept[orig]
                s_rank[orig]  = best_rank[school_city]
                s_list[orig]  = school_list[school_city]
            }
        }
    }

    # Sort descending by score
    for (i = 1; i <= n; i++)
        for (j = i+1; j <= n; j++)
            if (scores[cities[i]]+0 < scores[cities[j]]+0) {
                tmp = cities[i]; cities[i] = cities[j]; cities[j] = tmp
            }

    print "rank,city,dept,score,price,best_school_rank,schools"
    LIMIT = 20
    for (i = 1; i <= (n < LIMIT ? n : LIMIT); i++)
        print i","cities[i]","dept_out[cities[i]]","scores[cities[i]]","prices[cities[i]]","s_rank[cities[i]]","s_list[cities[i]]
}
' file1.csv file2.csv file3.csv
```

---

## Aggregation Patterns

### Count rows per group
```awk
{ count[$3]++ }
END { for (k in count) print k, count[k] }
```

### Sum values per group
```awk
{ sum[$2] += $4+0 }
END { for (k in sum) print k, sum[k] }
```

### Average per group
```awk
{ sum[$2] += $4+0; cnt[$2]++ }
END { for (k in sum) print k, sum[k]/cnt[k] }
```

### Best (min) rank per group
```awk
{
    city = $2; rank = $1+0
    if (!(city in best) || rank < best[city])
        best[city] = rank
}
```

### Collect list per group (pipe-separated)
```awk
{
    key = $2
    val = $4 "(" $5 ")(" $1 ")"
    list[key] = (key in list) ? list[key] "|" val : val
}
```

---

## Sorting Patterns

### In-memory bubble sort (small N < 500)
```awk
for (i = 1; i <= n; i++)
    for (j = i+1; j <= n; j++)
        if (scores[cities[i]]+0 < scores[cities[j]]+0) {
            tmp = cities[i]; cities[i] = cities[j]; cities[j] = tmp
        }
```

### External sort for large files
```bash
awk '...' file.csv | sort -t',' -k4 -rn | head -20
```

### Sort by multiple columns (score DESC, then price ASC)
```bash
sort -t',' -k4 -rn -k5 -n
```
