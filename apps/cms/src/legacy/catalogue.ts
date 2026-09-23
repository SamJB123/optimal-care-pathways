/**
 * The 33 legacy Optimal Care Pathways (decision 129): which PDF is which document, its
 * audience and its design family. Titles, editions and dates are READ from the PDFs
 * (cover and imprint pages) by the extractor; this file only names the files and what
 * cannot be read off them.
 *
 * Families (decision 140, from the 2026-09-23 probe): 'design-2021' is the Cancer
 * Council 2021–2025 design every cancer pathway shares (one heading ladder, mirrored
 * margins); 'design-2020' is the older January-2020 template (unknown primary, cervical,
 * sarcoma); 'population' is the 2021 design plus a decorative art layer.
 */

export type LegacyFamily = 'design-2021' | 'design-2020' | 'population'

export interface LegacyPathway {
	/** The PDF's basename: the legacy document's own key (the reader at /legacy/<slug>). */
	slug: string
	file: string
	/** The pathway's slug in this system — the document the import creates, without the
	 *  edition the file name carries ('breast-cancer'). */
	pathwaySlug: string
	audience: 'cancer' | 'population'
	family: LegacyFamily
	/** What the pathway is about, as the subject placeholder fills it. */
	subject: string
}

/** The file name less its edition or date suffix and the population files' prefix. */
const pathwaySlugOf = (slug: string): string =>
	slug
		.replace(/^optimal-care-pathway-for-/, '')
		.replace(/-(?:1st|2nd)-edition$/, '')
		.replace(/-january-2020$/, '')
		.replace(/-optimal-cancer-care-pathway$/, '')

const cancer = (slug: string, subject: string, family: LegacyFamily = 'design-2021'): LegacyPathway => ({
	slug,
	file: `${slug}.pdf`,
	pathwaySlug: pathwaySlugOf(slug),
	audience: 'cancer',
	family,
	subject,
})

const population = (slug: string, subject: string): LegacyPathway => ({
	slug,
	file: `${slug}.pdf`,
	pathwaySlug: pathwaySlugOf(slug),
	audience: 'population',
	family: 'population',
	subject,
})

export const LEGACY_PATHWAYS: readonly LegacyPathway[] = [
	cancer('acute-leukaemia-in-children-adolescents-young-adults-1st-edition', 'acute leukaemia in children, adolescents and young adults'),
	cancer('acute-lymphoblastic-leukaemia', 'acute lymphoblastic leukaemia'),
	cancer('acute-myeloid-leukaemia-2nd-edition', 'acute myeloid leukaemia'),
	cancer('al-amyloidosis', 'AL amyloidosis'),
	cancer('breast-cancer-2nd-edition', 'breast cancer'),
	cancer('cancer-of-unknown-primary-january-2020', 'cancer of unknown primary', 'design-2020'),
	cancer('cervical-cancer-optimal-cancer-care-pathway', 'cervical cancer', 'design-2020'),
	cancer('chronic-lymphocytic-leukaemia-1st-edition', 'chronic lymphocytic leukaemia'),
	cancer('chronic-myeloid-leukaemia-1st-edition', 'chronic myeloid leukaemia'),
	cancer('colorectal-cancer-2nd-edition', 'colorectal cancer'),
	cancer('cutaneous-t-cell-lymphoma', 'cutaneous T-cell lymphoma'),
	cancer('endometrial-cancer-2nd-edition', 'endometrial cancer'),
	cancer('head-and-neck-cancer-2nd-edition', 'head and neck cancer'),
	cancer('hepatocellular-carcinoma-2nd-edition', 'hepatocellular carcinoma'),
	cancer('high-grade-glioma-2nd-edition', 'high-grade glioma'),
	cancer('hodgkin-and-diffuse-large-b-cell-lymphoma-2nd-edition', 'Hodgkin and diffuse large B-cell lymphoma'),
	cancer('keratinocyte-cancer-basal-cell-carcinoma-or-squamous-cell-carcinoma-2nd-edition', 'keratinocyte cancer'),
	cancer('low-grade-lymphomas-1st-edition', 'low-grade lymphomas'),
	cancer('lung-cancer-2nd-edition', 'lung cancer'),
	cancer('melanoma-2nd-edition', 'melanoma'),
	cancer('multiple-myeloma-1st-edition', 'multiple myeloma'),
	cancer('myelodysplastic-syndrome-1st-edition', 'myelodysplastic syndrome'),
	cancer('myeloproliferative-neoplasms', 'myeloproliferative neoplasms'),
	cancer('neuroendocrine-tumours-1st-edition', 'neuroendocrine tumours'),
	cancer('oesophagogastric-cancer-2nd-edition', 'oesophagogastric cancer'),
	cancer('ovarian-cancer-2nd-edition', 'ovarian cancer'),
	cancer('pancreatic-cancer-2nd-edition', 'pancreatic cancer'),
	cancer('prostate-cancer-2nd-edition', 'prostate cancer'),
	cancer('sarcoma-bone-soft-tissue-tumours-january-2020', 'sarcoma (bone and soft tissue tumours)', 'design-2020'),
	cancer('waldenstroms-macroglobulinaemia', 'Waldenström’s macroglobulinaemia'),
	population('optimal-care-pathway-for-aboriginal-and-torres-strait-islander-people-with-cancer', 'Aboriginal and Torres Strait Islander people with cancer'),
	population('optimal-care-pathway-for-adolescents-and-young-adults-with-cancer', 'adolescents and young adults with cancer'),
	population('optimal-care-pathway-for-older-people-with-cancer', 'older people with cancer'),
]

export const legacyBySlug = (slug: string): LegacyPathway | undefined =>
	LEGACY_PATHWAYS.find((p) => p.slug === slug)

/** Where a legacy figure PNG is served from. */
export const legacyFigureUrl = (slug: string, page: number, index: number): string =>
	`/legacy-figures/${slug}/p${page}-${index}.png`
