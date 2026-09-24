/**
 * Where each legacy section the 2026 template has no numbered place for goes.
 *
 * The template's rule (Attachment B and C, p.2 "What you can and cannot change"):
 * numbered headings and subheadings cannot be changed or reordered; a pathway may add
 * non-numbered subheadings within a section. So a legacy section that matches no template
 * section never keeps its printed number, and never sits beside the numbered subsections
 * as though it were one. It goes to one of two places, decided here, row by row:
 *
 *   into  — the text belongs to a template section under a different old name (the old
 *           "5.1 Transition to shared care" IS the template's 5.1). It is placed in that
 *           section under its old heading, as a matched section's text is; for a shared
 *           section that means version 1's divergence (decision 153).
 *   under — a topic the template has no section for. It becomes an unnumbered subsection
 *           beneath the template section it belongs in, with a margin note saying where the
 *           previous edition printed it.
 *
 * The legacy corpus is fixed, so this table is the complete record: an unplaced section
 * with no row here fails the import by name (see `requirePlacement`). `printed` is the
 * number as the previous edition printed it, kept for identification only — it is never
 * written to the section. `why` says why that home, and why into rather than under (or the
 * reverse), for the reviewer of the draft.
 */

export type PlacementKind = 'into' | 'under'

export interface LegacyPlacement {
	/** The pathway's slug in this system (`LegacyPathway.pathwaySlug`). */
	pathway: string
	/** The heading's number as the previous edition printed it; null where it had none. */
	printed: string | null
	/** The heading without its number, as the reader gives it. */
	title: string
	kind: PlacementKind
	/** The template section's address ('3.3', '4/supportive-care'). */
	home: string
	why: string
}

const STEP_SUPPORTIVE_CARE = (step: number) => `${step}/supportive-care`

