import { z } from 'zod';
import { dateInput } from '../../lib/validation';
import { type SectionKey } from './consultation-section.entity';

const text = (max = 5000) => z.string().trim().max(max).nullable().default(null);
const yesNo = z.enum(['yes', 'no']).nullable().default(null);
const choice = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).nullable().default(null);
const flags = <const T extends readonly [string, ...string[]]>(values: T) =>
  z
    .array(z.enum(values))
    .max(values.length)
    .default([])
    .transform((v) => [...new Set(v)]);
const measure = z.coerce.number().positive().max(1000);
const date = dateInput.nullable().default(null);
const required = (message: string) => ({ message, code: 'custom' as const });

function requireWhen<T>(ctx: z.RefinementCtx, condition: boolean, value: T, path: string, message: string) {
  const empty = value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
  if (condition && empty) ctx.addIssue({ ...required(message), path: [path] });
}

export const SHARED_TOPIC_FIELDS = ['discussTopics', 'majorComplaint', 'currentMedications'] as const;
const sharedTopics = {
  discussTopics: text(),
  majorComplaint: text(),
  currentMedications: text(),
};

export const MARITAL_STATUSES = ['single', 'married', 'divorced', 'widowed'] as const;

export const basicInfoSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    age: z.coerce.number().int().min(0).max(150),
    city: z.string().trim().min(1).max(100),
    country: z.string().trim().min(1).max(100),
    weightKg: measure,
    heightFeet: z.coerce.number().positive().max(10),
    waistCircumference: text(50),
    maritalStatus: z.enum(MARITAL_STATUSES),
    marriedYears: text(50),
    hasKids: yesNo,
    kidsDetails: text(255),
    education: text(500),
    occupation: text(500),
  })
  .superRefine((v, ctx) => {
    const partnered = v.maritalStatus !== 'single';
    requireWhen(ctx, partnered, v.marriedYears, 'marriedYears', 'Required unless single');
    requireWhen(ctx, partnered, v.hasKids, 'hasKids', 'Required unless single');
    requireWhen(ctx, v.hasKids === 'yes', v.kidsDetails, 'kidsDetails', 'Required when there are kids');
  })
  .transform((v) =>
    v.maritalStatus === 'single' ? { ...v, marriedYears: null, hasKids: null, kidsDetails: null } : v,
  );

export const followUpSchema = z
  .object({
    pgic: choice([
      'very_much_improved',
      'much_improved',
      'minimally_improved',
      'no_change',
      'minimally_worse',
      'much_worse',
      'very_much_worse',
    ]),
    ...sharedTopics,
    beforeVisitNote: text(),
    usingHormoneTherapy: yesNo,
    hormoneTherapySinceLastVisit: choice(['continuous', 'interrupted', 'stopped']),
    interruptionReason: text(),
    stillHavingPeriods: yesNo,
    spottingAfterHrt: yesNo,
    medicalHistoryChanged: yesNo,
    newMedications: yesNo,
    reducedMedications: yesNo,
    stoppedMedications: yesNo,
    improvementCause: choice([
      'hormone_treatment',
      'new_medication',
      'not_sure_both',
      'not_applicable',
      'other',
    ]),
    utiAntibiotics: yesNo,
    adverseEvent: yesNo,
    adverseEventDetails: text(),
    adverseEventOther: text(),
    cervicalScreeningUpToDate: yesNo,
    breastScreeningUpToDate: yesNo,
    dexaSinceLastVisit: yesNo,
    bloodPressureChecked: yesNo,
  })
  .superRefine((v, ctx) => {
    requireWhen(
      ctx,
      v.hormoneTherapySinceLastVisit === 'interrupted',
      v.interruptionReason,
      'interruptionReason',
      'Required when therapy was interrupted',
    );
    requireWhen(
      ctx,
      v.adverseEvent === 'yes',
      v.adverseEventDetails,
      'adverseEventDetails',
      'Please specify',
    );
  });

export const MEDICAL_CONDITIONS = [
  'breast_cancer',
  'endometrial_cancer',
  'ovarian_cancer',
  'brca',
  'lynch_syndrome',
  'other_cancer',
  'hyperthyroidism',
  'hypothyroidism',
  'endometriosis',
  'pms',
  'pcos',
  'diabetes',
  'insulin_resistance',
  'dyslipidemia',
  'nafld',
  'osteopenia',
  'osteoporosis',
  'osteoarthritis',
  'rheumatoid_arthritis',
  'gout',
  'heart_disease',
  'hypertension',
  'dvt',
  'pulmonary_embolism',
  'tia',
  'anxiety',
  'depression',
  'chronic_fatigue_me',
  'pnd',
  'pmdd',
  'migraine',
  'epilepsy',
  'multiple_sclerosis',
  'memory_issues',
  'stroke',
  'lupus_sle',
  'skin_disease',
  'liver_disease',
  'chronic_reflux',
  'celiac_disease',
  'ibs',
  'h_pylori',
  'recurrent_uti',
  'vaginal_infections',
  'std',
] as const;

