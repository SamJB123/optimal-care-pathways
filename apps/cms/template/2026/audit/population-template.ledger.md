# Fidelity ledger — Attachment C, population-based template (91 pages)

Ground truth: the rendered PDF pages (`../source/Attachment-C-…pdf`), read beside the
rendered sections on the review page (`/review/<core-population document>`), light and
dark schemes. Compared against: the seed built by the two-stage extractor
(`src/template/extract/`), printed with `scripts/print-seed.ts population-template`.

Classes as in the cancer ledger: `text`, `structure`, `inline`, `semantics`. The
population template shares the cancer template's grammar (boxes, banners, "Or" rows,
stopwatch rows, key tables, Find out more / See also, tiles and icon grids), so every
general rule listed under "Resolved by the extractor" in `cancer-template.ledger.md`
applies here unchanged; this ledger records only what is specific to Attachment C.

## Seed as of 2026-09-23

156 sections, 85 references; 251 boxes, 13 variant groups, 8 timeframes, 4 real tables,
257 check items, 233 guidance blocks, 85 citations, 1 footnote, 9 figures, 152 placeholders,
161 resource entries.

## Findings, page by page (structure pass; visual checks pp.6–9, 14, 16–17, 26, 39–41, 80)

- **p.1 → cover**: as Attachment B; `[insert population group]` placeholder in the title.
- **p.2–3 → instructions for developers**: developer prose is PURPLE in this template (the
  cancer template's is green). The instruction colour is learned from the pen boxes per
  document, so guidance and inline instructions are recognised (`semantics`, resolved).
- **p.6–7 → About OCPs**: tiles (Cancer-specific / Population-based) as `columns` of
  callout boxes in their families (success / accent); icon grids (Using OCPs, Pathway
  resources) as `columns` (`structure`, resolved).
- **p.8–13 → Principles for Optimal Cancer Care / Population-based considerations**: one
  pen box per principle with "Population-based considerations for <principle>" banner
  boxes, "Population-based actions" checklists, and Find out more boxes whose entries are
  `<Optional>` guidance (`structure`, resolved: banner-first boxes, guidance-only boxes,
  Find out more boxes with guidance rows). The address of the parent section is the slug
  cap of "Population-based considerations for the Principles for Optimal Cancer Care"
  (`principles-for-optimal-cancer-care/population-based-considerations-for-the-principles-for-optimal-c`);
  the printed heading is kept whole in `title` (`semantics`, accepted).
- **p.14 → Steps of the Optimal Care Pathway**: the schematic figure is replaced by the
  `pathwayMap` node (decision 63); the map is drawn from the document's steps at render.
- **p.16 → About this population group**: key table (Size and demographics …) with
  guidance in the value cells (`structure`, resolved as a real table with guidance).
- **Steps 1–7 (pp.17–66)**: per-step "Supportive care" sections (`<step>/supportive-care`)
  carry the considerations / checklist / communication boxes; timeframe rows (8) read as
  `timeframe` nodes with a `carePoint`. Numbering gap 4.7 → 4.10 is printed (4.8 and 4.9
  do not exist in this template) and kept as printed (decision 45: recorded, not
  renumbered, since cross-references elsewhere use the printed numbers).
- **p.80 → Find out more, Palliative care**: a resource description broken over a page
  ("… one set for specialist services and one for all health" / "professionals and aged
  care services <hyperlink to …>") is one entry again: plain paragraphs continue the
  entry across the page-split row and the printed `<hyperlink to …>` note is dropped in
  favour of the entry's url (`text`, resolved).
- **Highlights**: 152 placeholders; the yellow subject placeholder is
  `[population group]` throughout, substituted from `documents.subject` at render
  (decision 29).

## Still open

- pp.18–79 compared by structure scans and the print; a page-by-page visual read of every
  step page has not been done (the cancer template's steps share the grammar and were
  read).
- The instruction colour is per document; a purple word inside black body prose that is
  NOT an instruction (none found so far) would be misread as one.

## Normalise (decision 45)

- None beyond the cancer template's list; the 4.7 → 4.10 gap is kept as printed.
