# Clinical Fields (posSoft remarks form and prescriptions)

**Status: confirmed 2026-09-30 (decisions D1–D13 accepted as proposed). Implemented in B5.**

Sources: `admin/view/Appointments_remarks.html.php` (identical in `users/` and `doctor/`), `admin/models/_appointmentRemarkControllersState.php`, `_prescriptionControllersState.php`, `appointmentStateModel.php`, the print pages, `doctor/models/previousPrescriptionStateModel.php` and `backup/pos_dsm.sql`.

## How to read this file

- **Section key** is the `consultation_sections.section_key` in the new backend. Each section is saved on its own, as posSoft saves each tab with its own "Save & Next".
- **Field key** is the JSON key inside `data`. The posSoft column is given so B9 can migrate old rows.
- **Types:**
  - `bool`: a checkbox. posSoft stores 0/1.
  - `yesNo`: `yes` / `no`, or `null` when unanswered. posSoft stores 1 = Yes, 2 = No, 0 = unanswered.
  - `enum(...)`: one value from the list, or `null`. The posSoft number is shown as `n=value`.
  - `text`: plain text. `html`: CKEditor rich text. `date`: `YYYY-MM-DD`. `number`: a decimal.
- Every field is optional unless it is marked **required**.
- posSoft keeps one `customers_history` row per (patient, appointment), about 300 columns. The new backend has one `consultations` row per appointment and one `consultation_sections` row per section.

## Tabs in posSoft (visual order)

| #   | Tab                    | Shown when                                                          | New section key(s)                                                                                                                         |
| --- | ---------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Basic Information      | always                                                              | `basic_info`                                                                                                                               |
| 2   | Follow Up Form         | the appointment's visit type is `followup`                          | `follow_up`                                                                                                                                |
| 3   | Medical History        | always                                                              | `medical_history`                                                                                                                          |
| 4   | MRS Scale              | always                                                              | `mrs_scale`                                                                                                                                |
| 5   | Additional Symptoms    | always                                                              | `additional_symptoms`                                                                                                                      |
| 6   | Medical Records        | always                                                              | medical records and imaging files → `medical_records` table; Blood Work → `blood_work_results` table; Imagings → `imaging_results` section |
| 7   | Clinical Remarks       | always                                                              | status and remark on the appointment (B4); `clinical_assessment`                                                                           |
| 8   | Referred to Specialist | `clinical_assessment.treatmentPlan` includes `referredToSpecialist` | `referral`                                                                                                                                 |
| 9   | Prescription           | always                                                              | `prescriptions` + `prescription_items`                                                                                                     |
| 10  | Educational Resources  | always                                                              | `plans`                                                                                                                                    |

Outside the remarks page, the BHRT modal on the appointment list maps to `bhrt_status_log`.

---

## 1. `basic_info`: Basic Information

posSoft writes name, age, city and country straight onto the patient (`customers`), and the other fields onto the history row. The new backend does the same: those four fields update the global patient, with an audit log entry.

| Label               | Field key            | Type                                     | Values / rules                                                                               | posSoft column                           |
| ------------------- | -------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Name *              | → `patients.name`    | text                                     | **required**                                                                                 | `customers.cust_name`                    |
| Age *               | → `patients.age`     | integer 0–150                            | **required**                                                                                 | `customers.cust_age`                     |
| City *              | → `patients.city`    | text                                     | **required**                                                                                 | `customers.cust_city`                    |
| Country *           | → `patients.country` | text                                     | **required**                                                                                 | `customers.cust_country`                 |
| Weight in KGs *     | `weightKg`           | number                                   | **required**                                                                                 | `hist_custWeight`                        |
| Height in Feet *    | `heightFeet`         | number                                   | **required**; decimal feet (5.4 = 5.4 ft)                                                    | `hist_custHeight`                        |
| BMI                 | `bmi`                | number, computed                         | weight / (feet × 0.3048)²; stored rounded to 2 decimals                                      | `hist_custBMI` ("23.41 - Normal Weight") |
| BMI category        | `bmiCategory`        | enum, computed                           | `<18.5` underweight, `<25` normal, `<30` overweight, `<35` obesity, otherwise severe_obesity | part of `hist_custBMI`                   |
| Waist Circumference | `waistCircumference` | text                                     |                                                                                              | `hist_custWaistCircumference`            |
| Marital Status *    | `maritalStatus`      | enum(single, married, divorced, widowed) | **required**                                                                                 | `hist_custmaritStatus` (text)            |
| For how many year?  | `marriedYears`       | text                                     | shown and required when maritalStatus ≠ single                                               | `hist_custMarriedYear`                   |
| Kids                | `hasKids`            | yesNo                                    | shown and required when maritalStatus ≠ single                                               | `hist_custkidStatus` (1/2)               |
| How many Children?  | `kidsDetails`        | text                                     | shown and required when hasKids = yes                                                        | `hist_custkidDetails`                    |
| Education           | `education`          | text                                     |                                                                                              | `hist_custEducation`                     |
| Occupation          | `occupation`         | text                                     |                                                                                              | `hist_custOccupation`                    |

The page also shows two read-only lists: earlier remarks of this patient, and links to their previous and new prescriptions. The history endpoint provides these.

---

## 2. `follow_up`: Follow Up Form (visit type = followup)