export const SURGERIES = [
  'hysterectomy',
  'ovaries_removed',
  'c_section',
  'tubal_ligation',
  'myomectomy',
  'endometriosis_surgery',
  'breast_surgery',
  'bariatric_surgery',
  'other',
] as const;

export const FAMILY_RELATIVES = ['mother', 'father', 'sister', 'close_family'] as const;
export const FAMILY_CONDITIONS = [
  'breast_cancer',
  'ovarian_cancer',
  'endometrial_cancer',
  'osteoporosis',
  'hip_fracture',
  'heart_disease',
  'diabetes',
  'early_menopause',
  'dementia',
  'other',
] as const;

const yesNoOccasionally = choice(['yes', 'no', 'occasionally']);

export const medicalHistorySchema = z
  .object({
    ...sharedTopics,
    hormoneTherapy: choice(['never', 'currently_using', 'previously_used']),
    hormonesUsed: text(),
    contraception: choice(['yes', 'no', 'not_needed']),
    havingPeriods: yesNo,
    lastPeriodDate: date,
    cycle: choice(['regular', 'irregular']),
    flow: choice(['normal', 'heavy', 'low']),
    dub: z.boolean().default(false),
    oligomenorrhea: z.boolean().default(false),
    periodsNote: text(),
    menopauseDiagnosed: yesNo,
    menopauseDiagnosedAge: text(50),
    conditions: flags(MEDICAL_CONDITIONS),
    otherConditions: text(),
    surgeries: z
      .array(z.object({ type: z.enum(SURGERIES), date }))
      .max(SURGERIES.length)
      .default([])
      .refine((v) => new Set(v.map((s) => s.type)).size === v.length, 'Each surgery can be listed once'),
    otherSurgery: text(500),
    familyRelatives: flags(FAMILY_RELATIVES),
    familyConditions: flags(FAMILY_CONDITIONS),
    familyOther: text(500),
    utiAntibiotics12m: yesNo,
    painMedication: yesNo,
    moodMedication: yesNo,
    sleepMedication: yesNo,
    weightLossMedication: yesNo,
    hasAllergies: yesNo,
    allergies: text(),
    alcohol: yesNoOccasionally,
    smoking: yesNoOccasionally,
    exercise: yesNoOccasionally,
    followsDiet: yesNo,
    dietName: text(255),
    relationship: flags(['abusive', 'conflicted', 'healthy']),
    relationshipSituation: text(500),
  })
  .superRefine((v, ctx) => {
    const periods = v.havingPeriods === 'yes';
    requireWhen(ctx, periods, v.lastPeriodDate, 'lastPeriodDate', 'Required while having periods');
    requireWhen(ctx, periods, v.cycle, 'cycle', 'Required while having periods');
    requireWhen(ctx, v.hasAllergies === 'yes', v.allergies, 'allergies', 'List the allergies');
    requireWhen(ctx, v.followsDiet === 'yes', v.dietName, 'dietName', 'Name the diet plan');
  })
  .transform((v) => ({
    ...v,
    ...(v.havingPeriods === 'yes' ? {} : { lastPeriodDate: null, cycle: null, flow: null }),
    ...(v.cycle === 'irregular' ? {} : { dub: false, oligomenorrhea: false }),
    allergies: v.hasAllergies === 'yes' ? v.allergies : null,
    dietName: v.followsDiet === 'yes' ? v.dietName : null,
  }));

export const MRS_ITEMS = {
  somatic: ['hotFlushes', 'heartDiscomfort', 'sleepProblems', 'jointMuscleDiscomfort'],
  psychological: ['depressiveMood', 'irritability', 'anxiety', 'exhaustion'],
  urogenital: ['sexualProblems', 'bladderProblems', 'vaginalDryness'],
} as const;
const mrsScore = z.number().int().min(0).max(4).nullable().default(null);
const allMrsItems = [...MRS_ITEMS.somatic, ...MRS_ITEMS.psychological, ...MRS_ITEMS.urogenital];

export const mrsScaleSchema = z.object({
  date: dateInput,
  ...(Object.fromEntries(allMrsItems.map((k) => [k, mrsScore])) as Record<
    (typeof allMrsItems)[number],
    typeof mrsScore
  >),
});

export const ADDITIONAL_SYMPTOMS = [
  'hair_loss',
  'increased_facial_hair',
  'skin_issues',
  'dry_skin',
  'skin_itching',
  'crawling_sensation',
  'nail_changes',
  'body_odor_change',
  'weight_gain',
  'weight_loss',
  'belly_fat',
  'food_sugar_cravings',
  'decreased_strength',
  'decreased_stamina',
  'low_backache',
  'frozen_shoulder',
  'heel_pain',
  'clicking_jaw_tmj',
  'brain_fog',
  'headaches',
  'migraines',
  'dizziness_vertigo',
  'tinnitus',
  'burning_soles',
  'taste_changes',
  'increased_smell',
  'hearing_changes',
  'dry_eyes',
  'vision_changes',
  'bloating',
  'gas',
  'constipation',
  'diarrhea',
  'heartburn',
  'recurrent_utis',
  'stress_incontinence',
  'vaginal_itching',
  'social_withdrawal',
  'accomplishing_less',
  'marital_conflicts',
  'avoiding_intimacy',
  'personal_life_dissatisfaction',
  'voice_changes',
] as const;

