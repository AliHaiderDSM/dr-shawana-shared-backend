import { type PrescriptionCategory } from './prescription-catalog-item.entity';

export interface CatalogSeedItem {
  code: string;
  category: PrescriptionCategory;
  groupName: string;
  name: string;
  defaultDose: string | null;
  defaultInstructions: string | null;
  isActive: boolean;
}

type Row = [code: string, name: string, dose?: string | null, instructions?: string | null];

const group =
  (category: PrescriptionCategory, groupName: string, isActive = true) =>
  (rows: Row[]): CatalogSeedItem[] =>
    rows.map(([code, name, dose = null, instructions = null]) => ({
      code,
      category,
      groupName,
      name,
      defaultDose: dose,
      defaultInstructions: instructions,
      isActive,
    }));

const VAGINAL_USE =
  "Apply at bedtime to the internal and external vaginal/private areas using gentle massage. Use daily for 4 weeks, then continue maintenance therapy based on the patient's response, typically 3 times per week. Avoid sexual intercourse immediately after application. However, if intercourse occurs, no harm is expected.";

const ESTRADIOL_USE =
  'Apply to mid-thigh or mid arm on clean, dry skin. Gently massage until fully absorbed, and avoid washing the area for at least one hour after application.';

const current: CatalogSeedItem[] = [
  ...group(
    'lab',
    'Baseline',
  )([
    ['pres_fsh', 'FSH'],
    ['pres_estradiol', 'Estradiol'],
    ['pres_testosteroneFree', 'Testosterone (free)'],
    ['pres_testosteroneTotal', 'Testosterone (total)'],
    ['pres_dhea', 'DHEA-Sulphate'],
    ['pres_vitd', 'Vit D3'],
    ['pres_tsh', 'TSH'],
    ['pres_ferritin', 'Ferritin'],
    ['pres_b12', 'B12'],
  ]),
  ...group(
    'lab',
    'Hormones',
  )([
    ['pres_LHVal', 'LH'],
    ['pres_progesterone', 'Serum Progesterone'],
    ['pres_17HydroxyprogesteroneVal', '17-Hydroxyprogesterone (17-OHP)'],
    ['pres_SHBGVal', 'SHBG'],
    ['pres_amh', 'AMH'],
    ['pres_prolactin', 'Prolactin'],
    ['pres_CortisolAMVal', 'Cortisol, AM (8–9 AM serum)'],
  ]),
  ...group(
    'lab',
    'Cardiovascular / Metabolic',
  )([
    ['pres_cbc', 'CBC'],
    ['pres_lipidPanel', 'Fasting Lipid Panel'],
    ['pres_ApoBVal', 'ApoB'],
    ['pres_LipoproteinAVal', 'Lipoprotein(a) — Lp(a)'],
    ['pres_hba1c', 'HbA1c'],
    ['pres_insulin', 'Fasting Insulin'],
    ['pres_HomocysteineVal', 'Homocysteine'],
  ]),
  ...group(
    'lab',
    'Thyroid',
  )([
    ['pres_t3', 'Free T3'],
    ['pres_t4', 'Free T4'],
    ['pres_ReverseT3Val', 'Reverse T3'],
    ['pres_TPOAntibodiesVal', 'TPO Antibodies'],
  ]),
  ...group(
    'lab',
    'Inflammation',
  )([
    ['pres_hsCRPVal', 'hs-CRP'],
    ['pres_ESRVal', 'ESR'],
    ['pres_CA125Val', 'CA-125'],
  ]),
  ...group(
    'lab',
    'Liver Function',
  )([
    ['pres_ALTVal', 'ALT'],
    ['pres_ASTVal', 'AST'],
    ['pres_GGTVal', 'GGT'],
    ['pres_AlkalinePhosphataseVal', 'Alkaline Phosphatase'],
    ['pres_TotalBilirubinVal', 'Total Bilirubin'],
  ]),
  ...group(
    'lab',
    'Basic Chemistry / Metabolic',
  )([
    ['pres_UricAcidVal', 'Uric Acid'],
    ['pres_UACRVal', 'Urine Albumin-to-Creatinine Ratio (UACR/ACR)'],
  ]),
  ...group(
    'lab',
    'Miscellaneous',
  )([
    ['pres_DHT', 'DHT (Dihydrotestosterone)'],
    ['pres_zinc', 'Zinc'],
    ['pres_IronTIBCVal', 'Iron / TIBC / Transferrin Saturation'],
    ['pres_FolateVal', 'Folate'],
  ]),
  ...group(
    'lab',
    'Urine Studies',
  )([
    ['pres_UrinalysisVal', 'Urinalysis'],
    ['pres_urineCulture', 'Urine Culture'],
  ]),
  ...group(
    'lab',
    'Other',
    false,
  )([
    ['pres_chemistry', 'Basic Chemistry'],
    ['pres_ASTALT', 'AST, ALT'],
    ['pres_ANA', 'ANA'],
    ['pres_LabsMyLH', 'LH Lab'],
  ]),
  ...group(
    'imaging',
    'Baseline',
  )([
    ['pres_scrennMamm', 'Screening Mammogram'],
    ['pres_papSmear', 'Pap Smear / HPV Testing'],
    ['pres_pelvicUltra', 'Pelvic Ultrasound'],
    ['pres_transVaginalUltra', 'Transvaginal Ultrasound'],
    ['pres_dexaScan', 'DEXA Scan'],
  ]),
  ...group(
    'imaging',
    'Breast',
  )([
    ['pres_breastUltra', 'Breast Ultrasound'],
    ['pres_diagnosticMammogram', 'Diagnostic Mammogram'],
    ['pres_breastMRI', 'Breast MRI'],
  ]),
  ...group(
    'imaging',
    'Gynecologic',
  )([
    ['pres_endometrialBiopsy', 'Endometrial Biopsy'],
    ['pres_salineInfusionSonography', 'Saline Infusion Sonography (SIS)'],
  ]),
  ...group(
    'imaging',
    'Other Imaging',
  )([
    ['pres_abdominalUltra', 'Abdominal Ultrasound'],
    ['pres_renalUltra', 'Renal Ultrasound'],
  ]),
  ...group(
    'genetic',
    'Genetic Screening',
  )([
    ['pres_brca12Genotype', 'BRCA1/BRCA2 Genetic Testing'],
    ['pres_MTHF', 'MTHFR Genotyping'],
  ]),
  ...group(
    'supplement',
    'Supplements',
  )([
    ['pres_vitd3k2', 'DSM VitD3+K2-MK7', '2 Gummies after meal'],
    ['pres_magnesium', 'DSM Magnesium Glycinate 800mg', 'Elemental 240mg at bedtime'],
    ['pres_omega3', 'Omega 3 1000mg', 'day'],
    ['pres_collagen', 'Collagen peptide', '10-15 gram daily'],
    ['pres_curcumin', 'Curcumin', 'one tab. 500mg twice a day'],
    ['pres_creatine', 'DSM Creatine Monohydrate', '3-5 gram daily'],
    ['pres_coq', 'CO-Q', '100-200 mg/day'],
    ['pres_NAC600mg', 'NAC', '600mg daily 30 minutes before food'],
  ]),
  ...group(
    'medicine',
    'Supplements',
  )([
    ['pres_ferinject', 'Ferinject (500mg)', 'IV infusion single dose'],
    ['pres_ferrousSulfate', 'Ferrous Sulphate 325mg', 'orally once daily with Vit.C before breakfast'],
    ['pres_VitaminB121', 'Inj. Vitamin B12 (Methylcobalamin)', '1000 mcg IM twice a week for two weeks'],
  ]),
  ...group(
    'supplement',
    'Supplements',
  )([['pres_VitaminB122', 'Vitamin B12 (Methylcobalamin)', '1000mcg orally once daily, before breakfast']]),
  ...group(
    'medicine',
    'Supplements',
  )([
    ['pres_Spironolactone', 'Spironolactone', '50 mg once daily by mouth'],
    ['pres_TXA', 'TXA'],
  ]),
  ...group(
    'glp',
    "GLP's",
  )([
    ['pres_Tirzee2mg', 'Inj. Tirzepatide (Triza Trim) 2.5 mg', 'SC once weekly'],
    ['pres_Tirzee5mg', 'Inj. Tirzepatide (Triza Trim) 5 mg', 'SC once weekly'],
    ['pres_Tirzee7mg', 'Inj. Tirzepatide (Triza Trim) 7.5 mg', 'SC once weekly'],
  ]),
  ...group(
    'skin_care',
    'Skin Care',
  )([
    ['pres_RadianceRepairDay', 'Radiance Repair Day'],
    ['pres_RadianceRepairNight', 'Radiance Repair Night'],
  ]),
  ...group('hair_care', 'Hair Care')([['pres_HairsolF', 'Hairsol - F']]),
  ...group(
    'bhrt',
    'Serenogest 100mg',
  )([
    ['pres_progest1', 'Serenogest 100mg', 'Take one capsule every day at bed time'],
    ['pres_progest2', 'Serenogest 100mg', 'Take one capsule every day for 14 days every month'],
    ['pres_progest3', 'Serenogest 100mg', 'Take two capsules everyday for 14 days every month'],
    ['pres_progest4', 'Serenogest 100mg', 'Take two capsules at bedtime everyday for 21 days every month'],
    [
      'pres_progest100',
      'Serenogest 100mg',
      'Take two 100 mg capsules orally once daily at bedtime every month',
    ],
    [
      'pres_progest1021',
      'Serenogest 100mg',
      'Take one 100 mg capsules orally once daily for 21 days every month',
    ],
    ['pres_progest5', 'Serenogest: With Regular Periods', null, 'Start 14 days before the expected date.'],
    ['pres_progest6', 'Serenogest: Irregular / Absent Periods', null, 'Start at any time of the month.'],
  ]),
  ...group(
    'bhrt',
    'Estradiol BHRT',
  )([
    ['pres_estradiol1', 'Estradiol BHRT', 'Apply 1/2 ml once daily (day or night)', ESTRADIOL_USE],
    ['pres_estradiol2', 'Estradiol BHRT', 'Apply 1/2 ml twice daily (day and night)', ESTRADIOL_USE],
  ]),
  ...group(
    'bhrt',
    'DSM Vaginal Estradiol',
  )([
    [
      'pres_estradiolVaginal',
      'DSM Vaginal Estradiol',
      'Apply 1ml of DSM vaginal estradiol cream at bedtime',
      VAGINAL_USE,
    ],
  ]),
  ...group(
    'bhrt',
    'DSM Vaginal DHEA',
  )([
    ['pres_dheaVaginal', 'DSM Vaginal DHEA', 'Apply 1ml of DSM vaginal DHEA cream at bedtime', VAGINAL_USE],
  ]),
  ...group(
    'bhrt',
    'DSM Mixed Vaginal Therapy',
  )([
    [
      'pres_mixVaginal',
      'DSM Mixed Vaginal Therapy',
      "Use 1ml of whichever cream you're applying.",
      'Use vaginal estrogen cream 4 nights per week and vaginal DHEA on the remaining 3 nights for a total of 4 weeks. For maintenance, continue with vaginal estrogen 2 nights per week and vaginal DHEA 2 nights per week.',
    ],
  ]),
  ...group(
    'bhrt',
    'Testofeme',
  )([
    [
      'pres_testostest',
      'Testofeme',
      'Apply 1ml daily during the day time.',
      'Apply to the inner mid-thigh on clean, dry skin and gently massage until absorbed. Use the right thigh for 2 weeks, then switch to the left thigh for the next 2 weeks. Keep alternating sides this way. Use daily for 4 months, then continue 2–3 times per week for maintenance, depending on symptoms and lab results.',
    ],
  ]),
  ...group(
    'bhrt',
    'Estriol',
  )([
    [
      'pres_estrio',
      'Estriol',
      'Apply 1ml Estriol daily.',
      'Apply 1ml to the face, neck and back of the hands once daily on clean dry skin. Gently massage until fully absorbed. May be used with other skin care products and can be applied before or after any skin serums.',
    ],
  ]),
];