| Label                                                                                                                                                  | Field key                      | Type  | Values                                                                                                                       | posSoft column                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| PGIC: since starting treatment, how would you describe the change in your overall condition?                                                           | `pgic`                         | enum  | 1=very_much_improved, 2=much_improved, 3=minimally_improved, 4=no_change, 5=minimally_worse, 6=much_worse, 7=very_much_worse | `hist_globalImpressionCondition`    |
| What are the top 3 things you would like to discuss in your consultation?                                                                              | `discussTopics`                | text  | shared with `medical_history` (see decision D6)                                                                              | `hist_custDiscussConsultation`      |
| Major Complaint                                                                                                                                        | `majorComplaint`               | text  | shared, see D6                                                                                                               | `hist_custMajorComplaint`           |
| Current Medications                                                                                                                                    | `currentMedications`           | text  | shared, see D6                                                                                                               | `hist_custCurrentMedication`        |
| Anything else you would like your doctor to know before today's visit?                                                                                 | `beforeVisitNote`              | text  |                                                                                                                              | `hist_custBeforeVisit`              |
| **About your health:** Are you currently using hormone therapy?                                                                                        | `usingHormoneTherapy`          | yesNo |                                                                                                                              | `hist_hormoneStatus`                |
| Since your last visit, has your hormone therapy been?                                                                                                  | `hormoneTherapySinceLastVisit` | enum  | 1=continuous, 2=interrupted, 3=stopped                                                                                       | `hist_hormoneLastStatus`            |
| Reason for interruption                                                                                                                                | `interruptionReason`           | text  | required when interrupted (posSoft never enforced this)                                                                      | `hist_hormoneInterruption`          |
| Are you still having periods?                                                                                                                          | `stillHavingPeriods`           | yesNo |                                                                                                                              | `hist_stillPeriodsStatus`           |
| Did you experience any spotting/bleeding after starting HRT?                                                                                           | `spottingAfterHrt`             | yesNo |                                                                                                                              | `hist_spottingBleedingStatus`       |
| **Medical History:** Any changes to your medical history since your last appointment?                                                                  | `medicalHistoryChanged`        | yesNo |                                                                                                                              | `hist_medicalHistoryStatus`         |
| **Medication History:** Started any new medications since your last consultation at DSM?                                                               | `newMedications`               | yesNo |                                                                                                                              | `hist_newMedicationsStatus`         |
| Reduced the dose or frequency of any medications since starting hormone treatment?                                                                     | `reducedMedications`           | yesNo |                                                                                                                              | `hist_reducedMedicationsStatus`     |
| Stopped taking any medications since starting hormone treatment?                                                                                       | `stoppedMedications`           | yesNo |                                                                                                                              | `hist_stoppedMedicationsStatus`     |
| If your symptoms improved and you reduced or stopped medications, was this due to hormone treatment?                                                   | `improvementCause`             | enum  | 1=hormone_treatment, 2=new_medication, 3=not_sure_both, 4=not_applicable, 5=other                                            | `hist_symptomsImprovedStatus`       |
| Needed antibiotics for a UTI since your last consultation?                                                                                             | `utiAntibiotics`               | yesNo |                                                                                                                              | `hist_tractInfectionStatus`         |
| **Adverse Events:** Any new or unexpected adverse event or significant medical problem while on hormone therapy?                                       | `adverseEvent`                 | yesNo |                                                                                                                              | `hist_adverseEventsHormoneStatus`   |
| If yes, please specify                                                                                                                                 | `adverseEventDetails`          | text  | required when adverseEvent = yes                                                                                             | `hist_adverseEventsHormoneSpecify`  |
| Adverse events may include … (bleeding, DVT/VTE/PE, stroke/TIA, cardiovascular event, breast or endometrial disease, other cancer, hospitalization, …) | `adverseEventOther`            | text  |                                                                                                                              | `hist_adverseEventsHormoneOther`    |
| **Screening:** Up to date with your cervical screening?                                                                                                | `cervicalScreeningUpToDate`    | yesNo |                                                                                                                              | `hist_dateCervicalScreeningsStatus` |
| Up to date with your breast screening?                                                                                                                 | `breastScreeningUpToDate`      | yesNo |                                                                                                                              | `hist_dateBeastScreeningsStatus`    |
| Had a DEXA scan since your last appointment?                                                                                                           | `dexaSinceLastVisit`           | yesNo |                                                                                                                              | `hist_dateDEXAScreeningsStatus`     |
| Blood pressure checked in the last 12 months?                                                                                                          | `bloodPressureChecked`         | yesNo |                                                                                                                              | `hist_dateBloodPressureStatus`      |

---

## 3. `medical_history`: Medical History

### 3.1 Consultation topics

| Label                                                                     | Field key        | Type | posSoft column                 |
| ------------------------------------------------------------------------- | ---------------- | ---- | ------------------------------ |
| What are the top 3 things you would like to discuss in your consultation? | `discussTopics`  | text | `hist_custDiscussConsultation` |
| Major Complaint                                                           | `majorComplaint` | text | `hist_custMajorComplaint`      |

### 3.2 Hormones, contraception, periods

| Label                                         | Field key               | Type  | Values / rules                                            | posSoft column                      |
| --------------------------------------------- | ----------------------- | ----- | --------------------------------------------------------- | ----------------------------------- |
| Have you ever used hormone therapy?           | `hormoneTherapy`        | enum  | 1=never, 2=currently_using, 3=previously_used             | `hist_hormoneTreatStatus`           |
| Which hormones have you used?                 | `hormonesUsed`          | text  |                                                           | `hist_hormoneUsedStatus`            |
| Are you using any form of contraception?      | `contraception`         | enum  | 1=yes, 2=no, 3=not_needed                                 | `hist_contraceptionStatus`          |
| Are you still having periods?                 | `havingPeriods`         | yesNo |                                                           | `hist_periodsStatus`                |
| Last menstrual period date                    | `lastPeriodDate`        | date  | shown and required when havingPeriods = yes               | `hist_custPeriodsDate`              |
| Cycle                                         | `cycle`                 | enum  | 1=regular, 2=irregular; required when havingPeriods = yes | `hist_periodsCycleStatus`           |
| Periods flow                                  | `flow`                  | enum  | 1=normal, 2=heavy, 3=low; shown when a cycle is chosen    | `hist_periodsFlowStatus`            |
| DUB (Dysfunctional Uterine Bleed)             | `dub`                   | bool  | shown when cycle = irregular (see D8)                     | `hist_DUBVal`                       |
| Oligomenorrhea (Infrequent)                   | `oligomenorrhea`        | bool  | shown when cycle = irregular (see D8)                     | `hist_OligomenorrheaVal`            |
| (periods note, shown when havingPeriods = no) | `periodsNote`           | text  |                                                           | `hist_custPeriodTextArea`           |
| Have you been diagnosed with menopause?       | `menopauseDiagnosed`    | yesNo |                                                           | `hist_diagnosedWithMenopauseStatus` |
| Age at which menopause was diagnosed          | `menopauseDiagnosedAge` | text  |                                                           | `hist_diagnosedAgeMenopauseStatus`  |

### 3.3 Medical conditions: "Have you ever had any of the following medical conditions?"

Stored as `conditions: string[]`, one value per ticked box. posSoft column = `hist_<Name>Val`.

| Group           | Values (label → value)                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cancer          | Breast Cancer → `breast_cancer` · Endometrial Cancer → `endometrial_cancer` · Ovarian Cancer → `ovarian_cancer` · BRCA 1 / BRCA 2 → `brca` · Lynch Syndrome → `lynch_syndrome` · Any Other Cancer → `other_cancer` |
| Hormonal        | Hyperthyroidism → `hyperthyroidism` · Hypothyroidism → `hypothyroidism` · Endometriosis → `endometriosis` · Premenstrual Syndrome (PMS) → `pms` · Polycystic Ovary Syndrome (PCOS) → `pcos`                        |
| Metabolic       | Diabetes → `diabetes` · Insulin Resistance → `insulin_resistance` · Dyslipidemia → `dyslipidemia` · NAFLD → `nafld`                                                                                                |
| Musculoskeletal | Osteopenia → `osteopenia` · Osteoporosis → `osteoporosis` · Osteoarthritis → `osteoarthritis` · Rheumatoid Arthritis → `rheumatoid_arthritis` · Gout → `gout`                                                      |
| Cardiac         | Heart Disease → `heart_disease` · Hypertension → `hypertension` · Deep Vein Thrombosis (DVT) → `dvt` · Pulmonary Embolism → `pulmonary_embolism` · TIA → `tia`                                                     |
| Mental          | Anxiety → `anxiety` · Depression → `depression` · Chronic Fatigue/ME (+Fibromyalgia) → `chronic_fatigue_me` · Post-natal Depression (PND) → `pnd` · Premenstrual Dysphoric Disorder (PMDD) → `pmdd`                |
| Neurological    | Migraine or Severe Headaches → `migraine` · Epilepsy → `epilepsy` · Multiple Sclerosis → `multiple_sclerosis` · Memory Issues → `memory_issues` · Stroke → `stroke`                                                |
| Autoimmune      | Lupus / SLE → `lupus_sle` · Any Skin Disease → `skin_disease`                                                                                                                                                      |
| Liver / GI      | Liver Disease → `liver_disease` · Chronic Reflux → `chronic_reflux` · Celiac Disease → `celiac_disease` · IBS → `ibs` · H - Pylori → `h_pylori`                                                                    |
| Genitourinary   | Recurrent UTI → `recurrent_uti` · Vaginal Infections → `vaginal_infections` · STD → `std`                                                                                                                          |

