# Fidelity ledger — Attachment A, Principles for Optimal Cancer Care (40 pages)

Ground truth: the rendered PDF pages (`../source/Attachment-A-…pdf`), read beside the
rendered sections on the review page (`/review/<principles document>`), light and dark
schemes. Compared against: the seed built by the two-stage extractor, printed with
`scripts/print-seed.ts principles`.

The Principles document has no developer input: no pen boxes, no "Or" rows, no
timeframes. Its grammar is prose, callouts, key-actions checklists, Find out more / See
also boxes, icon-and-text rows, and one layout diagram.

## Seed as of 2026-09-23

60 sections, 73 references; 84 boxes, 3 real tables, 102 check items, 68 citations,
1 footnote, 14 figures, 31 placeholders, 113 resource entries. Eight principle sections
carry their icon (`sections.icon`).

## Findings, page by page (visual checks pp.4, 5, 6, 13, 16, 17, 24, 28–29; the rest by
structure scans and the print)

- **p.4 → Principles for Optimal Cancer Care (diagram)**: Word draws the diagram as one
  table with merged, shaded cells. It reads as: a callout; a three-column band (two
  callouts "What the principle means" / "Key elements"; an icon list of the eight
  principles; "Considerations for delivery" / "Population-specific considerations*"
  callouts in their families); a two-column band (Find out more / See also callouts); a
  grey callout. The merges are read from the drawing (`inferSpans`: the largest
  same-coloured fill under a cell's text is its extent — Word paints paragraph shading
  per line OVER the cell fill, which had cut "Key elements" to two rows) and the table
  becomes `columns` per row band (`diagramColumns`) (`structure`, resolved).
