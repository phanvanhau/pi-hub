# Encoding Gotchas Reference

Common encoding issues encountered when processing CSV files in bash.

---

## 1. UTF-8 BOM (Byte Order Mark)

### Symptom
First field of the first row contains invisible garbage — filters on column 1 silently fail.

```bash
# Reveals BOM as "ef bb bf"
head -c 3 file.csv | xxd
# ef bb bf 72 61 6e 6b   →  ﻿rank  (BOM before "rank")
```

### Fix in awk
```awk
gsub(/^\xef\xbb\xbf/, "", $1)
```

Apply this in every file's first pass block, not just the first file.

### Fix with sed (pre-processing)
```bash
sed -i '1s/^\xef\xbb\xbf//' file.csv
```

### Fix with iconv
```bash
iconv -f UTF-8-BOM -t UTF-8 file.csv > file_clean.csv
```

---

## 2. Windows Line Endings (CRLF)

### Symptom
String comparisons fail because `$5` contains `"Général\r"` not `"Général"`.
The trailing `\r` is invisible in most terminals.

```bash
# Detect
file file.csv
# output: "ASCII text, with CRLF line terminators"

# Or
cat -A file.csv | head -3
# Shows ^M at end of each line
```

### Fix in awk
```awk
gsub(/\r/, "")
```

Apply at the start of every awk block (before any comparisons).

### Fix with tr (pre-processing)
```bash
tr -d '\r' < file.csv > file_clean.csv
```

### Fix with dos2unix
```bash
dos2unix file.csv
```

---

## 3. Numbers with Space Thousands Separators

### Symptom
Numeric comparisons fail: `"10 306"+0` evaluates to `10` in awk (stops at space).

```bash
# Example: house price stored as "10 306" instead of "10306"
awk -F',' '$4+0 > 6000'   # ← silently wrong! "10 306"+0 = 10
```

### Fix in awk
```awk
price = $4
gsub(/ /, "", price)
if (price+0 > 6000) ...
```

---

## 4. Accented Characters in Filter Strings

### Symptom
`$5 == "Général"` fails when the file is not in UTF-8 or the terminal encoding differs.

### Diagnosis
```bash
# Check file encoding
file file.csv
chardet file.csv   # pip install chardet

# Check hex value of the accented char
echo -n "Général" | xxd | head -1
```

### Fix
Ensure the shell and file are both UTF-8:
```bash
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8
```

Or use a regex match to be tolerant:
```awk
$5 ~ /^G.n.ral$/   # matches "Général" regardless of accent encoding
```

---

## 5. Column Count Mismatch (Embedded Commas)

### Symptom
A field contains a comma (e.g. `"Smith, John"`) — awk splits it into two fields, shifting all column indices.

### Diagnosis
```bash
awk -F',' '{print NF}' file.csv | sort -u
# If multiple different NF values → embedded commas present
```

### Fix
Switch to `mlr` or `csvkit` which handle RFC 4180 quoting:
```bash
mlr --csv filter '$factor == "Général"' file.csv
csvgrep -c factor -m "Général" file.csv
```

---

## 6. Mixed Casing Across Files

### Symptom
Join key exists in both files but never matches: `"Boulogne-Billancourt"` vs `"BOULOGNE BILLANCOURT"`.

### Fix
Normalise both sides before comparison:
```awk
# Normalise file1 key → uppercase no-hyphen → store reverse lookup
up = toupper(city)
gsub(/-/, " ", up)
up_to_orig[up] = city

# When processing file3 (already uppercase), look up in up_to_orig
if (school_city in up_to_orig) { orig = up_to_orig[school_city] ... }
```

---

## Quick Diagnostic Checklist

```bash
# 1. BOM?
head -c 3 file.csv | xxd | grep "ef bb bf" && echo "BOM detected"

# 2. CRLF?
file file.csv | grep -i "crlf" && echo "Windows line endings"

# 3. Encoding?
file file.csv

# 4. Unique values in filter column (col 5)?
awk -F',' 'NR>1 {print $5}' file.csv | sort -u

# 5. Consistent column count?
awk -F',' '{print NF}' file.csv | sort -u

# 6. Sample of join key column
awk -F',' 'NR>1 {print $2}' file.csv | sort -u | head -10
```
