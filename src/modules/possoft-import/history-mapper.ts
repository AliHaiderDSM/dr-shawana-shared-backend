import type { DumpRow } from './dump-reader';
import { dateOf, text } from './possoft-values';

const on = (row: DumpRow, col: string) => text(row[col]) === '1';
const pick = (row: DumpRow, map: Record<string, string>) =>
  Object.entries(map)
    .filter(([col]) => on(row, col))
    .map(([, code]) => code);

function number(value: string): number | null {
  const cleaned = value.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function heightFeet(raw: string): number | null {
  const feetInches = /^(\d+)\s*['’]\s*(\d+)/.exec(raw.trim());
  if (feetInches) return Number(feetInches[1]) + Number(feetInches[2]) / 12;
  const n = number(raw);
  if (n === null) return null;
  if (n > 10 && n < 250) return Math.round((n / 30.48) * 100) / 100;
  if (n > 0 && n <= 10) return n;
  return null;
}

const MARITAL: Record<string, string> = {
  married: 'married',
  single: 'single',
  unmarried: 'single',
  divorced: 'divorced',
  widowed: 'widowed',
};

const CONDITIONS: Record<string, string> = {
  hist_BreastCancerVal: 'breast_cancer',
  hist_EndometrialCancerVal: 'endometrial_cancer',
  hist_OvarianCancerVal: 'ovarian_cancer',
  hist_BRCAVal: 'brca',
  hist_LynchSyndromeVal: 'lynch_syndrome',
  hist_AnyOtherCancerVal: 'other_cancer',
  hist_HyperthyroidismVal: 'hyperthyroidism',
  hist_HypothyroidismVal: 'hypothyroidism',
  hist_EndometriosisVal: 'endometriosis',
  hist_PMSVal: 'pms',
  hist_PCOSVal: 'pcos',
  hist_DiabetesVal: 'diabetes',
  hist_InsulinResistanceVal: 'insulin_resistance',
  hist_DyslipidemiaVal: 'dyslipidemia',
  hist_NAFLDVal: 'nafld',
  hist_OsteoarthritisVal: 'osteoarthritis',
  hist_OsteoporosisVal: 'osteoporosis',
  hist_OsteopeniaVal: 'osteopenia',
  hist_RheumatoidArthritisVal: 'rheumatoid_arthritis',
  hist_GoutVal: 'gout',
  hist_HeartDiseaseVal: 'heart_disease',
  hist_HypertensionVal: 'hypertension',
  hist_DVTVal: 'dvt',
  hist_PulmonaryEmbolismVal: 'pulmonary_embolism',
  hist_TIAVal: 'tia',
  hist_AnxietyVal: 'anxiety',
  hist_DepressionVal: 'depression',
  hist_ChronicFatigueMEVal: 'chronic_fatigue_me',
  hist_PNDVal: 'pnd',
  hist_PMDDVal: 'pmdd',
  hist_MigraineVal: 'migraine',
  hist_EpilepsyVal: 'epilepsy',
  hist_MultipleSclerosisVal: 'multiple_sclerosis',
  hist_MemoryIssuesVal: 'memory_issues',
  hist_StrokeVal: 'stroke',
  hist_LupusSLEVal: 'lupus_sle',
  hist_AnySkinDiseaseVal: 'skin_disease',
  hist_LiverDiseaseVal: 'liver_disease',
  hist_ChronicRefluxVal: 'chronic_reflux',
  hist_CeliacDiseaseVal: 'celiac_disease',
  hist_IBSVal: 'ibs',
  hist_HPyloriVal: 'h_pylori',
  hist_RecurrentUTIVal: 'recurrent_uti',
  hist_VaginalInfectionsVal: 'vaginal_infections',
  hist_STDVal: 'std',
};

const SURGERIES: { val: string; date: string; type: string }[] = [
  { val: 'hist_HysterectomyVal', date: 'hist_HysterectomyDate', type: 'hysterectomy' },
  { val: 'hist_OvariesRemovedVal', date: 'hist_OvariesRemovedDate', type: 'ovaries_removed' },
  { val: 'hist_CSectionVal', date: 'hist_CSectionDate', type: 'c_section' },
  { val: 'hist_TubalLigationVal', date: 'hist_TubalLigationDate', type: 'tubal_ligation' },
  { val: 'hist_MyomectomyVal', date: 'hist_MyomectomyDate', type: 'myomectomy' },
  {
    val: 'hist_EndometriosisSurgeryVal',
    date: 'hist_EndometriosisSurgeryDate',
    type: 'endometriosis_surgery',
  },
  { val: 'hist_BreastSurgeryVal', date: 'hist_BreastSurgeryDate', type: 'breast_surgery' },
  { val: 'hist_BariatricSurgeryVal', date: 'hist_BariatricSurgeryDate', type: 'bariatric_surgery' },
  { val: 'hist_OtherSurgeryVal', date: 'hist_OtherSurgeryDate', type: 'other' },
];

const FAMILY_RELATIVES: Record<string, string> = {
  hist_familyMotherStatusVal: 'mother',
  hist_familyFatherStatusVal: 'father',
  hist_familySisterStatusVal: 'sister',
  hist_familyCloseStatusVal: 'close_family',
};
const FAMILY_CONDITIONS: Record<string, string> = {
  hist_familyBreastCancerVal: 'breast_cancer',
  hist_familyOvarianCancerVal: 'ovarian_cancer',
  hist_familyEndometrialCancerVal: 'endometrial_cancer',
  hist_familyOsteoporosisCancerVal: 'osteoporosis',
  hist_familyHipFractureVal: 'hip_fracture',
  hist_familyHeartDiseaseVal: 'heart_disease',
  hist_familyDiabetesVal: 'diabetes',
  hist_familyEarlyMenopauseVal: 'early_menopause',
  hist_familyDementiaVal: 'dementia',
  hist_familyOtherVal: 'other',
};

const MRS: Record<string, string> = {
  hist_hotFlushesVal: 'hotFlushes',
  hist_heartDiscomfortVal: 'heartDiscomfort',
  hist_sleepProblemsVal: 'sleepProblems',
  hist_jointMuscleDiscomfortVal: 'jointMuscleDiscomfort',
  hist_depressiveMoodVal: 'depressiveMood',
  hist_irritabilityVal: 'irritability',
  hist_anxietyInnerVal: 'anxiety',
  hist_mentalexhaustionVal: 'exhaustion',
  hist_sexualProblemsVal: 'sexualProblems',
  hist_bladderProblemsVal: 'bladderProblems',
  hist_vaginalDrynessVal: 'vaginalDryness',
};

const SYMPTOMS: Record<string, string> = {
  hist_BrainfogmemoryissuesVal: 'brain_fog',
  hist_FoodorsugarcravingsVal: 'food_sugar_cravings',
  hist_BloatingVal: 'bloating',
  hist_LowMotivationVal: 'low_motivation',
  hist_NailChangesVal: 'nail_changes',
  hist_DrySkinVal: 'dry_skin',
  hist_VaginalDrynessSymVal: 'vaginal_dryness',
  hist_MigrainesVal: 'migraines',
  hist_IncreasedFacialHairVal: 'increased_facial_hair',
  hist_SkinItchingVal: 'skin_itching',
  hist_CrawlingSensationVal: 'crawling_sensation',
  hist_ChangeInBodyOdorVal: 'body_odor_change',
  hist_DecreasedPhysicalStrengthVal: 'decreased_strength',
  hist_DecreasedStaminaVal: 'decreased_stamina',
  hist_LowBackacheVal: 'low_backache',
  hist_HeelPainVal: 'heel_pain',
  hist_ClickingJawTMJVal: 'clicking_jaw_tmj',
  hist_BurningSolesFeetVal: 'burning_soles',
  hist_TasteChangesVal: 'taste_changes',
  hist_IncreasedSenseOfSmellVal: 'increased_smell',
  hist_HearingChangesVal: 'hearing_changes',
  hist_DryEyesVal: 'dry_eyes',
  hist_EyesightVisionChangesVal: 'vision_changes',
  hist_GasGasPainsVal: 'gas',
  hist_StressUrinaryIncontinenceVal: 'stress_incontinence',
  hist_WantingToBeAloneVal: 'social_withdrawal',
  hist_AccomplishingLessThanPreviouslyVal: 'accomplishing_less',
  hist_AvoidingIntimacyVal: 'avoiding_intimacy',
  hist_DissatisfactionWithPersonalLifeVal: 'personal_life_dissatisfaction',
  hist_VoiceChangesVal: 'voice_changes',
  hist_ConstipationVal: 'constipation',
  hist_DiarrheaVal: 'diarrhea',
  hist_HeartBurnVal: 'heartburn',
  hist_HairLossVal: 'hair_loss',
  hist_EarRingingVal: 'tinnitus',
  hist_WeightGainVal: 'weight_gain',
  hist_BellyFatVal: 'belly_fat',
  hist_WeightLossVal: 'weight_loss',
  hist_FrozenShoulderVal: 'frozen_shoulder',
  hist_MaritalConflictsVal: 'marital_conflicts',
  hist_VaginalItchingVal: 'vaginal_itching',
  hist_RecurrentUTIsVal: 'recurrent_utis',
  hist_SkinIssuesVal: 'skin_issues',
  hist_HeadachesVal: 'headaches',
  hist_DizzinessVertigoVal: 'dizziness_vertigo',
};

const MENOPAUSE_STAGE: Record<string, string> = {
  hist_PremenopauseReVal: 'perimenopause',
  hist_EarlyPerimenopauseReVal: 'early_menopause',
  hist_LatePerimenopauseReVal: 'menopause',
  hist_MenopauseReVal: 'menopause',
  hist_PostmenopauseReVal: 'postmenopause',
};
const MENOPAUSE_TYPE: Record<string, string> = {
  hist_NaturalMenopauseReVal: 'natural',
  hist_SurgicalMenopauseReVal: 'surgical',
  hist_InducedMenopauseReVal: 'induced',
  hist_POIReVal: 'poi',
};
const DIAGNOSES: Record<string, string> = {
  hist_OsteopeniaReVal: 'osteopenia',
  hist_OsteoporosisReVal: 'osteoporosis',
  hist_PCOSReVal: 'pcos',
  hist_PMSPMDDReVal: 'pms_pmdd',
  hist_EndometriosisReVal: 'endometriosis',
  hist_AdenomyosisReVal: 'adenomyosis',
  hist_OvarianCystReVal: 'ovarian_cyst',
};
const COMPLAINTS: Record<string, string> = {
  hist_VasomotorSymptomsReVal: 'vasomotor',
  hist_GSMReVal: 'gsm',
  hist_MoodSymptomsReVal: 'mood',
  hist_SleepDisorderReVal: 'sleep_disorder',
  hist_CognitiveSymptomsReVal: 'cognitive',
  hist_WeightGainMetabolicSyndromeReVal: 'weight_metabolic',
  hist_HairLossReVal: 'hair_loss',
  hist_AcneReVal: 'acne',
  hist_HSDDReVal: 'hsdd',
  hist_OtherDiagnosisReVal: 'other',
};
const CLINICAL_STATUS: Record<string, string> = {
  hist_ImprovedReVal: 'improved',
  hist_StableReVal: 'stable',
  hist_WorsenedReVal: 'worsened',
  hist_NoChangeReVal: 'no_change',
};
const TREATMENT_PLAN: Record<string, string> = {
  hist_StartBHRTReVal: 'start_bhrt',
  hist_ContinueBHRTReVal: 'continue_bhrt',
  hist_StopTherapyReVal: 'stop_therapy',
  hist_ChangeFormulationReVal: 'change_formulation',
  hist_LabsOrderedReVal: 'labs_ordered',
  hist_ImagingOrderedReVal: 'imaging_ordered',
  hist_LifestyleCounselingReVal: 'lifestyle_counseling',
  hist_ReferredToSpecialistReVal: 'referred_to_specialist',
};

const yn = (row: DumpRow, col: string, yes = '1') => {
  const v = text(row[col]);
  if (!v) return null;
  return v === yes ? 'yes' : 'no';
};
const nullIfEmpty = (value: string) => value || null;

const mapCode = (row: DumpRow, col: string, map: Record<string, string>) => map[text(row[col])] ?? null;
const YES_NO = { '1': 'yes', '2': 'no' };
const YES_NO_OCC = { '1': 'yes', '2': 'no', '3': 'occasionally' };

const scanStatus = (value: string): string | null => {
  const v = value.toLowerCase();
  if (v.includes('abnormal')) return 'abnormal';
  if (v.includes('normal')) return 'normal';
  if (v.includes('not')) return 'not_done';
  return null;
};
const scan = (row: DumpRow, statusCol: string, detailCol: string, dateCol: string) => ({
  status: scanStatus(text(row[statusCol])),
  date: dateOf(row[dateCol]),
  abnormalDetails: nullIfEmpty(text(row[detailCol])),
});

export function mapHistorySections(
  row: DumpRow,
  patient: { name: string; age: number | null; city: string; country: string | null },
) {
  const marital = MARITAL[text(row.hist_custmaritStatus).toLowerCase()] ?? null;
  const partnered = marital !== null && marital !== 'single';
  const hasKids = text(row.hist_custkidStatus) === '0' ? 'no' : partnered ? 'yes' : null;

  const basicInfo = marital
    ? {
        name: patient.name,
        age: patient.age ?? 0,
        city: patient.city,
        country: patient.country || 'Pakistan',
        weightKg: number(text(row.hist_custWeight)),
        heightFeet: heightFeet(text(row.hist_custHeight)),
        waistCircumference: nullIfEmpty(text(row.hist_custWaistCircumference)),
        maritalStatus: marital,
        marriedYears: partnered ? text(row.hist_custMarriedYear) || '-' : null,
        hasKids,
        kidsDetails: hasKids === 'yes' ? text(row.hist_custkidDetails) || '-' : null,
        education: nullIfEmpty(text(row.hist_custEducation)),
        occupation: nullIfEmpty(text(row.hist_custOccupation)),
      }
    : null;

  const surgeries = SURGERIES.filter((s) => on(row, s.val)).map((s) => ({
    type: s.type,
    date: dateOf(row[s.date]),
    years: [],
  }));

  const lastPeriodDate = dateOf(row.hist_custPeriodsDate);
  const cycle = mapCode(row, 'hist_periodsCycleStatus', { '1': 'regular', '2': 'irregular' });
  const havingPeriods =
    text(row.hist_periodsStatus) === '2'
      ? 'no'
      : text(row.hist_periodsStatus) === '1' && lastPeriodDate && cycle
        ? 'yes'
        : null;

  const medicalHistory = {
    majorComplaint: nullIfEmpty(text(row.hist_custMajorComplaint)),
    currentMedications: nullIfEmpty(text(row.hist_custCurrentMedication)),
    hormoneTherapy: mapCode(row, 'hist_hormoneTreatStatus', {
      '1': 'never',
      '2': 'currently_using',
      '3': 'previously_used',
    }),
    hormonesUsed: nullIfEmpty(text(row.hist_hormoneUsedStatus)),
    contraception: mapCode(row, 'hist_contraceptionStatus', { '1': 'yes', '2': 'no', '3': 'not_needed' }),
    havingPeriods,
    lastPeriodDate,
    cycle,
    flow: mapCode(row, 'hist_periodsFlowStatus', { '1': 'normal', '2': 'heavy', '3': 'low' }),
    dub: on(row, 'hist_DUBVal'),
    oligomenorrhea: on(row, 'hist_OligomenorrheaVal'),
    periodsNote: nullIfEmpty(text(row.hist_custPeriodTextArea)),
    menopauseDiagnosed: mapCode(row, 'hist_diagnosedWithMenopauseStatus', YES_NO),
    menopauseDiagnosedAge: nullIfEmpty(text(row.hist_diagnosedAgeMenopauseStatus)),
    conditions: pick(row, CONDITIONS),
    surgeries: surgeries.length ? surgeries : [],
    otherSurgery: nullIfEmpty(text(row.hist_OtherSurgeryText)),
    familyRelatives: pick(row, FAMILY_RELATIVES),
    familyConditions: pick(row, FAMILY_CONDITIONS),
    familyOther: nullIfEmpty(text(row.hist_OtherfamilyText)),
    utiAntibiotics12m: mapCode(row, 'hist_antibioticsStatus', YES_NO),
    painMedication: mapCode(row, 'hist_medicationStatus', YES_NO),
    moodMedication: mapCode(row, 'hist_anxietyMoodStatus', YES_NO),
    sleepMedication: mapCode(row, 'hist_medSleepStatus', YES_NO),
    weightLossMedication: mapCode(row, 'hist_weightLossStatus', YES_NO),
    hasAllergies: yn(row, 'hist_AllergiesStatus'),
    allergies: text(row.hist_AllergiesStatus) === '1' ? text(row.hist_AllergiesText) || '-' : null,
    alcohol: mapCode(row, 'hist_alcoholStatus', YES_NO_OCC),
    smoking: mapCode(row, 'hist_smokeStatus', YES_NO_OCC),
    exercise: mapCode(row, 'hist_exerciseStatus', YES_NO_OCC),
    followsDiet: yn(row, 'hist_specificDietStatus'),
    dietName: text(row.hist_specificDietStatus) === '1' ? text(row.hist_specificDietName) || '-' : null,
    relationship: [
      on(row, 'hist_AbusiveVal') ? 'abusive' : '',
      on(row, 'hist_ConflictedVal') ? 'conflicted' : '',
      on(row, 'hist_HealthyVal') ? 'healthy' : '',
    ].filter(Boolean),
    relationshipSituation: nullIfEmpty(text(row.hist_relationshipSituation)),
  };

  const mrsDate = dateOf(row.hist_MRSDate);
  const mrsScale = mrsDate
    ? {
        date: mrsDate,
        ...Object.fromEntries(
          Object.entries(MRS).map(([col, key]) => [key, Math.min(4, number(text(row[col])) ?? 0)]),
        ),
      }
    : null;

  const symptoms = pick(row, SYMPTOMS);
  const additionalSymptoms = {
    symptoms,
    other: nullIfEmpty(text(row.hist_OtherAdditionalText)),
  };

  const imaging = {
    pelvicScan: scan(row, 'hist_pelvicScanStatus', 'hist_imagingPelvicScan', 'hist_pelvicScanDate'),
    pelvicScanDaysAfterPeriod: nullIfEmpty(text(row.hist_imagingPelvicDaysScan)),
    dexaScan: scan(row, 'hist_dexaScanStatus', 'hist_imagingDexaScan', 'hist_dexaScanDate'),
    mammogram: scan(row, 'hist_mammogramStatus', 'hist_imagingMammogram', 'hist_mammogramDate'),
    breastUltrasound: scan(
      row,
      'hist_breastUltraSoundStatus',
      'hist_imagingbreastUltraSound',
      'hist_breastUltraSoundDate',
    ),
  };

  const clinicalAssessment = {
    menopauseStage: pick(row, MENOPAUSE_STAGE),
    menopauseType: pick(row, MENOPAUSE_TYPE),
    diagnoses: pick(row, DIAGNOSES),
    complaints: pick(row, COMPLAINTS),
    clinicalStatus: pick(row, CLINICAL_STATUS),
    treatmentPlan: pick(row, TREATMENT_PLAN),
    plan: nullIfEmpty(text(row.hist_ClinicalPlanVal) || text(row.hist_doctorRemarkNote)),
  };

  const plans = {
    glpDietPlan: yn(row, 'hist_glpDietPlanStatus'),
    generalDietPlan: yn(row, 'hist_generalDietPlanStatus'),
    liverDetox: yn(row, 'hist_LiverDetoxStatus'),
    skinCareRoutine: yn(row, 'hist_SkinCareRoutineStatus'),
    hairCareRoutine: yn(row, 'hist_HairCareRoutineStatus'),
  };

  const referral = text(row.hist_custReferredTo)
    ? {
        referredTo: text(row.hist_custReferredTo),
        specialty: text(row.hist_custSpecialty) || '-',
        name: patient.name,
        dateOfBirth: dateOf(row.hist_custDOB),
        date: dateOf(row.hist_custReferredDate),
        referringDoctorName: text(row.hist_custReferredDoctorName) || '-',
        referringDoctorPhone: text(row.hist_custReferredDoctorNumber) || '-',
        referringDoctorAddress: text(row.hist_custReferredDoctorAddress) || '-',
        reason: text(row.hist_reasonForReferral) || '-',
      }
    : null;

  return {
    discussTopics: nullIfEmpty(text(row.hist_custDiscussConsultation)),
    majorComplaint: nullIfEmpty(text(row.hist_custMajorComplaint)),
    currentMedications: nullIfEmpty(text(row.hist_custCurrentMedication)),
    sections: {
      basic_info: basicInfo,
      medical_history: medicalHistory,
      mrs_scale: mrsScale,
      additional_symptoms: additionalSymptoms,
      imaging_results: imaging,
      clinical_assessment: clinicalAssessment,
      plans,
      referral,
    } as Record<string, unknown>,
  };
}