| Label     | Field key         | Type | posSoft column              |
| --------- | ----------------- | ---- | --------------------------- |
| Any Other | `otherConditions` | text | `hist_AnyOtherDiagnosedVal` |

### 3.4 Surgical History

Stored as `surgeries: { type, date | null }[]`, one entry per ticked surgery. posSoft keeps a checkbox plus a date per surgery: `hist_<Name>Val` and `hist_<Name>Date`.

| Label                 | `type` value                                           |
| --------------------- | ------------------------------------------------------ |
| Hysterectomy          | `hysterectomy`                                         |
| Ovaries Removed       | `ovaries_removed`                                      |
| C-Section             | `c_section`                                            |
| Tubal Ligation        | `tubal_ligation`                                       |
| Myomectomy            | `myomectomy`                                           |
| Endometriosis Surgery | `endometriosis_surgery`                                |
| Breast Surgery        | `breast_surgery`                                       |
| Bariatric Surgery     | `bariatric_surgery`                                    |
| Other                 | `other`; `otherSurgery` text (`hist_OtherSurgeryText`) |

### 3.5 Family History

Question: "Has your mother, father, sister, or another close family member ever been diagnosed with any of the following conditions?" posSoft keeps relatives and conditions as two separate lists (see D7).

| Field key          | Type     | Values (label → value)                                                                                                                                                                                                                                                                                                    | posSoft columns                                    |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `familyRelatives`  | string[] | Mother → `mother` · Father → `father` · Sister → `sister` · Any Close Family Member → `close_family`                                                                                                                                                                                                                      | `hist_family{Mother,Father,Sister,Close}StatusVal` |
| `familyConditions` | string[] | Breast Cancer → `breast_cancer` · Ovarian Cancer → `ovarian_cancer` · Endometrial Cancer → `endometrial_cancer` · Osteoporosis → `osteoporosis` · Hip Fracture → `hip_fracture` · Heart Disease → `heart_disease` · Diabetes → `diabetes` · Early Menopause → `early_menopause` · Dementia → `dementia` · Other → `other` | `hist_family<Name>Val`                             |
| `familyOther`      | text     |                                                                                                                                                                                                                                                                                                                           | `hist_OtherfamilyText`                             |

### 3.6 Medications, allergies, lifestyle, relationship

| Label                                                                                                                                       | Field key               | Type     | Values / rules                                                                                               | posSoft column                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Current Medications                                                                                                                         | `currentMedications`    | text     |                                                                                                              | `hist_custCurrentMedication`                               |
| Needed antibiotics for a UTI in the last 12 months?                                                                                         | `utiAntibiotics12m`     | yesNo    |                                                                                                              | `hist_antibioticsStatus`                                   |
| Taking medication for pain, nerve pain or migraines (paracetamol, ibuprofen, tramadol, gabapentin, amitriptyline)?                          | `painMedication`        | yesNo    |                                                                                                              | `hist_medicationStatus`                                    |
| Taking or ever prescribed medication for mood, anxiety, depression or other mental health conditions (fluoxetine, sertraline, diazepam, …)? | `moodMedication`        | yesNo    |                                                                                                              | `hist_anxietyMoodStatus`                                   |
| Taking medications or supplements for sleep (zopiclone, zolpidem, melatonin, magnesium, antihistamines)?                                    | `sleepMedication`       | yesNo    |                                                                                                              | `hist_medSleepStatus`                                      |
| Taking weight-loss medication (semaglutide/Wegovy, tirzepatide/Mounjaro)?                                                                   | `weightLossMedication`  | yesNo    |                                                                                                              | `hist_weightLossStatus`                                    |
| Any allergies to medications, foods or other substances?                                                                                    | `hasAllergies`          | yesNo    |                                                                                                              | `hist_AllergiesStatus`                                     |
| (allergy details)                                                                                                                           | `allergies`             | text     | required when hasAllergies = yes                                                                             | `hist_AllergiesText`                                       |
| Do you take alcohol?                                                                                                                        | `alcohol`               | enum     | 1=yes, 2=no, 3=occasionally                                                                                  | `hist_alcoholStatus`                                       |
| Do you smoke?                                                                                                                               | `smoking`               | enum     | 1=yes, 2=no, 3=occasionally                                                                                  | `hist_smokeStatus`                                         |
| Do you exercise regularly?                                                                                                                  | `exercise`              | enum     | 1=yes, 2=no, 3=occasionally                                                                                  | `hist_exerciseStatus`                                      |
| Are you following a specific diet plan?                                                                                                     | `followsDiet`           | yesNo    |                                                                                                              | `hist_specificDietStatus`                                  |
| (diet name)                                                                                                                                 | `dietName`              | text     | required when followsDiet = yes. posSoft lost this value because its column was an integer.                  | `hist_specificDietName`                                    |
| Relationship status                                                                                                                         | `relationship`          | string[] | Abusive → `abusive` · Conflicted → `conflicted` · Healthy → `healthy` (several can be ticked, as in posSoft) | `hist_AbusiveVal`, `hist_ConflictedVal`, `hist_HealthyVal` |
| What is your current relationship situation?                                                                                                | `relationshipSituation` | text     |                                                                                                              | `hist_relationshipSituation`                               |

The posSoft "Screening" block in this tab (cervical, breast and DEXA screening) is commented out in the HTML and has no input, so it is not carried over. The Follow Up tab has its own screening questions.

---

## 4. `mrs_scale`: Menopause Rating Scale

Every item is scored 0–4: 0 None, 1 Mild, 2 Moderate, 3 Severe, 4 Very Severe. posSoft column = `hist_<key>`.

