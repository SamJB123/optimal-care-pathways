# Fidelity ledger — Attachment B, cancer-specific template (88 pages)

Ground truth: the rendered PDF pages (`../source/Attachment-B-…pdf`), read page by page.
Compared against: the current seed (`scripts/print-template.ts cancer-template`), i.e. what
the CMS holds and renders today, built from the sandbox's flattened canonical extraction.

Each finding: **page → section (address)**: what the page shows, what the seed holds, the
class. Classes: `text` (lost, duplicated or misplaced words), `structure` (tables, boxes,
columns, lists, figures, headings), `inline` (bold, italic, underline, links, superscripts,
placeholders, citations), `semantics` (meaning carried only visually: colour, icons,
running headers). Findings feed the extractor's acceptance tests; the "normalise" list at
the end records every deliberate departure from the printed document (decision 45).

Method note: bold, italic and figures are absent from EVERY page of the seed by
construction (the canonical never carried them); they are listed once per page only where
the loss changes meaning, and taken as read elsewhere.

## Pages 1–12: cover, instructions, preface, contents, About OCPs, Principles, Steps, About this OCP, About this cancer, Snapshot

- **p.1 → cover**: title placeholder `[insert cancer type]` and `X edition` yellow; the
  seed's `cover/x-edition` section holds "Development draft / Publication date / Endorsed
  by / Add endorsing organisation logo/s" as four bare paragraphs. The "Add endorsing
  organisation logo/s" is a boxed placeholder for an image (`structure`, minor). Icon strip
  is decorative.