const symptoms = group(
  'symptom',
  'Symptoms',
  false,
)([
  ['pres_irregularPeriods', 'Irregular Periods'],
  ['pres_heavyPeriods', 'Heavy Periods'],
  ['pres_moodSwings', 'Mood Swings'],
  ['pres_irritability', 'Irritability'],
  ['pres_hotFlashes', 'Hot Flashes'],
  ['pres_sweating', 'Night Sweats'],
  ['pres_lackEnergy', 'Lack of energy'],
  ['pres_lackMotivation', 'Lack of motivation'],
  ['pres_lackTolerance', 'Lack of tolerance'],
  ['pres_fatigue', 'Fatigue'],
  ['pres_brainFog', 'Brain fog'],
  ['pres_insomnia', 'Insomnia'],
  ['pres_anxiety', 'Recent onset of anxiety and depression'],
  ['pres_headaches', 'Headaches'],
  ['pres_migraines', 'Frequent migraines'],
  ['pres_dryEyes', 'Dry Eyes'],
  ['pres_hairLoss', 'Hair loss'],
  ['pres_dizziness', 'Dizziness'],
  ['pres_earRinging', 'Ear ringing'],
  ['pres_skinChanges', 'Skin changes / dryness'],
  ['pres_palpitations', 'Heart palpitations'],
  ['pres_tasteChanges', 'Taste Changes'],
  ['pres_weightGain', 'Weight gain'],
  ['pres_bellyFat', 'Belly fat'],
  ['pres_cholesterolChanges', 'Recent changes in cholesterol'],
  ['pres_bpChanges', 'Recent changes in B.P / diabetes control'],
  ['pres_weightLoss', 'Weight loss'],
  ['pres_bodyAches', 'Body aches'],
  ['pres_muscleAches', 'Joint or Muscle Aches'],
  ['pres_frozenShoulder', 'Frozen shoulder'],
  ['pres_plantarfasciitis', 'Plantar fasciitis'],
  ['pres_increasedDesire', 'Increased sexual desire'],
  ['pres_decreasedDesire', 'Decreased sexual desire'],
  ['pres_vaginalDryness', 'Vaginal dryness'],
  ['pres_vaginalItching', 'Vaginal itching'],
  ['pres_painfulIntercourse', 'Painful Intercourse'],
  ['pres_uti', 'Recurrent UTIs'],
  ['pres_urinaryIssues', 'Urinary Issues'],
  ['pres_Hirsutism', 'Hirsutism'],
  ['pres_ACNE', 'Acne'],
  ['pres_AcanthosisNigricans', 'Acanthosis Nigricans'],
  ['pres_InsulinResistance', 'Insulin Resistance'],
]);