| Label                                                                         | Field key               | Subscale      | posSoft column                  |
| ----------------------------------------------------------------------------- | ----------------------- | ------------- | ------------------------------- |
| Date *                                                                        | `date`                  | **required**  | `hist_MRSDate`                  |
| Hot flushes, sweating, episodes of heat                                       | `hotFlushes`            | somatic       | `hist_hotFlushesVal`            |
| Heart discomfort (palpitations, awareness of heartbeat, chest tightness)      | `heartDiscomfort`       | somatic       | `hist_heartDiscomfortVal`       |
| Sleep problems (difficulty falling asleep, waking early, disturbed sleep)     | `sleepProblems`         | somatic       | `hist_sleepProblemsVal`         |
| Joint and muscle discomfort (pain, stiffness, aches)                          | `jointMuscleDiscomfort` | somatic       | `hist_jointMuscleDiscomfortVal` |
| Depressive mood (low mood, crying, hopelessness)                              | `depressiveMood`        | psychological | `hist_depressiveMoodVal`        |
| Irritability                                                                  | `irritability`          | psychological | `hist_irritabilityVal`          |
| Anxiety (inner tension, panic, nervousness)                                   | `anxiety`               | psychological | `hist_anxietyInnerVal`          |
| Physical and mental exhaustion (fatigue, poor concentration, memory problems) | `exhaustion`            | psychological | `hist_mentalexhaustionVal`      |
| Sexual problems (reduced desire, satisfaction, discomfort during intercourse) | `sexualProblems`        | urogenital    | `hist_sexualProblemsVal`        |
| Bladder problems (urgency, frequency, urinary leakage)                        | `bladderProblems`       | urogenital    | `hist_bladderProblemsVal`       |
| Vaginal dryness (dryness, burning, discomfort)                                | `vaginalDryness`        | urogenital    | `hist_vaginalDrynessVal`        |

**Scores are computed on the server and never stored,** as in posSoft:

- Somatic: sum of 4 items, max 16.
- Psychological: sum of 4 items, max 16.
- Urogenital: sum of 3 items, max 12.
- Total: sum of all 11, max 44. `percentage` = total × 100 / 44.
- Severity band (see D5): 0–4 none, 5–8 mild, 9–16 moderate, 17+ severe. This is posSoft's form badge.

An unanswered item stays `null`. posSoft saved it as 0, so "not assessed" and "none" looked the same. `null` counts as 0 in the sums. The MRS history chart is an endpoint: all `mrs_scale` sections of the patient in this branch, ordered by date.

---

## 5. `additional_symptoms`: Additional Symptoms

Stored as `symptoms: string[]` plus `other` text. posSoft column = `hist_<Name>Val` (0/1).

| Group                      | Values (label → value)                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hair / Skin / Nails        | Hair Loss → `hair_loss` · Increased Facial Hair → `increased_facial_hair` · Skin Issues → `skin_issues` · Dry Skin → `dry_skin` · Skin Itching → `skin_itching` · Crawling Sensation → `crawling_sensation` · Nail Changes → `nail_changes` · Change in Body Odor → `body_odor_change`                                                        |
| Weight / Metabolic         | Weight Gain → `weight_gain` · Weight Loss → `weight_loss` · Belly Fat → `belly_fat` · Food or Sugar Cravings → `food_sugar_cravings`                                                                                                                                                                                                          |
| Musculoskeletal / Physical | Decreased Physical Strength → `decreased_strength` · Decreased Stamina → `decreased_stamina` · Low Backache → `low_backache` · Frozen Shoulder → `frozen_shoulder` · Heel Pain → `heel_pain` · Clicking Jaw / TMJ Symptoms → `clicking_jaw_tmj`                                                                                               |
| Neurological / Sensory     | Brain Fog / Memory Issues → `brain_fog` · Headaches → `headaches` · Migraines → `migraines` · Dizziness / Vertigo → `dizziness_vertigo` · Ear Ringing / Tinnitus → `tinnitus` · Burning Soles / Feet → `burning_soles` · Taste Changes → `taste_changes` · Increased Sense of Smell → `increased_smell` · Hearing Changes → `hearing_changes` |
| Eyes                       | Dry Eyes → `dry_eyes` · Eyesight / Vision Changes → `vision_changes`                                                                                                                                                                                                                                                                          |
| Gastrointestinal           | Bloating → `bloating` · Gas / Gas Pains → `gas` · Constipation → `constipation` · Diarrhea → `diarrhea` · Heart Burn → `heartburn`                                                                                                                                                                                                            |
| Urinary / Genital          | Recurrent UTIs → `recurrent_utis` · Stress Urinary Incontinence (leaking with coughing/laughing) → `stress_incontinence` · Vaginal Itching → `vaginal_itching`                                                                                                                                                                                |
| Behavioral / Social        | Wanting to Be Alone / Social Withdrawal → `social_withdrawal` · Accomplishing Less Than Previously → `accomplishing_less`                                                                                                                                                                                                                     |
| Relationship / Intimacy    | Marital Conflicts → `marital_conflicts` · Avoiding Intimacy → `avoiding_intimacy` · Dissatisfaction With Personal Life → `personal_life_dissatisfaction`                                                                                                                                                                                      |
| Voice                      | Voice Changes → `voice_changes`                                                                                                                                                                                                                                                                                                               |

| Label          | Field key | Type | posSoft column             |
| -------------- | --------- | ---- | -------------------------- |
| Other Symptoms | `other`   | text | `hist_OtherAdditionalText` |

Three posSoft columns have no input on the form, and posSoft reset them to 0 on every save: `hist_LackoftoleranceRageVal`, `hist_LowMotivationVal` and `hist_VaginalDrynessSymVal`. They are migrated only if they hold data.

---

## 6. Medical Records tab

### 6.1 Medical records and imaging files → `medical_records` + `medical_record_files` (private bucket `medical-records`)

| Label                                 | Field           | Type                          | Notes                                                                      | posSoft column          |
| ------------------------------------- | --------------- | ----------------------------- | -------------------------------------------------------------------------- | ----------------------- |
| (form used)                           | `type`          | enum(medical_record, imaging) | posSoft told them apart by the text "Medical Records" / "Imagings Records" | `med_record_status`     |
| Date                                  | `date`          | date                          | defaults to today; posSoft could not change it                             | `med_record_date`       |
| Upload (several files, paste allowed) | files           | file[]                        | images or PDF, 10 MB each. posSoft stored comma-separated names.           | `med_record_screenshot` |
| Additional Notes                      | `note`          | text                          |                                                                            | `med_record_note`       |
| (new)                                 | `appointmentId` | uuid, optional                | posSoft did not link records to the appointment                            | —                       |

Records are listed per patient, newest first, and can be removed (soft delete).

### 6.2 Blood Work → `blood_work_results` (one row per test)

posSoft stored up to 9 tests in one row, each with its own date. The new backend stores one row per test: `patient_id`, `branch_id`, `consultation_id` (nullable), `test`, `value` (numeric), `unit`, `test_date`. A value of 0 or blank meant "not done" in posSoft, so no row is created for it.

