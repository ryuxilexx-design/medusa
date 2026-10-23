# Dori ro‘yxati va allergiya tekshiruvi

Status: **boshlang‘ich ro‘yxat, klinik tekshiruv talab etiladi (clinical review required).**
Researched 2026-10-23. Migration `028_drugs.sql`, starter list `database/seed/drugs.csv`, check `apps/api/src/modules/allergy-check.ts`.

## Why

Audit 2026-10-22: the «Dori tavsiyasi» (prescription) document was free text with no allergy check. Now the doctor picks
a drug from a reference list (free text still works), the server checks every item against the patient's allergies
(including partly cross-reactive classes) and blocks a hit on a **severe** allergy unless the doctor writes a reason.

## Source research (Oct 2026)

| Source | Open data? | Licence | Usable here? |
|---|---|---|---|
| **Uzbekistan State Register of Medicines** (Davlat dori vositalari reyestri). Resolution No. 738 of 24.11.2025 gives it to the Pharmaceutical Products Safety Center, and it is published on the Ministry of Health / Center websites. See [anhor.uz](https://anhor.uz/news/registration-of-medicines-approved/) and [gov.uz/uzpharmagency](https://gov.uz/en/uzpharmagency/sections/katalog). | We found no downloadable dataset. The gov.uz «Ochiq ma’lumotlar» section of the agency shows no register file. The register can be searched online (pharm-reg.uz / uzpharm-control.uz per [norma.uz](https://www.norma.uz/uz/nashi_obzori/informaciya_o_falsificirovannyh_lekarstvennyh_sredstvah_dostupna_grajdanam_respubliki)). | No reuse licence is stated. | **Not as a bulk source.** Scraping is not allowed without permission. A clinic or Med.uz.ai can ask the Center for an export, then load it with `db:import-drugs`. |
| **WHO Model List of Essential Medicines** (23rd list 2023, 24th 2025): [WHO page](https://www.who.int/publications/i/item/WHO-MHP-HPS-EML-2023.02). | PDF / eEML website. | **CC BY-NC-SA 3.0 IGO**: no commercial use, and adaptations must use the same licence. | **No.** Med.uz.ai is a commercial product, so we do not copy the list. We use it only as a reference for which medicines are common. |
| **ATC/DDD Index**, WHO Collaborating Centre, Oslo: [atcddd.fhi.no](https://atcddd.fhi.no/atc_ddd_index_and_guidelines). | Searchable for free; the full file is sold. | [Copyright notice](https://atcddd.fhi.no/copyright_disclaimer/): «Copying and distribution for commercial purposes is not allowed». Use must be credited and the material must not be changed. | **Partly.** Single 7-character ATC codes are cited as identifiers, written from general knowledge. The index (structure, names, DDDs) is **not** copied. Before a commercial production rollout, get the Centre's written permission, or ship with an empty `atc` column (the importer accepts it). |
| **RxNorm** (US NLM): [terms](https://www.nlm.nih.gov/research/umls/rxnorm/docs/termsofservice.html). | NLM-created content (RXCUI, normalized names) is public domain, and the «Current Prescribable Content» subset needs no UMLS licence. | Public domain for SAB=RXNORM, acknowledgement requested. | **Not useful.** It describes US products, brands and strengths, not the Uzbek market. It could later serve as an INN ↔ RxCUI cross-reference. |
| **INN names themselves** (WHO International Nonproprietary Names). | — | INNs are public by design: they are generic names meant for free use. | **Yes.** This is the basis of the starter list. |

**Choice:** a curated starter list written by us from general pharmacology knowledge. It has about 417 common outpatient
and day-clinic **generic names (INN) only, no brand names**. Each row has a Russian МНН, an ATC code (an identifier,
see the caveat above), dosage forms, allergy classes and a prescription-only flag. It is not copied from any of the
lists above.

## Review status — what a clinical pharmacologist must check before real use

- [ ] Allergy-class membership of every drug (`allergy_classes`), especially combinations, topical forms and the sulfonamide question (only antibacterial sulfonamides plus sulfasalazine and silver sulfadiazine are in the `sulfonamides` class; furosemide, thiazides, sulfonylureas and celecoxib are deliberately **not**).
- [ ] Cross-reactivity table (`allergy_classes.cross_reactive`): penicillins ↔ cephalosporins ↔ carbapenems (partial), NSAIDs ↔ pyrazolones, ACE inhibitors ↔ ARBs (angioedema). A cross hit is a **warning**, and it blocks only when the recorded allergy is severe.
- [ ] `prescription_only` flags against Uzbek dispensing rules. The print shows «DMED e-retsept kerak» for these drugs.
- [ ] ATC codes (written from memory; a handful of local medicines have no ATC code and leave the column empty).
- [ ] Free-text keyword lists (`allergy_classes.keywords`), which let «penitsillinga toshma» match the penicillin class.
- [ ] Russian names (МНН) as used in Uzbek pharmacies.

Until this review is done the list is labelled «boshlang‘ich» (source `starter`). The allergy check is a safety net,
not a decision: the doctor decides, and the check never replaces asking the patient.

## How the check works

- Allergy sources:
  - Structured rows in `patient_allergies` (class, drug or free text; reaction; severity mild / moderate / severe / unknown).
  - The old card field `allergy_state='known'` + `allergy_note`, read as free text.
  - A reception entry (source `intake`, «bemor aytdi»), which counts even before a doctor confirms it.
- Match types:
  - **drug**: the same drug, or the drug's INN / Russian name written in a free-text allergy.
  - **class**: the drug belongs to the allergy's class. A free text finds a class through its keywords.
  - **cross**: the drug's class is in the allergy class's `cross_reactive` list.
- **Severe** allergy hit (any match type): `POST /encounters/:id/documents` answers 409 `ALLERGY_CONFLICT` (uz/ru) with
  `details.warnings`. With `override_reason` (≥ 5 characters) it issues the document, stores the warnings and the
  reason in the document body (`allergy_check`), and writes the audit row `document.allergy_override` (the reason is not copied into the audit).
- Non-severe hits are warnings: the document is issued and the response carries `warnings[]`. The form shows them live via
  `POST /encounters/:id/prescription-check`.
- The same drug twice in one prescription (picked, or typed with the same name) → 422 on that row.
- A typed name that equals a listed INN or Russian name is treated like a picked drug.

## Roles

| | Doctor (treating: has an appointment with the patient) | Registrar | Manager / cashier / lab |
|---|---|---|---|
| `GET /drugs?q=`, `GET /allergy-classes` | yes | 403 | 403 |
| `GET /patients/:id/allergies` | yes | 403 | 403 |
| `POST /patients/:id/allergies` | class / drug / text, source manual or intake | **text only**, source forced to `intake`, unconfirmed | 403 |
| `…/:aid/confirm`, `…/:aid/withdraw` (reason) | yes | 403 | 403 |

Rows are append-only (DB trigger `patient_allergy_guard`): the only changes are confirm (once) and withdraw (once).
A doctor's entry sets the card status to «known». The Telegram intake answer has a one-click «Allergiya sifatida qayd etish»
button in the visit; a second click returns the same row.

## Importing an official list

```
npm run db:import-drugs -- reyestr.csv            # add / update by INN (case-insensitive), source 'official'
npm run db:import-drugs -- reyestr.csv --replace  # also deactivate starter drugs that are not in the file
```

Format: UTF-8 CSV, separator `;` (or tab or `,`), optional header:
`inn;inn_ru;atc;forms;allergy_classes;prescription_only`. `forms` and `allergy_classes` are `|`-separated codes; the
form codes are in `DRUG_FORMS` (`packages/contracts/src/schemas.ts`) and the class codes in `allergy_classes`.
Unknown classes are reported and dropped from the row. Drugs are never deleted: issued prescriptions keep their own snapshot
(`items[].inn / atc / prescription_only`) and allergies may point at a drug. An official register usually lists trade
names. Map them to INN before import (one row per INN), or extend the table with a `trade_names` column in a later migration.