- **pp.5, 7, 10, 13, 16, 20, 23, 26 → the eight principles**: each principle's heading is
  an icon cell beside a 20 pt heading in a table whose later rows hold the callout under
  it, and sometimes empty rows before it. The frame is the table's first LIVE row; the
  heading opens an H1 section (the same style as the document's H1) with the icon; the
  remaining rows are an ordinary table of that section (`structure`, `semantics`,
  resolved). Before this rule none of the eight opened a section.
- **p.5 → Priority populations**: a 5 × 2 grid of linked population names, each centred in
  a shaded cell; now rows of two callout tiles (`columns`) once the centring is read in the
  drawn cell (2026-09-23; it had been a plain table because single-line cells framed
  themselves and read as left) (`structure`, resolved). The same rule centres the p.4
  diagram labels, the p.21 People / Information / Tools table and the p.23 communication
  diagram's single-line entries as printed.
- **pp.16–17 → Domains of supportive care**: icon | text rows (five domains) as an icon
  list; the "Physical symptoms … Spiritual needs" boxes are icon+label lead cells spanning
  two rows with the item's list laid out in cells beneath — rows covered by the lead's
  row span continue the item (`structure`, resolved). The two-column bullet lists inside
  are one list per cell (the columns are not kept) (`structure`, minor).
- **p.24 → Formats and considerations for communication**: icon | label | text rows as
  an icon list with bold labels (`structure`, resolved).
- **Find out more boxes (pp.28–36)**: entries lead with a bold or linked title; plain
  paragraphs after it are the description, including across a page break; `<hyperlink …>`
  notes split over runs ("<hyperlink", " ", url, ">") are dropped and the url kept
  (`inline`, `text`, resolved). Tables with nothing left to show (the endnote lists moved
  to References) are dropped (`structure`, resolved).
- **Citations**: 68 cited of 73 references; numbering derived at render.

## Still open

- p.4 "Considerations for delivery" is a dark navy box with white text in the print; it
  renders as an outline callout in the secondary family (readable in both schemes, not the
  printed weight) (`semantics`, minor).
- p.4 the asterisk footnote lines ("*Developed by Population-based OCP developers") are
  purple in print; they render as body text (`inline`, minor).
- pp.17 and 24 two-column bullet lists render as one column.

## Visual pass 2026-09-23, pp.7–40 (delegated page-by-page read; RESOLVED 2026-09-23)

Resolution, verified on the rendered review page and the editor (worker version
fe2ac61c): citation markers — a raised run beginning a drawn line and a Link marker
are both read against the paragraph's body size (largest full-size run), a space before
a marker no longer lets two rules claim it; heading citations 52 and 72 live in the
section's `titleCitations` column (D1 `title_citations`, migration 20260922171325) and
render after the heading, counted in the derived numbering. References 1–43 — a tagless
reference page (Links empty, text in one marked content) takes its links from the URL
annotations by geometry. Cross rows — Wingdings U+F0FB/U+F0FD reach the check item as
`negated` and render ✗. Page-break continuations — a marker-less continuation row
continues the previous row's last block; the split `<hyperlink URL>` note is joined and
dropped from the visible text. Rule-as-underline — a fill wider than the line at both
ends is a rule, not an underline. ACNNP merged row — a table Word split into two
same-shape shells keeps each cell's drawn geometry from the page that held its text, so
the header spans both columns. Resource notes — a plain-text URL in a note is the
entry's url; bare `<URL>` notes are dropped. Render — one comma between citations,
supplied by the renderer; p.4 navy/purple tiles are `box.variant: 'solid'` painted by
ui-solid's family roles; purple asides are the `note` mark. Two-column bullet lists
keep reading order (not a defect). p.10–11 duplicate is a normalise candidate, left.

- **Citation markers** (`inline`, significant): p.11 "• use of AI⁴⁴˒⁴⁵˒⁴⁶˒⁴⁷˒⁴⁸" — Word
  set the five markers as one raised run with no Links that BEGINS a new drawn line; the
  seed leaves "44,45,46,47,48" as a plain line under the bullet, so every derived citation
  number after it is off (printed 49 renders 44, printed 63 renders 57). Same page,
  "Patient-reported experience measures (PREMs) 39" is matched twice (`[^39][^39]`): a
  space between text and marker lets both the Link and the raised-run rule claim it.
  H2 headings "Principles of multidisciplinary care⁵²" (p.13) and "Types of research
  relevant to cancer care⁷²" (p.26) drop their markers, leaving 52 and 72 uncited.
- **References 1–43 lose their links** (`inline`, pp.37–38): every title is a link in the
  PDF; 44–73 keep theirs. Numbering and text are right throughout.
- **Cross-marked rows render as ticks** (`semantics`, pp.25, 27): the "Do not …" rows
  carry a ☒ in print; the marker glyph must reach the check item.
- **Page-break continuations** (`structure`/`text`, pp.21–22): the Cancer Hub description
  is cut ("…impacted by any cancer. Services" | "include navigation…") into two rows; the
  `<hyperlink URL>` note split across pp.29–30 and p.33 leaves a spurious resource titled
  with the bare URL and described ">".
- **Rule read as underline** (`inline`, pp.21, 29, 33): last line above a page-bottom
  table border marked underline. "Informed consent" (p.26) underline ends one glyph
  short.
- **Full-width merged row without shading** (`structure`, pp.21–22 ACNNP): the first row
  spans both columns in print, rendered in the left column with an empty right one —
  merges are read from shading and rules only.
- **Resource notes**: McGrath (pp.31, 33) plain-text URL keeps the literal "hyperlink";
  bare `<URL>` notes (RACS p.34, Australian Clinical Trials p.35) kept as visible text;
  regional-network bullets (p.35) keep "hyperlink" and their lead-in row is folded into
  the Tele-Trial description — as the cancer ledger's resource-list rules.
- **Two-column bullet lists** (`structure`, low): p.20 is a third instance beside pp.17
  and 24.
- **Render**: citation groups show a doubled comma (p.11); link text swallows the
  preceding space in the print only.
- **Still open, confirmed real**: p.4 navy "Considerations for delivery" AND purple
  "Population-specific considerations*" are filled tiles with white text (two families);
  purple is meaning-bearing in three places on p.4 (the asterisk lines, "Including
  population-specific resources*").
- **Not a defect**: pp.10–11 "Individual OCPs contain details of specific training…"
  is printed twice in the PDF (normalise candidate).

## Normalise (decision 45)

- None.