| Test (label)         | `test` value         | Unit                                    | posSoft columns                         |
| -------------------- | -------------------- | --------------------------------------- | --------------------------------------- |
| FSH                  | `fsh`                | mIU/mL                                  | `cbw_bloodNumbFSH` / `cbw_bloodDateFSH` |
| Estradiol            | `estradiol`          | pg/mL                                   | `…Estradiol`                            |
| Testosterone (Free)  | `testosterone_free`  | pg/mL                                   | `…TestosteroneFree`                     |
| Testosterone (Total) | `testosterone_total` | ng/dL                                   | `…TestosteroneTotal`                    |
| DHEA-Sulphate        | `dhea_s`             | µg/dL                                   | `…DHEASulphate`                         |
| Vit D3               | `vit_d3`             | µg/dL (as labelled in posSoft; see D10) | `…VitD3`                                |
| TSH                  | `tsh`                | µIU/mL                                  | `…TSH`                                  |
| Ferritin             | `ferritin`           | ng/mL                                   | `…Ferritin`                             |
| B12                  | `b12`                | pg/mL                                   | `…B12`                                  |

- The test list is a Postgres enum, so new tests can be added later with a migration.
- The chart and pivot table ("one row per test, one column per date") become a read endpoint.
- Edit and delete work on one result, not on the whole posSoft row.

### 6.3 `imaging_results`: Imagings (scan results)

Each scan has `{ status, date, abnormalDetails }`. `status` is an enum: 1=normal, 2=abnormal, 3=not_done. `abnormalDetails` is text, required when status = abnormal.

| Scan                                                                    | Field key                           | posSoft columns (status / date / detail)                                                     |
| ----------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------- |
| Pelvic Scan                                                             | `pelvicScan`                        | `hist_pelvicScanStatus` / `hist_pelvicScanDate` / `hist_imagingPelvicScan`                   |
| (pelvic) How many days after your period was the pelvic scan performed? | `pelvicScan.daysAfterPeriod` (text) | `hist_imagingPelvicDaysScan`                                                                 |
| Dexa Scan                                                               | `dexaScan`                          | `hist_dexaScanStatus` / `hist_dexaScanDate` / `hist_imagingDexaScan`                         |
| Mammogram                                                               | `mammogram`                         | `hist_mammogramStatus` / `hist_mammogramDate` / `hist_imagingMammogram`                      |
| Breast Ultrasound                                                       | `breastUltrasound`                  | `hist_breastUltraSoundStatus` / `hist_breastUltraSoundDate` / `hist_imagingbreastUltraSound` |

---

## 7. `clinical_assessment`: Clinical Remarks

The appointment **status** (booked/completed/cancelled), the **remark** (html) and the **remark screenshots** already exist from B4 (`POST /branch/appointments/:id/status`). The rest of the tab is this section.

| Group                    | Field key                  | Values (label → value)                                                                                                                                                                                                                                                                                                   | posSoft column                                                                                                                            |
| ------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Menopause Stage          | `menopauseStage: string[]` | Perimenopause → `perimenopause` · Early menopause (40–44 years) → `early_menopause` · Menopause at typical age (45–55 years) → `menopause` · Late menopause (after age 55) → `late_menopause` · Postmenopause → `postmenopause`                                                                                          | `hist_PremenopauseReVal`, `hist_EarlyPerimenopauseReVal`, `hist_MenopauseReVal`, `hist_LatePerimenopauseReVal`, `hist_PostmenopauseReVal` |
| Type                     | `menopauseType: string[]`  | Natural menopause → `natural` · Surgical menopause → `surgical` · Induced menopause → `induced` · Premature ovarian insufficiency (POI, before age 40) → `poi`                                                                                                                                                           | `hist_NaturalMenopauseReVal`, `hist_SurgicalMenopauseReVal`, `hist_InducedMenopauseReVal`, `hist_POIReVal`                                |
| Other Clinical diagnoses | `diagnoses: string[]`      | Osteopenia → `osteopenia` · Osteoporosis → `osteoporosis` · PCOS → `pcos` · PMS/PMDD → `pms_pmdd` · Endometriosis → `endometriosis` · Adenomyosis → `adenomyosis` · Ovarian Cyst → `ovarian_cyst`                                                                                                                        | `hist_<Name>ReVal`                                                                                                                        |
| Complaints               | `complaints: string[]`     | Vasomotor symptoms → `vasomotor` · Genitourinary syndrome of menopause (GSM) → `gsm` · HSDD → `hsdd` · Mood symptoms → `mood` · Sleep disorder → `sleep_disorder` · Cognitive symptoms → `cognitive` · Weight gain / Metabolic syndrome → `weight_metabolic` · Hair loss → `hair_loss` · Acne → `acne` · Other → `other` | `hist_<Name>ReVal`                                                                                                                        |
| Clinical Status          | `clinicalStatus: string[]` | Improved → `improved` · Stable → `stable` · Worsened → `worsened` · No change → `no_change` (several can be ticked, as in posSoft; see D9)                                                                                                                                                                               | `hist_ImprovedReVal` … `hist_NoChangeReVal`                                                                                               |
| Treatment Plan           | `treatmentPlan: string[]`  | Start BHRT → `start_bhrt` · Continue BHRT → `continue_bhrt` · Stop therapy → `stop_therapy` · Change formulation → `change_formulation` · Labs ordered → `labs_ordered` · Imaging ordered → `imaging_ordered` · Lifestyle counseling → `lifestyle_counseling` · Referred to specialist → `referred_to_specialist`        | `hist_<Name>ReVal`                                                                                                                        |
| Plan                     | `plan: text`               | posSoft never saved this field because of a name mismatch; it is saved now                                                                                                                                                                                                                                               | `hist_ClinicalPlanVal`                                                                                                                    |

Two posSoft columns have no input and were wiped on every save: `hist_IncreaseDoseReVal` and `hist_DecreaseDoseReVal`. The "Doctor Note" editor (`hist_doctorRemarkNote`) is commented out. None of these are carried over.

---

## 8. `referral`: Referred to Specialist

This section is available when `clinical_assessment.treatmentPlan` includes `referred_to_specialist`. There is one referral per consultation, as in posSoft. A letter endpoint returns the data for the print.

| Label                      | Field key                  | Type | Rules                                                               | posSoft column                   |
| -------------------------- | -------------------------- | ---- | ------------------------------------------------------------------- | -------------------------------- |
| Referred To *              | `referredTo`               | text | **required**                                                        | `hist_custReferredTo`            |
| Specialty *                | `specialty`                | text | **required**                                                        | `hist_custSpecialty`             |
| Date of Birth *            | → `patients.date_of_birth` | date | **required**; saved on the patient (posSoft saved it on each visit) | `hist_custDOB`                   |
| Date *                     | `date`                     | date | **required**, defaults to today                                     | `hist_custReferredDate`          |
| Referring Doctor Name *    | `referringDoctorName`      | text | **required**, defaults to the consultation doctor                   | `hist_custReferredDoctorName`    |
| Referring Doctor Number *  | `referringDoctorPhone`     | text | **required**                                                        | `hist_custReferredDoctorNumber`  |
| Referring Doctor Address * | `referringDoctorAddress`   | text | **required**                                                        | `hist_custReferredDoctorAddress` |
| Reason for Referral *      | `reason`                   | text | **required**                                                        | `hist_reasonForReferral`         |