const previous: CatalogSeedItem[] = [
  ...group(
    'lab',
    'Blood Work (previous)',
    false,
  )([
    ['prev_pres_lh', 'LH'],
    ['prev_pres_testosterone', 'Testosterone (free + total)'],
    ['prev_pres_shbg', 'SHBG'],
    ['prev_pres_t3', 'T3, T4'],
    ['prev_pres_b12', 'Vit B12 + Folate'],
    ['prev_pres_ferritin', 'Ferritin, TIBC, Iron'],
    ['prev_pres_lipid', 'Lipid Panel'],
    ['prev_pres_magnesiumrbc', 'Magnesium RBC'],
    ['prev_pres_vitd', '25 Hydroxy Vit D3'],
    ['prev_pres_copper', 'Copper'],
    ['prev_pres_selenium', 'Selenium'],
    ['prev_pres_calcium', 'Calcium'],
    ['prev_pres_esr', 'ESR'],
    ['prev_pres_crp', 'CRP'],
  ]),
  ...group(
    'supplement',
    'Supplements (previous)',
    false,
  )([
    ['prev_pres_magnesium', 'Magnesium Glycinate', '300-400 bedtime'],
    ['prev_pres_vitd3k2', 'VitD3+K2', '5000+100mcg'],
    ['prev_pres_codliver', 'Cod liver Oil (Omega 3)', '1000mg/day'],
    ['prev_pres_melatonin', 'Melatonin', '3-12 mg/day bedtime'],
    ['prev_pres_seedcycling', 'Seed Cycling'],
    ['prev_pres_ashwagandha', 'Ashwagandha'],
    ['prev_pres_shilajit', 'Shilajit'],
    ['prev_pres_additional', 'Additional supplements recommended by doctor'],
  ]),
  ...group(
    'bhrt',
    'Treatments (previous)',
    false,
  )([
    ['prev_pres_progest200', 'U-Progest 200mg', 'one tab. bedtime x14 days every month'],
    ['prev_pres_progest100', 'U-Progest 100mg', 'one tab. bedtime every day'],
    ['prev_pres_progest14days', 'Progesterone 100 mg', 'for 14 days at bedtime every month'],
    ['prev_pres_estradiolBHRT', 'Estradiol BHRT', 'one pump daily'],
    ['prev_pres_dht', 'DHT'],
    [
      'prev_pres_applyEstriol',
      'Estriol cream',
      'Apply to the vaginal area nightly for 14 days, then reduce to a maintenance dose 2-3 times per week.',
      'It may also be used as an anti-aging and anti-wrinkle cream on the face and neck.',
    ],
    [
      'prev_pres_testogel',
      'Testogel',
      null,
      'Apply daily to the inner thigh, using an amount about the size of a pea.',
    ],
  ]),
  ...group('imaging', 'Imaging (previous)', false)([['prev_pres_dexa', 'DEXA']]),
];

export const CATALOG_SEED: CatalogSeedItem[] = [...current, ...symptoms, ...previous];
