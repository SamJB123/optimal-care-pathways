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
- **p.6 Types of OCPs**: the two coloured tiles (green / purple) keep their text and bold
  titles but the table cells carry no background colour in the content schema.
- **Principles p.8 table / p.9 schematic**: figures are rendered as images; the schematic
  is an image.

## Normalise (decision 45) — every deliberate departure from the printed document

- p.3 Endorsement: "Optimal Care athway" → "Optimal Care Pathway".
- p.27 eviQ Referral Guidelines: the href is a local file path
  (`file:///C:/Users/…/eviq.org.au/cancer-genetics/referral-guidelines`); to be replaced
  with the public URL.