export const LEGACY_PLACEMENTS: LegacyPlacement[] = [
	// ---- Aboriginal and Torres Strait Islander people with cancer (population) ----------
	{
		pathway: 'aboriginal-and-torres-strait-islander-people-with-cancer',
		printed: '2.4',
		title: 'Support and communication',
		kind: 'into',
		home: STEP_SUPPORTIVE_CARE(2),
		why: 'The same topic as the step’s Supportive care section (needs identified at diagnosis, culturally tailored access), so its text belongs in that section rather than as a subsection beside it.',
	},
	{
		pathway: 'aboriginal-and-torres-strait-islander-people-with-cancer',
		printed: '4.4',
		title: 'Pain management',
		kind: 'under',
		home: STEP_SUPPORTIVE_CARE(4),
		why: 'Cultural perspectives on reporting pain during treatment: supportive care, but a topic of its own the template’s section does not cover, so a subsection of it.',
	},
	{
		pathway: 'aboriginal-and-torres-strait-islander-people-with-cancer',
		printed: '4.7',
		title: 'Place of care',
		kind: 'under',
		home: '4.10',
		why: 'Outreach, ACCHS-based and telehealth care for regional and remote people is a health service characteristic for this population (the template’s 4.10); the template has no place-of-care section, so a subsection there.',
	},
	{
		pathway: 'aboriginal-and-torres-strait-islander-people-with-cancer',
		printed: '4.8',
		title: 'Traditional healing',
		kind: 'under',
		home: '4.5',
		why: 'A treatment option outside the numbered modalities (the cancer template lists complementary therapies under 4.5; the population template has no such subsection), so a subsection of Other treatment options.',
	},
	{
		pathway: 'aboriginal-and-torres-strait-islander-people-with-cancer',
		printed: '6.4',
		title: 'Pain management',
		kind: 'under',
		home: STEP_SUPPORTIVE_CARE(6),
		why: 'Cultural perspectives on reporting pain with advanced disease: supportive care, but a topic of its own the template’s section does not cover, so a subsection of it.',
	},

	// ---- Acute leukaemia in children, adolescents and young adults ---------------------
	{
		pathway: 'acute-leukaemia-in-children-adolescents-young-adults',
		printed: '3.2',
		title: 'Staging, prognostic assessment and risk stratification',
		kind: 'into',
		home: '3.3',
		why: 'Risk stratification is this disease’s staging (the text says so: staging is not relevant beyond CNS and testicular disease; prognostic assessment takes its place), so it is the pathway’s text for the template’s Staging.',
	},
	{
		pathway: 'acute-leukaemia-in-children-adolescents-young-adults',
		printed: null,
		title: 'Standard pathway',
		kind: 'under',
		home: '3.1',
		why: 'How quickly the diagnostic work-up happens for a stable patient: specific to this disease and not in the shared work-up text, so a subsection of Specialist diagnostic work-up.',
	},
	{
		pathway: 'acute-leukaemia-in-children-adolescents-young-adults',
		printed: null,
		title: 'Urgent pathway',
		kind: 'under',
		home: '3.1',
		why: 'The emergency work-up (hyperleucocytosis, tumour lysis, sepsis): the pair of the Standard pathway, beside it under Specialist diagnostic work-up.',
	},

	// ---- Acute lymphoblastic leukaemia ------------------------------------------------
	{
		pathway: 'acute-lymphoblastic-leukaemia',
		printed: '2.3',
		title: 'Referral for emergency assessment',
		kind: 'into',
		home: '2.3',
		why: 'The general practitioner’s referral to a specialist: the template’s Initial referral under an older name.',
	},
	{
		pathway: 'acute-lymphoblastic-leukaemia',
		printed: '3.2',
		title: 'Prognostic assessment and risk stratification',
		kind: 'into',
		home: '3.3',
		why: 'Classification and risk stratification are this disease’s staging, so the pathway’s text for the template’s Staging.',
	},
	{
		pathway: 'acute-lymphoblastic-leukaemia',
		printed: '5.1',
		title: 'Transition to shared care models of treatment',
		kind: 'into',
		home: '5.1',
		why: 'The transition from active treatment to shared follow-up care: the template’s Transitioning to post-treatment care under an older name.',
	},

	// ---- Acute myeloid leukaemia ------------------------------------------------------
	{
		pathway: 'acute-myeloid-leukaemia',
		printed: '3.2',
		title: 'Other pre-treatment investigations',
		kind: 'into',
		home: '3.1.2',
		why: 'Organ function and fitness investigations beyond the diagnostic minimum: the template’s Additional tests.',
	},

	// ---- Adolescents and young adults with cancer (population) ------------------------
	{
		pathway: 'adolescents-and-young-adults-with-cancer',
		printed: '4.4',
		title: 'Place of care',
		kind: 'under',
		home: '4.10',
		why: 'Care directed by a specialist AYA centre is a health service characteristic for this population (the template’s 4.10); no place-of-care section exists, so a subsection there.',
	},
	{
		pathway: 'adolescents-and-young-adults-with-cancer',
		printed: '6.1',
		title: 'Signs and symptoms',
		kind: 'into',
		home: '6.1',
		why: 'How recurrence presents: the template’s Detecting residual, recurrent or metastatic disease.',
	},

	// ---- AL amyloidosis ---------------------------------------------------------------
	{
		pathway: 'al-amyloidosis',
		printed: '5.1',
		title: 'Transition from initial treatment from AL amyloidosis',
		kind: 'into',
		home: '5.1',
		why: 'The transition to shared follow-up care: the template’s Transitioning to post-treatment care under an older name.',
	},

	// ---- Breast cancer ----------------------------------------------------------------
	{
		pathway: 'breast-cancer',
		printed: '1.4',
		title: 'Risk assessment tools',
		kind: 'under',
		home: '1.1.1',
		why: 'Validated tools for assessing personal risk: a topic of its own that follows from the risk factors, so a subsection of Risk factors.',
	},

	// ---- Cancer of unknown primary ----------------------------------------------------
	{
		pathway: 'cancer-of-unknown-primary',
		printed: '5.3.3',
		title: 'Palliative care',
		kind: 'under',
		home: STEP_SUPPORTIVE_CARE(5),
		why: 'The template has palliative care in Step 4 (a treatment option) and Step 6, not in Step 5; the print’s Step 5 palliative care is supportive care after initial treatment, so a subsection there.',
	},

	// ---- Cervical cancer --------------------------------------------------------------
	{
		pathway: 'cervical-cancer',
		printed: '1.1.1',
		title: 'Immunisation',
		kind: 'under',
		home: '1.1.2',
		why: 'HPV vaccination is a risk reduction strategy, and a topic of its own, so a subsection of Risk reduction strategies.',
	},
	{
		pathway: 'cervical-cancer',
		printed: '1.4',
		title: 'Special considerations',
		kind: 'under',
		home: '1.2.1',
		why: 'Under-screening of women with disabilities and survivors of sexual abuse: a consideration for population-based screening, so a subsection of it.',
	},
	{
		pathway: 'cervical-cancer',
		printed: '2.2',
		title: 'Referral to a specialist',
		kind: 'into',
		home: '2.3',
		why: 'Referral to a gynaecological oncologist: the template’s Initial referral under an older name.',
	},
	{
		pathway: 'cervical-cancer',
		printed: '3.5',
		title: 'Special considerations',
		kind: 'under',
		home: '3.5',
		why: 'Fertility, early menopause and sexual function to be addressed when planning treatment: a subsection of Treatment planning.',
	},
	{
		pathway: 'cervical-cancer',
		printed: '4.3',
		title: 'Special considerations',
		kind: 'under',
		home: '4.4',
		why: 'Fertility-sparing surgery and ovarian preservation before radiotherapy span the treatment modalities, so a subsection of Treatment options rather than of one modality.',
	},
	{
		pathway: 'cervical-cancer',
		printed: '5.4',
		title: 'Special considerations',
		kind: 'under',
		home: '5.2',
		why: 'Treatment-related menopause and pregnancy after fertility-sparing treatment: long-term health after treatment, so a subsection of Supporting long-term health and wellbeing.',
	},
	{
		pathway: 'cervical-cancer',
		printed: '5.5.3',
		title: 'Palliative care',
		kind: 'under',
		home: STEP_SUPPORTIVE_CARE(5),
		why: 'The template has palliative care in Step 4 (a treatment option) and Step 6, not in Step 5; the print’s Step 5 palliative care is supportive care after initial treatment, so a subsection there.',
	},

	// ---- Chronic myeloid leukaemia ----------------------------------------------------
	{
		pathway: 'chronic-myeloid-leukaemia',
		printed: '3.2',
		title: 'Phases of disease and prognostic assessment',
		kind: 'into',
		home: '3.3',
		why: 'The phase of CML (chronic, accelerated, blast) is this disease’s staging.',
	},
	{
		pathway: 'chronic-myeloid-leukaemia',
		printed: '5.1',
		title: 'Managing patients taking TKI therapy',
		kind: 'under',
		home: '5.3.2',
		why: 'The monitoring schedule for ongoing TKI therapy is this disease’s follow-up care plan; a topic of its own, so a subsection of Follow-up care plan.',
	},
	{
		pathway: 'chronic-myeloid-leukaemia',
		printed: '6.2',
		title: 'Managing patients not responding optimally',
		kind: 'into',
		home: '6.2',
		why: 'Bone marrow examination and mutational analysis on treatment failure: the template’s Investigating residual, recurrent or metastatic disease.',
	},

	// ---- Endometrial cancer -----------------------------------------------------------
	{
		pathway: 'endometrial-cancer',
		printed: '4.2',
		title: 'Screening for Lynch syndrome',
		kind: 'into',
		home: '3.2.1',
		why: 'Immunohistochemistry and referral for germline testing: the template’s Germline testing (inherited risk). The print had it in Step 4; the template puts genetic testing in Step 3.',
	},
	{
		pathway: 'endometrial-cancer',
		printed: '5.3',
		title: 'Special considerations',
		kind: 'under',
		home: '5.2',
		why: 'Loss of hormonal function after treatment: long-term health after treatment, so a subsection of Supporting long-term health and wellbeing.',
	},

	// ---- High-grade glioma ------------------------------------------------------------
	{
		pathway: 'high-grade-glioma',
		printed: '3.2',
		title: 'Grading',
		kind: 'into',
		home: '3.3',
		why: 'Grading is this disease’s staging (its molecular markers included), so the pathway’s text for the template’s Staging.',
	},

	// ---- Hodgkin and diffuse large B-cell lymphoma ------------------------------------
	{
		pathway: 'hodgkin-and-diffuse-large-b-cell-lymphoma',
		printed: '4.5.2',
		title: 'Optimising physical activity and rehabilitation',
		kind: 'under',
		home: '4.2',
		why: 'Rehabilitation and physical activity through treatment: the template’s 4.2 is prehabilitation and optimising treatment; this widens it, so a subsection there.',
	},

	// ---- Keratinocyte cancer ----------------------------------------------------------
	{
		pathway: 'keratinocyte-cancer',
		printed: '4.2.5',
		title: 'Emerging therapies',
		kind: 'under',
		home: '4.4.3',
		why: 'Immune checkpoint and EGFR inhibitors are systemic therapies; a topic of its own beyond the shared text, so a subsection of Systemic therapy.',
	},

	// ---- Multiple myeloma -------------------------------------------------------------
	{
		pathway: 'multiple-myeloma',
		printed: '5.1',
		title: 'Transitioning from initial treatment of active MM',
		kind: 'into',
		home: '5.1',
		why: 'The transition to shared follow-up care: the template’s Transitioning to post-treatment care under an older name.',
	},

	// ---- Myelodysplastic syndrome -----------------------------------------------------
	{
		pathway: 'myelodysplastic-syndrome',
		printed: '3.2',
		title: 'Prognostic assessment',
		kind: 'into',
		home: '3.3',
		why: 'The text says it: prognostic assessment rather than staging, so the pathway’s text for the template’s Staging.',
	},

	// ---- Myeloproliferative neoplasms -------------------------------------------------
	{
		pathway: 'myeloproliferative-neoplasms',
		printed: '3.2',
		title: 'Prognostic assessment and risk stratification',
		kind: 'into',
		home: '3.3',
		why: 'Risk stratification by MPN subtype is this disease’s staging.',
	},
	{
		pathway: 'myeloproliferative-neoplasms',
		printed: '5.1',
		title: 'Transition to shared care models of treatment',
		kind: 'into',
		home: '5.1',
		why: 'The transition to shared follow-up care: the template’s Transitioning to post-treatment care under an older name.',
	},

	// ---- Neuroendocrine tumours -------------------------------------------------------
	{
		pathway: 'neuroendocrine-tumours',
		printed: '1.3',
		title: 'Surveillance for patients with hereditary NETs',
		kind: 'into',
		home: '1.2.2',
		why: 'Annual surveillance of people with MEN and other hereditary syndromes: the template’s Surveillance recommendations.',
	},
	{
		pathway: 'neuroendocrine-tumours',
		printed: null,
		title: 'Carcinoid syndrome',
		kind: 'under',
		home: '6.4',
		why: 'The print grouped the carcinoid conditions as "Associated conditions" of metastatic disease; the template has no such section. They are recognised and treated as part of treating metastatic disease, so subsections of 6.4.',
	},
	{
		pathway: 'neuroendocrine-tumours',
		printed: null,
		title: 'Carcinoid crisis',
		kind: 'under',
		home: '6.4',
		why: 'A complication of metastatic NETs the print filed under "Associated conditions", which the template lacks; recognised and prevented as part of treating metastatic disease, so a subsection of 6.4 beside Carcinoid syndrome.',
	},
	{
		pathway: 'neuroendocrine-tumours',
		printed: null,
		title: 'Carcinoid heart disease',
		kind: 'under',
		home: '6.4',
		why: 'A complication of metastatic NETs the print filed under "Associated conditions", which the template lacks; treated (SSAs, valve surgery) as part of treating metastatic disease, so a subsection of 6.4 beside Carcinoid syndrome.',
	},

	// ---- Older people with cancer (population) ----------------------------------------
	{
		pathway: 'older-people-with-cancer',
		printed: null,
		title: 'Personalised treatment plans',
		kind: 'under',
		home: '4.1',
		why: 'Fitness, frailty and treatment tolerance shaping the treatment decision: a subsection of Treatment decision making.',
	},
	{
		pathway: 'older-people-with-cancer',
		printed: null,
		title: 'Cognition',
		kind: 'under',
		home: '4.2',
		why: 'A geriatric assessment domain (the print’s "Optimising health, functioning and supports for older people"): screening cognition before treatment is optimising the person for treatment, the template’s 4.2, so a subsection there.',
	},
	{
		pathway: 'older-people-with-cancer',
		printed: null,
		title: 'Comorbid chronic disease',
		kind: 'under',
		home: '4.2',
		why: 'A geriatric assessment domain (the print’s "Optimising health, functioning and supports for older people"): managing comorbidities before and through treatment is optimising the person for treatment, the template’s 4.2, so a subsection there.',
	},
	{
		pathway: 'older-people-with-cancer',
		printed: null,
		title: 'Medication usage',
		kind: 'under',
		home: '4.2',
		why: 'A geriatric assessment domain (the print’s "Optimising health, functioning and supports for older people"): reviewing polypharmacy before treatment is optimising the person for treatment, the template’s 4.2, so a subsection there.',
	},
	{
		pathway: 'older-people-with-cancer',
		printed: null,
		title: 'Mental health',
		kind: 'under',
		home: '4.2',
		why: 'A geriatric assessment domain (the print’s "Optimising health, functioning and supports for older people"): screening and treating distress and depression alongside cancer treatment is optimising the person for treatment, the template’s 4.2, so a subsection there.',
	},
	{
		pathway: 'older-people-with-cancer',
		printed: null,
		title: 'Nutrition',
		kind: 'under',
		home: '4.2',
		why: 'A geriatric assessment domain (the print’s "Optimising health, functioning and supports for older people"): dietitian referral for malnutrition before and through treatment is optimising the person for treatment, the template’s 4.2, so a subsection there.',
	},
	{
		pathway: 'older-people-with-cancer',
		printed: null,
		title: 'Physical function',
		kind: 'under',
		home: '4.2',
		why: 'A geriatric assessment domain (the print’s "Optimising health, functioning and supports for older people"): assessing mobility and daily function before treatment is optimising the person for treatment, the template’s 4.2, so a subsection there.',
	},
	{
		pathway: 'older-people-with-cancer',
		printed: null,
		title: 'Sensory function',
		kind: 'under',
		home: '4.2',
		why: 'A geriatric assessment domain (the print’s "Optimising health, functioning and supports for older people"): recognising hearing and visual impairment so treatment and its communication work is optimising the person for treatment, the template’s 4.2, so a subsection there.',
	},
	{
		pathway: 'older-people-with-cancer',
		printed: null,
		title: 'Social support',
		kind: 'under',
		home: '4.2',
		why: 'A geriatric assessment domain (the print’s "Optimising health, functioning and supports for older people"): assessing social support before prescribing treatment is optimising the person for treatment, the template’s 4.2, so a subsection there.',
	},
	{
		pathway: 'older-people-with-cancer',
		printed: '4.6',
		title: 'Geriatric medicine and aged care',
		kind: 'under',
		home: '4.10',
		why: 'Referral to geriatric medicine and aged care services is a health service characteristic for this population (the template’s 4.10), and a topic of its own, so a subsection there.',
	},
	{
		pathway: 'older-people-with-cancer',
		printed: '5.4.4',
		title: 'Carer needs',
		kind: 'under',
		home: STEP_SUPPORTIVE_CARE(5),
		why: 'The needs of carers, who are often older themselves: supportive care after treatment, a topic of its own, so a subsection there.',
	},
	{
		pathway: 'older-people-with-cancer',
		printed: '6.9',
		title: 'Geriatric medicine and aged care',
		kind: 'under',
		home: '6.5',
		why: 'Geriatric and aged care services for people with advanced disease: a subsection of Supporting health and wellbeing for people with advanced disease.',
	},

	// ---- Sarcoma (bone and soft tissue tumours) ---------------------------------------
	{
		pathway: 'sarcoma-bone-soft-tissue-tumours',
		printed: '5.4.3',
		title: 'Palliative care',
		kind: 'under',
		home: STEP_SUPPORTIVE_CARE(5),
		why: 'The template has palliative care in Step 4 (a treatment option) and Step 6, not in Step 5; the print’s Step 5 palliative care is supportive care after initial treatment, so a subsection there.',
	},

	// ---- Waldenström's macroglobulinaemia ---------------------------------------------
	{
		pathway: 'waldenstroms-macroglobulinaemia',
		printed: '3.2',
		title: 'Staging, prognostic assessment and risk stratification',
		kind: 'into',
		home: '3.3',
		why: 'The stages of WM and their prognostic scoring: the pathway’s text for the template’s Staging.',
	},
	{
		pathway: 'waldenstroms-macroglobulinaemia',
		printed: '5.1',
		title: 'Transition from active treatment',
		kind: 'into',
		home: '5.1',
		why: 'The transition to shared follow-up care: the template’s Transitioning to post-treatment care under an older name.',
	},
]

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** The row for a legacy section, by pathway, printed number and title. */
export function placementFor(
	pathway: string,
	printed: string | null,
	title: string,
): LegacyPlacement | undefined {
	return LEGACY_PLACEMENTS.find(
		(p) => p.pathway === pathway && p.printed === printed && norm(p.title) === norm(title),
	)
}

/** The row for a legacy section, or the error that names what is missing: the legacy
 *  corpus is fixed, so an unplaced section without a row is a gap in this table, never
 *  something to land somewhere by default. */
export function requirePlacement(
	pathway: string,
	printed: string | null,
	title: string,
	step: number,
): LegacyPlacement {
	const found = placementFor(pathway, printed, title)
	if (found) return found
	throw new Error(
		`no placement for the legacy section "${printed ? `${printed} ` : ''}${title}" of ${pathway} (Step ${step}): the template has no section for it; add a row to src/legacy/placements.ts`,
	)
}