The letter prints: company logo, "DSM REFERRAL FORM / Clinical Referral Slip", the date, Referral Information (to, specialty, referring doctor name, number and address), Patient Details (name, contact number, DOB, date), the reason, and a doctor's signature line.

---

## 9. `plans`: Educational Resources tab

| Label              | Field key         | Type  | posSoft column               |
| ------------------ | ----------------- | ----- | ---------------------------- |
| Glp Diet Plan?     | `glpDietPlan`     | yesNo | `hist_glpDietPlanStatus`     |
| General Diet Plan? | `generalDietPlan` | yesNo | `hist_generalDietPlanStatus` |
| Liver Detox?       | `liverDetox`      | yesNo | `hist_LiverDetoxStatus`      |
| Skin Care Routine? | `skinCareRoutine` | yesNo | `hist_SkinCareRoutineStatus` |
| Hair Care Routine? | `hairCareRoutine` | yesNo | `hist_HairCareRoutineStatus` |

posSoft shows no educational material here, only these five flags.

---

## 10. BHRT → `bhrt_status_log`

| Label         | Field           | Type           | Values                                    | posSoft                                                                                                                |
| ------------- | --------------- | -------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| BHRT Status * | `status`        | enum           | on, off, recommended, other; **required** | `customers_bhrt_details.bhrt_status` (text); `customers.cust_bhrt_status` 1=on, 2=off, 3=recommended, 0=other or unset |
| Date          | `date`          | date           | defaults to today                         | `bhrt_date`                                                                                                            |
| BHRT Note     | `note`          | html           |                                           | `bhrt_note`                                                                                                            |
| (new)         | `appointmentId` | uuid, optional | posSoft did not link it                   | —                                                                                                                      |

The newest entry sets `patients.bhrt_status`, which has these values from B4: none, on, off, recommended. `other` maps to `none` (see D4).

---

## 11. Prescriptions

### 11.1 Header

| Label                          | Field               | Type                    | Rules                                                         | posSoft column         |
| ------------------------------ | ------------------- | ----------------------- | ------------------------------------------------------------- | ---------------------- |
| Customer Name *                | `patientId`         | uuid                    | **required**; from the consultation when created there        | `pres_cust_id`         |
| Doctor Name *                  | `doctorId`          | uuid                    | **required**; a doctor user can only pick themselves          | `pres_doc_id`          |
| (new)                          | `consultationId`    | uuid, nullable          | posSoft stored no link to the appointment                     | —                      |
| Date *                         | `date`              | date                    | **required**, defaults to today                               | `pres_date`            |
| Diagnosis *                    | `diagnosis`         | text                    | **required**                                                  | `pres_diaganosis`      |
| Additional Notes (Blood Work)  | `notes.blood`       | text                    |                                                               | `pres_bloodNote`       |
| Additional Notes (Imaging)     | `notes.imaging`     | text                    |                                                               | `pres_imagingNote`     |
| Additional Notes (Supplements) | `notes.supplements` | text                    |                                                               | `pres_supplementsNote` |
| Additional Notes (Skin Care)   | `notes.skinCare`    | text                    |                                                               | `pres_skinCareNote`    |
| Additional Notes (Hair Care)   | `notes.hairCare`    | text                    |                                                               | `pres_hairCareNote`    |
| Plan of Treatment              | `planTreatment`     | html                    |                                                               | `pres_plantreatment`   |
| Follow up Date                 | `followupDate`      | date                    |                                                               | `pres_followup_date`   |
| (new)                          | `templateVersion`   | enum(current, previous) | `previous` is only for migrated `prescriptions_previous` rows | table name             |

### 11.2 Items → `prescription_items`

Each ticked checkbox becomes a row: `catalog_item_id`, `name`, `dose`, `instructions`, and `optional` (only the previous template used this). The catalog (`prescription_items_catalog`) is per branch and is seeded from the lists below.

- posSoft puts the dose inside the label. In the catalog, the label is split into `name` + `default_dose`, and the prescription keeps a copy of both.
- The "How to Use" paragraphs become `default_instructions`.
- Category values: `lab`, `imaging`, `genetic`, `supplement`, `medicine`, `glp`, `skin_care`, `hair_care`, `bhrt`.

#### Blood Work (category `lab`)

