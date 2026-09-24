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
  resources) as `columns` (`structure`, resolved). Their single-line titles and labels
  are centred as printed (alignment judged in the drawn cell — see the cancer ledger's
  "Alignment" rule, 2026-09-23); the two clinician icons sit on one line (`figureRow`);
  "Optimal Care Pathways" is its own title line over its description (`text`, resolved).
  The editor had stacked every `columns` node (a node-view host element sat between the
  grid and the columns); the node view now hands the content element to the block
  itself (`structure`, resolved 2026-09-23).
- **p.8–13 → Principles for Optimal Cancer Care / Population-based considerations**: one
  pen box per principle with "Population-based considerations for <principle>" banner
  boxes, "Population-based actions" checklists, and Find out more boxes whose entries are
  `<Optional>` guidance (`structure`, resolved: banner-first boxes, guidance-only boxes,
  Find out more boxes with guidance rows). The address of the parent section is the slug
  cap of "Population-based considerations for the Principles for Optimal Cancer Care", cut
  at its last whole word within 64 characters
  (`principles-for-optimal-cancer-care/population-based-considerations-for-the-principles-for-optimal`);
  the printed heading is kept whole in `title` (`semantics`, accepted).
- **p.14 → Steps of the Optimal Care Pathway**: the schematic figure is replaced by the
  `pathwayMap` node (decision 63); the map is drawn from the document's steps at render.
- **p.16 → About this population group**: key table (Size and demographics …) with
  guidance in the value cells (`structure`, resolved as a real table with guidance).
- **Steps 1–7 (pp.17–66)**: per-step "Supportive care" sections (`<step>/supportive-care`)
  carry the considerations / checklist / communication boxes; timeframe rows (8) read as
  `timeframe` nodes with a `carePoint`. Numbering gap 4.7 → 4.10 is printed (4.8 and 4.9
  do not exist in this template) and kept as printed. Decision 45 asks for obvious printed
  errors to be normalised and recorded; this gap is left alone because the template's own
  cross-references use the printed numbers, and that exception is recorded here.
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

## Visual pass 2026-09-23, pp.15–91 (delegated page-by-page read; RESOLVED 2026-09-23)

Resolution, verified on the rendered review page and the editor (worker version
fe2ac61c): stopwatch boxes — a pen row followed by a stopwatch row is one developer box
wrapping the timeframe. Wholly purple check rows — a list whose every item is
instruction-coloured is an instruction list. Superscripts — the colour test ignores
superscript runs. A fill change inside one bordered table — the box's extent is the
stroked rectangle, not the shading. Shaded group header — sub-banner inside the
checklist. Continuation shell nesting — a nested list continues across the shell join.
Hard return — `hardBreak` inside the paragraph. Title cut at the placeholder — the title
runs through the highlight. Runs split mid-word — same-style adjacent runs merge.
Render — as the cancer ledger. The shared rules the cancer ledger lists were all fixed
as general Word rules and verified here on pp.72, 75–82.

The cancer ledger's pass lists the shared rules (page-break continuations, rule-as-
underline, resource-list refinements, "Step N:" colon, note variants, chip and paragraph
spacing); the same defects show here on pp.72, 75–82 and are not repeated. Specific to
this template:

- **Stopwatch boxes lose their pen wrapper** (`structure`, every one: 2.1, 2.2, 2.3, 3.1.1,
  3.5.1, 4.3.1 — pp.22–24, 29, 33, 41): the PDF draws one bordered developer box whose
  rows are the lavender pen row and the pink stopwatch row; the seed emits the guidance
  at top level and the `⏱` node as a second sibling, so the render shows a bare guidance
  slab and a detached timeframe card. The box detector stops at the stopwatch row.
- **Wholly purple check rows are not instructions** (`semantics`, p.24 2.3): "list
  information / test results to include in referrals…" and "list population-specific
  factors that would influence the requirement for urgent referral" are purple italic
  tick rows, emitted as plain black check items (p.31 and p.34 equivalents are genuinely
  black and correctly plain).
- **Superscripts defeat the instruction test** (`semantics`, p.74): "List members of
  working group involved in 1ˢᵗ edition if this is 2ⁿᵈ edition" is purple italic like
  its siblings but its superscript runs break the colour test; it is body italic.
- **A fill change inside one bordered table ends the box** (`structure`, p.72
  7/supportive-care): the sixth row (lavender) of the "Supportive care considerations at
  end-of-life" box is emitted as a separate callout; the identical final rows on pp.56
  and 65 (pale blue) stay inside.
- **Shaded group header splits the checklist** (`structure`, p.36 3/supportive-care):
  "For people diagnosed with advanced cancer" — as the cancer ledger's pp.31–32.
- **Continuation shell loses nesting** (`structure`, pp.46–47 4.6): of the seven nested
  bullets under "Two-way communication should cover:", only the first stays nested; the
  six on the next page are promoted to top-level items.
- **Hard return inside a cell** (`text`, p.27 2/supportive-care): as the cancer p.23.
- **Title cut at the placeholder** (`text`, p.38): "Guide to Best Cancer Care for
  [population group]" — title ends at "[", description begins "population group]".
- **Runs split mid-word** (`inline`, minor, p.29): "influenc" + "e " + "the" — adjacent
  runs with identical effective style are not merged.
- **Render**: section-level paragraphs without vertical gap (pp.15, 30, 46); placeholder
  chip spacing before punctuation (throughout).
- **Not defects** (source, normalise candidates): p.42 banner "Population-specific
  considerations for chemotherapy" on the Systemic therapy box; p.45 "specific to this
  cancer" in a population template; p.41 "treatment ."; p.43 mid-sentence
  "Immunotherapy"; p.45 complementary-therapies prose without its own heading (filed at
  the end of 4.5.4, correctly); p.56 "assessed" doubled; p.58 "on of"; p.64 See-also
  "Step 6: End-of-life care"; p.66 stray "Supportive care considerations" bullet; p.79
  Tele-Trial URL; p.70 upright guidance bullet (the print is right); p.74 two-column
  list. p.43 heading "personalised medicine" glossary underline: titles are plain by
  design.
- **Verified right**: 4.7 → 4.10 gap kept as printed; p.40 4.3.1 fully nested; the
  p.45 "3839" marker pair; every "Or" group, stopwatch row, key table pp.49–79;
  references 1–85; all find-out-more entries pp.83–85.

## Normalise (decision 45)

- None beyond the cancer template's list; the 4.7 → 4.10 gap is kept as printed.
