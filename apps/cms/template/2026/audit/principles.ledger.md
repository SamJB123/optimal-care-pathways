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
- **p.5 → Priority populations**: a 5 × 2 table of linked population names; kept as a real
  table (`structure`, correct).
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

## Normalise (decision 45)

- None.