| Group                                            | Items (label → posSoft column)                                                                                                                                                                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline                                         | FSH (`pres_fsh`) · Estradiol (`pres_estradiol`) · Testosterone (free) (`pres_testosteroneFree`) · Testosterone (total) (`pres_testosteroneTotal`) · DHEA-Sulphate (`pres_dhea`) · Vit D3 (`pres_vitd`) · TSH (`pres_tsh`) · Ferritin (`pres_ferritin`) · B12 (`pres_b12`) |
| Hormones                                         | LH (`pres_LHVal`) · Serum Progesterone (`pres_progesterone`) · 17-Hydroxyprogesterone (17-OHP) (`pres_17HydroxyprogesteroneVal`) · SHBG (`pres_SHBGVal`) · AMH (`pres_amh`) · Prolactin (`pres_prolactin`) · Cortisol, AM (8–9 AM serum) (`pres_CortisolAMVal`)           |
| Cardiovascular / Metabolic                       | CBC (`pres_cbc`) · Fasting Lipid Panel (`pres_lipidPanel`) · ApoB (`pres_ApoBVal`) · Lipoprotein(a) — Lp(a) (`pres_LipoproteinAVal`) · HbA1c (`pres_hba1c`) · Fasting Insulin (`pres_insulin`) · Homocysteine (`pres_HomocysteineVal`)                                    |
| Thyroid                                          | Free T3 (`pres_t3`) · Free T4 (`pres_t4`) · Reverse T3 (`pres_ReverseT3Val`) · TPO Antibodies (`pres_TPOAntibodiesVal`)                                                                                                                                                   |
| Inflammation                                     | hs-CRP (`pres_hsCRPVal`) · ESR (`pres_ESRVal`) · CA-125 (`pres_CA125Val`)                                                                                                                                                                                                 |
| Liver Function                                   | ALT (`pres_ALTVal`) · AST (`pres_ASTVal`) · GGT (`pres_GGTVal`) · Alkaline Phosphatase (`pres_AlkalinePhosphataseVal`) · Total Bilirubin (`pres_TotalBilirubinVal`)                                                                                                       |
| Basic Chemistry / Metabolic                      | Uric Acid (`pres_UricAcidVal`) · Urine Albumin-to-Creatinine Ratio (UACR/ACR) (`pres_UACRVal`)                                                                                                                                                                            |
| Miscellaneous                                    | DHT (Dihydrotestosterone) (`pres_DHT`) · Zinc (`pres_zinc`) · Iron / TIBC / Transferrin Saturation (`pres_IronTIBCVal`) · Folate (`pres_FolateVal`)                                                                                                                       |
| Urine Studies                                    | Urinalysis (`pres_UrinalysisVal`) · Urine Culture (`pres_urineCulture`)                                                                                                                                                                                                   |
| Legacy (no input on today's form; still printed) | Basic Chemistry (`pres_chemistry`) · AST, ALT (`pres_ASTALT`) · ANA (`pres_ANA`) · LH Lab (`pres_LabsMyLH`), inactive in the catalog                                                                                                                                      |

#### Imaging (category `imaging`, Genetic Screening = `genetic`)

| Group                       | Items                                                                                                                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline                    | Screening Mammogram (`pres_scrennMamm`) · Pap Smear / HPV Testing (`pres_papSmear`) · Pelvic Ultrasound (`pres_pelvicUltra`) · Transvaginal Ultrasound (`pres_transVaginalUltra`) · DEXA Scan (`pres_dexaScan`) |
| Optional: Breast            | Breast Ultrasound (`pres_breastUltra`) · Diagnostic Mammogram (`pres_diagnosticMammogram`) · Breast MRI (`pres_breastMRI`)                                                                                      |
| Optional: Gynecologic       | Endometrial Biopsy (`pres_endometrialBiopsy`) · Saline Infusion Sonography (SIS) (`pres_salineInfusionSonography`)                                                                                              |
| Optional: Other Imaging     | Abdominal Ultrasound (`pres_abdominalUltra`) · Renal Ultrasound (`pres_renalUltra`)                                                                                                                             |
| Optional: Genetic Screening | BRCA1/BRCA2 Genetic Testing (`pres_brca12Genotype`) · MTHFR Genotyping (`pres_MTHF`)                                                                                                                            |

#### Supplements, medicines and GLP

| Category   | Name                                          | Default dose                                  | posSoft column        |
| ---------- | --------------------------------------------- | --------------------------------------------- | --------------------- |
| supplement | DSM VitD3+K2-MK7                              | 2 Gummies after meal                          | `pres_vitd3k2`        |
| supplement | DSM Magnesium Glycinate 800mg                 | Elemental 240mg at bedtime                    | `pres_magnesium`      |
| supplement | Omega 3 1000mg                                | day                                           | `pres_omega3`         |
| supplement | Collagen peptide                              | 10-15 gram daily                              | `pres_collagen`       |
| supplement | Curcumin                                      | one tab. 500mg twice a day                    | `pres_curcumin`       |
| supplement | DSM Creatine Monohydrate                      | 3-5 gram daily                                | `pres_creatine`       |
| supplement | CO-Q                                          | 100-200 mg/day                                | `pres_coq`            |
| supplement | NAC                                           | 600mg daily 30 minutes before food            | `pres_NAC600mg`       |
| medicine   | Ferinject (500mg)                             | IV infusion single dose                       | `pres_ferinject`      |
| medicine   | Ferrous Sulphate 325mg                        | orally once daily with Vit.C before breakfast | `pres_ferrousSulfate` |
| medicine   | Inj. Vitamin B12 (Methylcobalamin)            | 1000 mcg IM twice a week for two weeks        | `pres_VitaminB121`    |
| supplement | Vitamin B12 (Methylcobalamin)                 | 1000mcg orally once daily, before breakfast   | `pres_VitaminB122`    |
| medicine   | Spironolactone                                | 50 mg once daily by mouth                     | `pres_Spironolactone` |
| medicine   | TXA                                           | —                                             | `pres_TXA`            |
| glp        | Inj. Tirzepatide (Triza Trim / Tirzee) 2.5 mg | SC once weekly                                | `pres_Tirzee2mg`      |
| glp        | Inj. Tirzepatide 5 mg                         | SC once weekly                                | `pres_Tirzee5mg`      |
| glp        | Inj. Tirzepatide 7.5 mg                       | SC once weekly                                | `pres_Tirzee7mg`      |

#### Skin and hair care

| Category  | Name                  | posSoft column             |
| --------- | --------------------- | -------------------------- |
| skin_care | Radiance Repair Day   | `pres_RadianceRepairDay`   |
| skin_care | Radiance Repair Night | `pres_RadianceRepairNight` |
| hair_care | Hairsol - F           | `pres_HairsolF`            |

#### Treatments (category `bhrt`): product, dose options, How to Use

| Product                   | Dose options (each one a separate item)                                                                                                                                                                                                                                                                                                                   | How to Use (default instructions)                                                                                                                                                                                                                                                                                            | posSoft columns                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Serenogest 100mg          | Take one capsule every day at bed time · Take one capsule every day for 14 days every month · Take two capsules everyday for 14 days every month · Take two capsules at bedtime everyday for 21 days every month · Take two 100 mg capsules orally once daily at bedtime every month · Take one 100 mg capsules orally once daily for 21 days every month | Two options, stored as items: With Regular Periods: "Start 14 days before the expected date." · Irregular / Absent Periods: "Start at any time of the month."                                                                                                                                                                | `pres_progest1…4`, `pres_progest100`, `pres_progest1021`; `pres_progest5`, `pres_progest6` |
| Estradiol BHRT            | Apply 1/2 ml once daily (day or night) · Apply 1/2 ml twice daily (day and night)                                                                                                                                                                                                                                                                         | Apply to mid-thigh or mid arm on clean, dry skin. Gently massage until fully absorbed, and avoid washing the area for at least one hour after application.                                                                                                                                                                   | `pres_estradiol1`, `pres_estradiol2`                                                       |
| DSM Vaginal Estradiol     | Apply 1ml of DSM vaginal estradiol cream at bedtime                                                                                                                                                                                                                                                                                                       | Apply at bedtime to the internal and external vaginal/private areas using gentle massage. Use daily for 4 weeks, then continue maintenance therapy based on the patient's response, typically 3 times per week. Avoid sexual intercourse immediately after application. However, if intercourse occurs, no harm is expected. | `pres_estradiolVaginal`                                                                    |
| DSM Vaginal DHEA          | Apply 1ml of DSM vaginal DHEA cream at bedtime                                                                                                                                                                                                                                                                                                            | (same text as Vaginal Estradiol)                                                                                                                                                                                                                                                                                             | `pres_dheaVaginal`                                                                         |
| DSM Mixed Vaginal Therapy | Use 1ml of whichever cream you're applying.                                                                                                                                                                                                                                                                                                               | Use vaginal estrogen cream 4 nights per week and vaginal DHEA on the remaining 3 nights for a total of 4 weeks. For maintenance, continue with vaginal estrogen 2 nights per week and vaginal DHEA 2 nights per week.                                                                                                        | `pres_mixVaginal`                                                                          |
| Testofeme                 | Apply 1ml daily during the day time.                                                                                                                                                                                                                                                                                                                      | Apply to the inner mid-thigh on clean, dry skin and gently massage until absorbed. Use the right thigh for 2 weeks, then switch to the left thigh for the next 2 weeks. Keep alternating sides this way. Use daily for 4 months, then continue 2–3 times per week for maintenance, depending on symptoms and lab results.    | `pres_testostest`                                                                          |
| Estriol                   | Apply 1ml Estriol daily.                                                                                                                                                                                                                                                                                                                                  | Apply 1ml to the face, neck and back of the hands once daily on clean dry skin. Gently massage until fully absorbed. May be used with other skin care products and can be applied before or after any skin serums.                                                                                                           | `pres_estrio`                                                                              |

#### Prescription symptoms (42 columns, input commented out in posSoft)

The "If any symptoms you are Experiencing" block is commented out on the form, but the columns still exist and are printed. It is not part of the new catalog; old values are migrated as category `symptom`, inactive (see D12).

#### Previous-prescription template (`prescriptions_previous`, read-only archive)

Rows are migrated with `templateVersion = previous`. Their catalog items are seeded **inactive**, so old prescriptions print correctly but new ones cannot use them.

- **Labs**, each with an "Optional" flag → `prescription_items.optional`: FSH, LH, Progesterone, Estradiol, Testosterone (free + total), SHBG, TSH, T3/T4, DHEA-Sulfate, Vit B12+Folate, Ferritin/TIBC/Iron, Lipid Panel, HBA1C, Fasting Insulin, Magnesium RBC, 25 Hydroxy Vit D3, Copper, Zinc, Selenium, Calcium, AMH, Prolactin, CBC, Basic Chemistry, ESR, CRP.
- **Supplements:**
  - Magnesium Glycinate 300-400 bedtime
  - VitD3+K2 (5000+100mcg)
  - Cod liver Oil (Omega 3) 1000mg/day
  - Collagen peptide 10-15 gram daily
  - Curcumin one tab. 500mg twice a day
  - Creatine Monohydrate 3-5 gram daily
  - CO-Q 100-200 mg/day
  - Melatonin 3-12 mg/day Bedtime
  - Seed Cycling
  - Ashwagandha
  - Shilajit
  - Additional supplements recommended by doctor
- **Treatments:**
  - U-Progest 200mg one tab. bedtime x14 days every month
  - U-Progest 100mg one tab. bedtime every day
  - Progesterone 100 mg for 14 days at bedtime every month
  - Estradiol BHRT one Pump daily
  - DHT
  - Apply Estriol cream to the vaginal area nightly for 14 days, then 2-3 times per week (also usable on face and neck)
  - Testogel (apply daily to the inner thigh, a pea-sized amount)
- **Imaging:** DEXA, Screening Mammogram, Pelvic Ultrasound, Breast Ultrasound, Trans Vaginal Ultrasound.
- **Symptoms:** 30 checkboxes, migrated as category `symptom`.

### 11.3 What the prescription print shows

1. Doctor name, phone and details; company logo.
2. Patient name, date, age, city/country, diagnosis.
3. Blood Work (Baseline, then the Optional groups), then its note.
4. Imaging (Baseline, then Optional), then its note.
5. Supplements (and GLP), then its note; Skin Care, then its note; Hair Care, then its note.
6. Treatments with their How to Use text.
7. Plan of Treatment.
8. Signature and follow-up date.

posSoft hardcodes the signature image for two doctor ids. The new backend returns the data only; a doctor signature image (upload) can be added to the doctor profile (see D11).

---

## 12. Patient history timeline

posSoft's "Patient History" report shows, per visit:

- the patient, date and BMI;
- the menopause stage;
- age at menopause;
- the 11 MRS items and subscores;
- FSH, Estradiol and Total Testosterone;
- progesterone, estradiol, vaginal and testosterone treatments from a prescription;
- "Still on Treatment".

The B5 timeline endpoint returns all consultations (with their sections), prescriptions, blood work, BHRT entries and medical records of a patient for the current branch, or all branches for super_admin. A report in the posSoft shape comes in B7.

---

## Decisions to confirm

| #   | Question                                                                                                                                                            | Proposed                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | posSoft gives Front Desk exactly the same remarks form as admin, with every section. The plan says Front Desk gets "the non-clinical sections posSoft allows them". | Follow posSoft: Front Desk and Team Manager can fill every consultation section, but **not** prescriptions (they have no prescription menu in posSoft). Doctor and Branch Admin can do everything.                                |
| D2  | Basic Information edits name, age, city and country on the patient record.                                                                                          | Keep, with an audit log (posSoft behaviour).                                                                                                                                                                                      |
| D3  | Fix posSoft bugs that lose data.                                                                                                                                    | Yes: save the Clinical Plan; add remark screenshots instead of wiping them; do not wipe fields that have no input; store "not answered" as `null` instead of 0; enforce the conditional required fields posSoft meant to enforce. |
| D4  | BHRT "Other"                                                                                                                                                        | Keep `other` in the log; the patient's `bhrt_status` becomes `none` (posSoft maps Other to 0).                                                                                                                                    |
| D5  | MRS severity bands                                                                                                                                                  | Use posSoft's form badge bands (0–4 none, 5–8 mild, 9–16 moderate, 17+ severe), which match the published MRS. Also return the percentage. The posSoft history-table bands are dropped.                                           |
| D6  | "Top 3 things", "Major Complaint" and "Current Medications" appear on both Medical History and Follow Up and share one column in posSoft, so the last save wins.    | Store them once per consultation: both sections read and write the same three fields.                                                                                                                                             |
| D7  | Family history: posSoft cannot tell which relative had which condition.                                                                                             | Keep posSoft's two lists now. A relative × condition grid can be added later without losing data.                                                                                                                                 |
| D8  | DUB / Oligomenorrhea visibility differs between posSoft's server and JS.                                                                                            | Show them when the cycle is irregular (the JS rule users see).                                                                                                                                                                    |
| D9  | Clinical Status allows several ticks (Improved and Worsened together).                                                                                              | Keep posSoft (a list).                                                                                                                                                                                                            |
| D10 | Blood work units: Vit D3 is labelled µg/dL in posSoft.                                                                                                              | Keep the posSoft units now; the unit is stored per result, so it can be corrected later.                                                                                                                                          |
| D11 | Signature on prints                                                                                                                                                 | Add an optional signature image to the doctor profile (private storage) instead of hardcoding ids.                                                                                                                                |
| D12 | The 42 prescription symptoms are commented out in posSoft.                                                                                                          | Leave them out of new prescriptions; migrate old values as inactive `symptom` items.                                                                                                                                              |
| D13 | posSoft creates a new prescription on every save of the Prescription tab.                                                                                           | Allow several prescriptions per consultation (posSoft), each linked to the consultation. Editing is allowed for the doctor and Branch Admin, with an audit log entry.                                                             |
