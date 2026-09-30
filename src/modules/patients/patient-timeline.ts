import { type Actor } from '../../lib/actor';
import { hasPermission } from '../../lib/permissions';
import { medicalRecordsService, patientRecordsTimeline } from '../clinical-records/clinical-records.service';
import { consultationsService } from '../consultations/consultations.service';
import { doctorsService } from '../doctors/doctors.service';
import { prescriptionsService } from '../prescriptions/prescriptions.service';
import { patientsService } from './patients.service';

export async function patientTimeline(actor: Actor, branchId: string | null, patientId: string) {
  const patient = await patientsService.get(patientId);
  const doctorId = branchId ? (await doctorsService.viewer(actor, branchId)).doctorId : null;
  const canSeePrescriptions = hasPermission(actor.role, 'prescriptions.view');
  const [consultations, prescriptions, records, medicalRecords] = await Promise.all([
    consultationsService.timelineEntries(branchId, patientId, doctorId),
    canSeePrescriptions ? prescriptionsService.timeline(branchId, patientId, doctorId) : Promise.resolve([]),
    patientRecordsTimeline(branchId, patientId),
    medicalRecordsService.timeline(branchId, patientId),
  ]);
  return {
    patient,
    scope: branchId ? 'branch' : 'all_branches',
    consultations,
    prescriptions,
    bloodWork: records.bloodWork,
    bhrt: records.bhrt,
    medicalRecords,
  };
}