export const additionalSymptomsSchema = z.object({
  symptoms: flags(ADDITIONAL_SYMPTOMS),
  other: text(1000),
});

const scan = z
  .object({
    status: choice(['normal', 'abnormal', 'not_done']),
    date,
    abnormalDetails: text(),
  })
  .superRefine((v, ctx) =>
    requireWhen(
      ctx,
      v.status === 'abnormal',
      v.abnormalDetails,
      'abnormalDetails',
      'Describe the abnormality',
    ),
  )
  .transform((v) => ({ ...v, abnormalDetails: v.status === 'abnormal' ? v.abnormalDetails : null }))
  .default({ status: null, date: null, abnormalDetails: null });

export const imagingResultsSchema = z.object({
  pelvicScan: scan,
  pelvicScanDaysAfterPeriod: text(100),
  dexaScan: scan,
  mammogram: scan,
  breastUltrasound: scan,
});

export const TREATMENT_PLAN = [
  'start_bhrt',
  'continue_bhrt',
  'stop_therapy',
  'change_formulation',
  'labs_ordered',
  'imaging_ordered',
  'lifestyle_counseling',
  'referred_to_specialist',
] as const;

export const clinicalAssessmentSchema = z.object({
  menopauseStage: flags(['perimenopause', 'early_menopause', 'menopause', 'late_menopause', 'postmenopause']),
  menopauseType: flags(['natural', 'surgical', 'induced', 'poi']),
  diagnoses: flags([
    'osteopenia',
    'osteoporosis',
    'pcos',
    'pms_pmdd',
    'endometriosis',
    'adenomyosis',
    'ovarian_cyst',
  ]),
  complaints: flags([
    'vasomotor',
    'gsm',
    'hsdd',
    'mood',
    'sleep_disorder',
    'cognitive',
    'weight_metabolic',
    'hair_loss',
    'acne',
    'other',
  ]),
  clinicalStatus: flags(['improved', 'stable', 'worsened', 'no_change']),
  treatmentPlan: flags(TREATMENT_PLAN),
  plan: text(20000),
});

const requiredText = (max: number) => z.string().trim().min(1).max(max);

export const referralSchema = z.object({
  referredTo: requiredText(255),
  specialty: requiredText(255),
  name: z.string().trim().min(1).max(150).optional(),
  dateOfBirth: dateInput,
  date: dateInput,
  referringDoctorName: requiredText(150),
  referringDoctorPhone: requiredText(50),
  referringDoctorAddress: requiredText(500),
  reason: requiredText(5000),
});

export const plansSchema = z.object({
  glpDietPlan: yesNo,
  generalDietPlan: yesNo,
  liverDetox: yesNo,
  skinCareRoutine: yesNo,
  hairCareRoutine: yesNo,
});

export const SECTION_SCHEMAS = {
  basic_info: basicInfoSchema,
  follow_up: followUpSchema,
  medical_history: medicalHistorySchema,
  mrs_scale: mrsScaleSchema,
  additional_symptoms: additionalSymptomsSchema,
  imaging_results: imagingResultsSchema,
  clinical_assessment: clinicalAssessmentSchema,
  referral: referralSchema,
  plans: plansSchema,
} satisfies Record<SectionKey, z.ZodType>;

export type SectionData<K extends SectionKey> = z.output<(typeof SECTION_SCHEMAS)[K]>;

export const PATIENT_FIELDS_BY_SECTION: Partial<Record<SectionKey, readonly string[]>> = {
  basic_info: ['name', 'age', 'city', 'country'],
  referral: ['name', 'dateOfBirth'],
};

export function bmiOf(weightKg: number, heightFeet: number) {
  const metres = heightFeet * 0.3048;
  const bmi = Math.round((weightKg / (metres * metres)) * 100) / 100;
  const category =
    bmi < 18.5
      ? 'underweight'
      : bmi < 25
        ? 'normal'
        : bmi < 30
          ? 'overweight'
          : bmi < 35
            ? 'obesity'
            : 'severe_obesity';
  return { bmi, bmiCategory: category };
}

export function mrsScores(data: Record<string, unknown>) {
  const sum = (keys: readonly string[]) => keys.reduce((total, k) => total + (Number(data[k] ?? 0) || 0), 0);
  const somatic = sum(MRS_ITEMS.somatic);
  const psychological = sum(MRS_ITEMS.psychological);
  const urogenital = sum(MRS_ITEMS.urogenital);
  const total = somatic + psychological + urogenital;
  const severity = total <= 4 ? 'none' : total <= 8 ? 'mild' : total <= 16 ? 'moderate' : 'severe';
  return {
    somatic,
    psychological,
    urogenital,
    total,
    percentage: Math.round((total * 10000) / 44) / 100,
    severity,
  };
}