- **p.2 → cover/instructions-for-developers/***: every bullet lead-in is bold ("**core
  content**", "**editable content**", "**Black text**", "**Green boxes**", "**Key
  considerations tables**", "**Checklists**", "**Supportive care and communication
  sections**", "**'Find out more' boxes**", "**Numbered headings and subheadings cannot be
  changed or reordered**", "**third-level subheadings … within sections**", "**can be
  removed where content is not relevant**"); all lost (`inline`). "Principles for Optimal
  Cancer Care" is underlined with a light-blue `<hyperlink to be added>` token after it —
  the token is seeded as plain text; it is a typed link-placeholder (`inline`,
  `semantics`). In "Types of content in this template" bullets 3–7 are BLACK body text
  containing green words ("Green boxes", "green text", "green prompts"); the seed wrapped
  those five bullets in a `guidance` node — misclassified by a colour heuristic
  (`structure`, wrong). The section is marked `owned` while its siblings are `shared`
  (`semantics`, ownership flag).
- **p.3 → cover/preface/***: the page has a green italic instruction "Include in final
  version", then three H3 subsections (Statement of acknowledgement: 3 paragraphs;
  Endorsement: 1 paragraph; Publication details: 4 paragraphs with yellow placeholders, an
  italic title "*Optimal Care Pathway for people with [cancer type]*", and one mailto
  link on the email only). The seed: `statement-of-acknowledgement` and `endorsement` are
  EMPTY; the entire page is one paragraph inside a `guidance` node under
  `publication-details`, every fragment wrapped in the mailto link, placeholders nested
  inside link text (`text` misplaced, `structure` lost, `inline` wrong — severe).
  Source typo "Optimal Care athway" (p.3, Endorsement) → normalise list.
- **pp.4–5 → contents**: seeded as ONE paragraph of the whole table of contents with dot
  leaders and page numbers run together ("…3About Optimal Care Pathways…6Intent…").
  Contents is a derived view of the section tree and must not be content at all
  (`structure`, apparatus).
- **p.6 → about-optimal-care-pathways**: the running header "CENTRALISED / CORE
  INFORMATION – FOR INFORMATION ONLY" marks pp.6–9 as core information (`semantics`, not
  in the seed). The opening statement is a BOLD paragraph in a shaded callout box → plain
  paragraph (`structure`, `inline`). The "National Optimal Care Pathways Framework" link is
  seeded as three adjacent link fragments (`inline`, cosmetic). **Intent**: a 7-row shaded
  TABLE, each row with a bold lead-in → seven bare paragraphs (`structure`, `inline`).
  **Types**: two side-by-side coloured boxes (green "Cancer-specific OCPs", purple
  "Population-based OCPs") with bold titles, then two shaded single-cell callouts with bold
  phrases ("**tailored pathway based on individual needs**", "**Principles for Optimal
  Cancer Care.**" bold+underlined + hyperlink token) → five bare paragraphs (`structure`,
  `inline`).
- **p.7 → about-optimal-care-pathways/using-…, /pathway-resources**: a three-column icon
  grid (Health professionals | Health service administrators… | People with cancer…) with
  bold captions → three bare paragraphs, icons lost (`structure`, `semantics`). Bold
  "**designed for use by all those involved in cancer care.**" lost. A three-column table
  of bold blue headings over descriptions (Optimal Care Pathways / Clinical practice
  guidelines / eviQ protocols) → paragraphs, and the first heading is MERGED into its
  description ("Optimal Care Pathways Nationally endorsed…") (`structure`, `text`). Bold
  closing sentence lost. **Pathway resources**: three cover IMAGES (Full OCP, Quick
  Reference Guide, Consumer Guide) absent entirely; bold captions and italic "Guide to best
  practice cancer care" lost; the shaded description row (3 cells) → paragraphs
  (`structure`: figures lost).
- **p.8 → principles-for-optimal-cancer-care**: the bold two-paragraph callout → plain.
  The eight principles are a TABLE: icon | bold name + underlined "<Link to Principle>" +
  hyperlink token | definition with a superscript citation. Seed: eight icons lost, table
  lost, bold/underline lost; citations `[^1]`–`[^8]` present ✓. The **Communication** row
  is wrapped whole in a link to pubmed.ncbi.nlm.nih.gov/39089769 — a reference URL leaked
  onto body text as a link mark (`inline`, wrong — severe).
- **p.9 → steps-of-the-optimal-care-pathway**: bold callout → plain. The full-page steps
  SCHEMATIC (figure with 7 numbered boxes, "Life after cancer", "SUPPORTIVE CARE",
  "Underpinned by the Principles…" bar, eight principle icons, italic caption "Optimal
  care is not always linear…") is ABSENT (`structure`: figure lost; caption `text` lost).
- **p.10 → about-this-optimal-care-pathway/scope, /other-ocps**: guidance boxes are
  seeded as `guidance` with the instruction lines ✓; the bold-italic green "**Complete the
  boxes**" / "**<Optional>**" and italic instruction text lost (`inline`). The whole
  Scope content sits inside ONE green-bordered developer box (the box is the unit of
  developer input; instruction text and editable prose share it); the seed keeps only the
  instruction lines as guidance and drops the box boundary (`semantics`, box grouping).
  Placeholders ✓.
- **p.11 → about-this-cancer/***: **Epidemiology** is a 2-column KEY TABLE (bold shaded
  label cells: Incidence, Prevalence, Mortality and 5-year survival, Burden of disease,
  Population variation, Trends | green italic bullet prompts) → seeded as label paragraph
  + `guidance` per row, table lost, bold/italic lost (`structure`, `inline`). The page
  FOOTNOTE ("¹ See priority populations listed in the Australian Cancer Plan <URL>") is
  spliced INTO the "Population variation" prompt text, with the citation atom emitted
  twice around it (`text` duplicated + misplaced — severe; footnotes are a separate
  apparatus). Biology / Diagnostic landscape boxes: guidance with bullets ✓, italic lost.
- **p.12 → snapshot-of-optimal-timeframes**: the "Notes on timeframes" shaded box with a
  bold title → bold lost, box lost. The SCHEMATIC TABLE (Pathway step | Care point |
  Timeframe; 7 step rows with merged cells; two ROTATED side labels) → flattened to ~55
  paragraphs; the three header cells became `banner` nodes (`structure` — severe). The
  green cells "As included in step 1/2/3/5" were parsed as "As included in step" + a
  CITATION to reference 1/2/3/5 — FALSE citations (`inline`, wrong — severe); "Modality"
  green cells → `guidance` (acceptable as developer prompt). Rotated labels became
  ordinary paragraphs in the wrong place (`structure`).

## Pages 13–24: Step 1, Step 1 Supportive care, Step 2, Step 2 Supportive care

Recurring patterns first (each recurs on nearly every page from here on):

- **Developer box = one bordered unit** (pencil icon, bold-italic green title, italic
  instruction, navy title band(s), green italic prompts, green shaded "Or" rows, white
  core alternatives). Seed: instruction lines → `guidance` ✓, navy bands → `banner` ✓,
  prompts → `guidance` bullets ✓, alternatives → paragraphs ✓; but the BOX boundary and
  the "Or" VARIANT GROUPS (mutually exclusive alternatives) are not modelled — "Or" is
  emitted as a bare line inside whichever guidance node preceded it, and on p.14 the
  three-way Or group is mis-grouped (`structure`, every box).
- **Key table** (bold shaded label cell | green prompt bullets; pp.15, 16 and every
  step): seeded as a label paragraph followed by a `guidance` node per row — the table
  is lost (`structure`, every occurrence).
- **Find out more box** (info icon, bold band, dotted-underlined resource links, green
  optional prompt): seeded as the band title CONCATENATED with the first link text
  ("Find out moreResources on risk reduction for cancer"), no link mark, further links
  concatenated ("…and supportResources for screening…" p.23), box lost (`text`,
  `structure`, `inline`; pp.14, 15, 16, 18, 21, 23–24 and onward).
- **See also box** (hand icon, band, rows of "Target (Principle|Pathway step)
  <hyperlink to be added>"): seeded as a bare "See also" line + paragraphs; the rows are
  typed cross-references (decision 15) and the hyperlink token is a link placeholder;
  neither is marked (`structure`, `inline`, `semantics`; pp.18, 21, 24 and onward).
- **Checklist rows with nested "–" items** (a prompt or a sub-action under a tick row):
  the nested item is CONCATENATED into the parent's text with a literal "–" (pp.17,
  18, 22, 23: "…include: – list supportive care…", "…at their own pace – do not
  contact family members…", "…including: – the name and role… – the reason… –
  expected timeframe…" six items in one line). Nested bullets under a tick row
  ("transport / out-of-pocket costs / leave from work / carer responsibilities", p.22)
  are emitted as top-level siblings (`structure`, nesting lost — every checklist).
- **Green inline prompts inside black rows** ("<for prostate cancer OCP only add: …>",
  "<Complete this section if …>" p.22) are developer instructions inline in core text;
  the seed either drops the distinction or turns the whole row into `guidance`
  (`semantics`).
- **Dotted-underlined glossary/link terms** in prose ("social, environmental, …
  determinants of health" p.13, "modifiable risk factors", "safety netting",
  "multidisciplinary team", "informed choice"): underline lost; where they are links the
  href is kept ✓ but often split into 2–3 adjacent link fragments (p.22 "Australian"
  "[ ]" "Cancer Nursing and Navigation Program") (`inline`).
- **Angle-bracket placeholders** "<cancer type>", "<insert timeframe>" (pp.14, 20) are
  yellow-highlighted like the square-bracket ones but are NOT marked `placeholder`; the
  signal is the highlight, not the bracket style (`inline`).
- **Supportive care pages carry a pale-blue page background** marking the
  pathway-spanning section (`semantics`, not represented). Speech-bubble / clipboard /
  hands icons on the navy bands are lost (`semantics`).

Page-specific:

- **p.13 → 1.1.1**: the page FOOTNOTE "b Not all risk factors are relevant for all
  cancer types" is spliced INTO the sentence: "Common b b Not all risk factors are
  relevant for all cancer types risk factors for cancer include:" — marker duplicated,
  footnote text mid-sentence (`text` — severe; same defect class as p.11).
- **p.19 → 2.1**: timeframe box with three "Or" alternatives → `timeframe` with three
  paragraphs ✓ (the one structure the seed gets right).
- **p.20 → 2.2**: "Use the statement below or provide different wording as required"
  (the instruction of the SECOND box) is appended to the FIRST box's guidance node
  (`structure`, minor). Shaded 7-row bullet table "Considerations when making a
  referral¹⁷" → bullets, band citation ✓ (`structure`: shading/table lost).
- **p.21 → 2.3**: the routine + urgent referral timeframes are ONE stopwatch box with
  two statements; seeded as TWO `timeframe` nodes with the same care point (`structure`).
  The green tick-row prompt "<Optional> list information / test results…" is a check
  item in the PDF, seeded as a `guidance` bullet (minor).
- **p.22 → 2/supportive-care**: the ACNNP check row is SCRAMBLED: its three nested dash
  items are emitted before the parent row (one of them inside a `guidance` node), then
  the parent row is emitted with all three concatenated again — text DUPLICATED, order
  and nesting wrong (`text`, `structure` — severe). "Provide clear instructions… within
  the expected timeframe ⏎ Document this instruction in the patient record": two
  paragraphs in one cell merged (`structure`, hard break lost).

## Pages 25–36: Step 3, Step 3 Supportive care, Step 4 (to 4.3.1)

New recurring patterns (in addition to those above):

- **Yellow-highlighted core options without brackets** ("immunohistochemistry / targeted
  next-generation sequencing panels / …" p.27; the seven core MDT members p.29; the
  treatment modalities p.36; college fellowships p.44): the highlight means "select or
  adapt", the same semantics as a bracketed placeholder, but the seed marks nothing
  because it detects placeholders by brackets (`inline`, `semantics` — every step).
- **Nested placeholders** "[Insert scale/s relevant to [cancer type] such as the …
  scale²⁵]" (p.28): only the inner one is marked; the outer highlighted span is lost, and
  the whole core sentence was filed inside the `guidance` node (`inline`, `structure`).
- **A box's instruction attached to the previous box** ("<Optional> Complete the
  timeframe / Delete if not relevant" pp.25, 29; "Use the statement below…" p.20): the
  seed appends a new box's green header to the guidance node of the box before it
  (`structure`, recurring).
- **Black rows with a trailing green prompt** ("For information about genetic risk…
  <Delete this point if Section 1.1.3 is deleted>" p.26 See also) become `guidance`
  wholesale (`semantics`, recurring).

Page-specific:

- **p.26 → 3.2**: dotted-underlined glossary terms (germline / somatic / pharmacogenetic
  testing, molecular tumour boards) lost (`inline`). Key actions nested dash items
  merged ("Consider costs of genetic testing – Medicare funds… – Other tests…").
- **p.27 → 3.2.1**: the "eviQ Referral Guidelines" link's href in the PDF is a LOCAL
  FILE PATH (`file:///C:/Users/Jenhe/Dropbox/…/eviq.org.au/cancer-genetics/referral-
  guidelines`) — a source defect the seed reproduces faithfully → normalise list.
- **p.28 → 3.2.3, 3.3, 3.4**: Find out more with two links concatenated ("Resources on
  genetic testingResources on cancer genomics").
- **pp.31–34 → 3/supportive-care**: the ACNNP scramble again (nested items emitted
  before the parent, one as `guidance`, then duplicated inside the parent line);
  "Document smoking or vaping status – Offer brief cessation… – Prescribe…" and the
  four fertility sub-items merged into single lines; the four nested bullets under
  "Provide a written treatment care plan that includes:" emitted as top-level siblings;
  the shaded GROUP HEADER rows inside checklists ("For people diagnosed with advanced
  cancer", "Communication about the multidisciplinary team / the diagnosis / the
  treatment plan") are plain paragraphs — they are sub-headings of the table
  (`structure`). Bold "**Guide to Best Cancer Care**" lost. Find out more: SIX resource
  links concatenated into one line, then two rows with bold blue lead-ins lost
  (`text`, `inline`).
- **p.36 → 4.3.1 (Treatment modalities)**: the NESTED LIST is flattened — "Radiation
  therapy – Add sub-categories if required", "Systemic therapy: – Chemotherapy – Targeted
  therapy – Hormonal therapy – Immunotherapy and precision medicine – Biological and
  cellular therapy", "Other – Nuclear medicine – … – Complementary therapies": every
  second-level item run into its parent line (`structure` — severe; this is the list
  that reads as "lost its formatting" on the deployed site). The green "Add
  sub-categories if required" is a prompt inside the list (`semantics`). Yellow
  highlights on every item lost (`inline`). Dotted-underlined "clinical trials",
  "Telehealth" lost.

## Resolved by the extractor (2026-09-22)

The findings above were made against the sandbox extraction. The fresh two-stage
extractor (`src/template/extract/`) is now the seed's source; re-checked against the
rendered pages, every class above is handled by a general rule rather than a per-page fix:

- **Structure**: boxes are tables with their shading and borders; `box` (kind from the
  icon; `plain` for a banner-headed box without one; `callout` for a shaded statement),
  `banner`, `variants` ("Or" rows), `timeframe` (stopwatch rows), key tables, check lists
  with nested "–" items, Find out more / See also rows, figures rendered to PNG. Tables
  broken over a page break arrive as two per-page shells and are re-joined by shape
  (pp.26–27, 81–82 and 28 others); a table Word butted against a box without a heading
  row of its own ("Or" + alternative p.36; second checklist tables) continues that box.
- **Text**: footnotes and endnotes are filed apart from the prose and referenced from
  their markers (p.11, p.13, References pp.83–88 numbered 1–89); the space after a marker
  is kept; a word hyphenated at the margin is rejoined ("sub-headings"); one space between
  words however the drawing split them.
- **Inline**: bold, italic, underline (incl. dotted), superscript by baseline, links with
  their hrefs (internal ones resolved to section addresses), highlights → `placeholder`
  including the bracketed token whole ("[xx]", "<cancer type>"), a highlight wrapped over
  a line break is one placeholder; the developer-instruction colour is learned from the
  pen boxes (`guidance` blocks, `instruction` mark inline); per-line paragraph shading is
  no longer mistaken for a highlight (p.12 Notes, p.36 pen box guidance).
- **Semantics**: icons name the box kind; ownership from the presence of developer input;
  the contents pages are apparatus; running headers/footers are excluded by the structure
  tree.
- **Alignment** (2026-09-23): a paragraph is aligned within its CONTAINER's frame, never
  its own extent — the drawn cell for table text (its shading rectangle, else the nearest
  rule or shading edge on either side, else the table's edge widened by the column pitch
  when Word divided it equally), a stroked text box, the list body past the marker, the
  page's text column otherwise. A single centred line had framed itself and always read
  as left (p.6 tile titles, p.7 "Health professionals", p.7 resource labels). Text within
  6.5pt of a cell edge (Word's 5.4pt padding) sits on it; a single line is right-aligned
  only when it lies in the frame's right half. The whitespace item pdf.js writes for the
  gap between two cells' text on one line joins the text but never the geometry — it had
  stretched the next cell's line back to the previous cell and mis-framed it.
- **Soft return under a title line**: a first line wholly in one emphasised style and
  colour followed by a line in another colour is a paragraph of its own (p.7 "Optimal
  Care Pathways" over its description, tagged as one P).
- **Figures on one line**: figures whose boxes overlap vertically become one `figureRow`
  (p.7 the two clinician icons over "Health professionals").

Still open (visual checks pp.6, 12, 26–27, 35–37, 49, 82 done; pp.38–48, 50–81, 83–88
compared by structure and scans only):

- **p.12 snapshot table** — SETTLED (decision 50): Word writes no RowSpan/ColSpan
  attributes, so the schematic's merged cells cannot be read from the tags. The template
  itself says the schematic is updated from the timeframe boxes, so the seed replaces the
  printed table with a `timeframeSnapshot` node the CMS renders from the document's
  timeframes (the notes callout and the developer guidance stay). The generated view is
  not built yet; the node renders as a marker.
- **p.37 timeframe care point** — SETTLED (decision 51): `carePoint` is the timeframe's
  first child node holding marked text, so "Timeframe for [treatment modality]" keeps its
  placeholder.
- **p.6 Types of OCPs, p.7 icon grids and resource tiles** — RESOLVED (decision 58): tiles
  are `columns` of callout boxes in their colour family (`box.family`), icon grids are
  `columns`; shaded table cells carry `tableCell.background` (a family, decision 60) and
  shaded group-header rows are `banner` tone 'sub'. The snapshot view (decision 50) and
  the pathway map (decision 63, replacing the p.9 schematic figure) are rendered from the
  document at render.
- **Find out more / See also entries** — RESOLVED (decision 64): `resource` nodes in a
  `resourceList`; a title leads with bold or linked text, plain paragraphs after it are
  the description (across a page break too); `<hyperlink …>` notes are dropped in favour
  of the url.
- **p.8 Communication row, p.40 4.4.4 "34,35,36"** — RESOLVED: Word tagged the endnote
  marker "7" OUTSIDE its Link (an empty Link precedes the paragraph; the digit is a 7pt run
  at its end), and set the three markers on p.40 as ONE raised run "34,35,36" with no
  Links at all. The extractor reads any raised run of small integers directly after prose
  as the endnote(s) it names — a list one reference per number, a range every number in
  it — so all 89 references are cited and the numbers derived at render agree with the
  printed ones (7.2.2 shows 89, as printed). The p.8 row's heading and text share one
  paragraph in the tags, so they render as one paragraph rather than two lines.
- **Principles p.8 table / p.9 schematic**: figures are rendered as images; the schematic
  is an image.

## Visual pass 2026-09-23, pp.13–88 (delegated page-by-page read; RESOLVED 2026-09-23)

Resolution, verified on the rendered review page and the editor (worker version
fe2ac61c): page-break continuations — on a re-joined table a marker-less continuation
row continues the previous row's last block (list item or paragraph), and a table Word
split into two same-shape shells keeps each cell's drawn geometry from the page that
held its text. Rule-as-underline — a fill extending past the line at both ends is a
rule. References — tagless endnote pages take links from URL annotations by geometry.
Resource lists — group-header rows are sub-banners inside resource lists; bold/linked
lead rows are resources; each table row starts an entry; a title runs through a
bold+highlight run; bare `<URL>` notes dropped, plain-text URL notes become the url;
punctuation-only descriptions dropped. "Step N:" — the number is stored bare ("Step 1")
and the renderer adds the colon (decision: renderer, once). Boxes — a pen row heading a
box of another kind wraps it (developer box); a shaded group header inside a checklist
is a sub-banner whatever its family. Instruction colour — wholly-instruction rows are
instruction whatever their siblings; a punctuation-only run inherits the previous run's
colour. Placeholders — adjacent highlighted runs coalesce ignoring style marks; a
citation inside a highlight stays inside it. Hard return inside a cell — a `hardBreak`
node inside the paragraph (decision: Word's soft return is a line break, a separate
paragraph is never merged). Inline typed cross-reference — the See-also placeholder
class. Render — a nested guidance is compact inside a list item; chips spread via
box-shadow so punctuation stays put; section paragraphs get 0.55em; one comma between
citations supplied by the renderer; the review page carries the body stylesheet
(prosekit's list sheet, the same one the editor uses). Minor items and "not defects"
stand as listed; the eviQ `file:///` drop is deliberate (normalise entry below).

Every page 13–88 read against the render. The step grammar holds page for page; the
defects are general Word rules, mostly at page breaks and in the Find out more apparatus.

- **Page-break continuations** (`structure`): the ACNNP funded-NGO check row runs over
  pp.70–71 and its continuation paragraph is emitted as a top-level bullet outside the
  checklist (pp.54–55 same row is one item); the marker-less continuation row
  "[insert cancer-specific symptoms]" (p.23) is the nested list of the p.22 check row
  "…including:" but lands as a sibling; the ECOG resource description (pp.74–75) becomes
  two paragraphs. Rule: on a re-joined table, a continuation row without a marker
  continues the previous row's last block (its list, its paragraph).
- **False underline from a table rule** (`inline`): the last line above a table's bottom
  rule is marked underline — at the page break (p.70 "the ACNNP …", p.74 ECOG) and under
  an inset nested row (p.76 "for use by Australian haematology teams."). A rule is not an
  underline: an underline sits within the text's own line box and spans its glyphs.
- **References lose their links** (`inline`, significant): refs 1–10, 13, 15–21 and
  85–89 (pp.84, 88 — the first and last endnote pages) carry no url although every one
  has a link annotation in the PDF; 22–84 keep theirs (52 correctly has none).
- **Resource lists** (`structure`/`semantics`, decision 64 refinements): shaded grey
  group-header rows ("Teletrials and decentralised trials", "Interpreters and clinical
  trials", "Research and clinical trials for Aboriginal and Torres Strait Islander
  peoples", "Guidelines and frameworks", "Reports", "Communication tools"; pp.77–79) are
  emitted as url-less resources — they are sub-banners (tone 'sub'), the rule is not
  reaching rows inside a resource list; bulleted rows whose lead is bold/linked ("NSW
  Regional Cancer Research Network", "Regional Trials Network Victoria", p.77) are
  resources, and their lead-in row ("Regional trial networks are available…") is a
  paragraph of its own, not the previous resource's description; a link-less title row
  ("Resources for practical and social support", p.24) is swallowed as the previous
  entry's description — each table row starts a new entry; a title is cut at its
  highlighted placeholder run ("Guide to Best Cancer Care for people with [cancer
  type]", p.34) — the title continues through a bold+highlight run; note variants: a
  bare `<url>` note without the word "hyperlink" (Australian Clinical Trials, p.77) is
  kept as visible text; a note whose URL is plain text with no link mark (eviQ
  Calculators p.75, McGrath Foundation p.80) is the entry's only address — take the url
  from the note instead of losing it; the title's sentence-ending "." survives as the
  whole description (Surgery p.75, Nuclear medicine p.76).
- **"Step N:" headings lose the colon** (`text`): Word's list definition `Step %1:` puts
  the separator in the auto-number; the extractor keeps the number and drops the ":".
- **Boxes** (`structure`): a green pen row heading a box of ANOTHER kind (Find out more
  p.35, Key actions p.40) is emitted as its own empty pen box above the real box — a pen
  row continues into the box it heads; the shaded group-header row "For people diagnosed
  with advanced cancer" inside the supportive-care checklist (pp.31–32) becomes a callout
  and splits the checklist into a second banner-less box — it is a sub-banner whatever
  its shade family (pp.17, 33, 46 same construct is right).
- **Instruction colour** (`semantics`): two green prompts ("add other physical
  considerations…" p.50; "list considerations for supportive care at end of life…" p.70)
  are instruction-marked bullets while their sibling rows are `guidance`; a lone
  punctuation run (the "." after the p.28 placeholder) is classified as instruction.
- **Placeholders** (`inline`): one highlight becomes several chips where Word split the
  run at underline boundaries ("liquid biopsy/circulating tumour DNA (ctDNA)." p.27 →
  four; "Immunotherapy and precision medicine" p.36 → three) — coalesce adjacent
  highlighted runs; a superscript citation inside a highlight (p.28 "[Insert scale/s …
  (ECOG) scale²⁵]") terminates the placeholder and leaves the "]" outside it.
- **Hard return inside a cell** (`text`, still live): "…within the expected timeframe ⏎
  Document this instruction in the patient record" (p.23) runs into one sentence.
- **Inline typed cross-reference** (`inline`): "…are listed in section 6.5.
  <hyperlink to be added>" in body prose (p.63) is plain text; it is the See-also
  link-placeholder class.
- **Minor**: heading-only sections (5.3, 6.3, 7.1, 7.2, find-out-more parents,
  references) carry one empty paragraph; bold runs keep their trailing space inside the
  mark ("**routine surveillance: **detected", p.56); "eviQ Referral Guidelines" (p.27) is
  a `file:///` link on the page and has underline only in the seed (normalise entry says
  it should become the public URL — confirm the drop is deliberate).
- **Render** (`render`): a one-line guidance nested in a list item ("Add sub-categories
  if required", p.36) renders as a full-width panel between list items; placeholder chips
  push the following punctuation away ("supportive care ."); two section-level paragraphs
  render with no gap (p.40); citation groups show a doubled comma.
- **Not defects** (source faults, normalise candidates): "metsastatic" (p.64), "vascular
  access devicesfor" (p.76), "clinicans" (p.77), "<Complete this section of the ACNNP
  includes a funded NGO…>" (pp.22, 31, 47, 55, 64, 70), Tele-Trial href duplicating the
  previous entry's (p.77), "Available at Accessed July 2026" (refs 39, 43), "Step 6: …
  Step 7: …" as one See-also paragraph (p.41), p.72 two-column college list (reading
  order preserved).
- **Verified right**: p.37 care points (decision 51); 34,35,36 and 40,41 marker runs;
  every "Or" group, stopwatch row, key table and nested check item pp.13–88; references
  1–89 numbered and textually faithful; the p.36 4.3.1 nested list.

## Normalise (decision 45) — every deliberate departure from the printed document

- p.3 Endorsement: "Optimal Care athway" → "Optimal Care Pathway".
- p.27 eviQ Referral Guidelines: the href is a local file path
  (`file:///C:/Users/…/eviq.org.au/cancer-genetics/referral-guidelines`); to be replaced
  with the public URL.
