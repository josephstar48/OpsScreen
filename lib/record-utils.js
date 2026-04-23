import { randomUUID } from "node:crypto";

export function sanitize(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function validateRecord(payload, isUpdate = false) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Request body must be a JSON object.");
  }

  if (!payload.syntheticConfirmed) {
    throw new Error("Synthetic-data confirmation is required.");
  }

  if (!sanitize(payload.scenarioName)) {
    throw new Error("Scenario name is required.");
  }

  if (!sanitize(payload.subjectId)) {
    throw new Error("Mock subject ID is required.");
  }

  if (!sanitize(payload.intakeDate)) {
    throw new Error("Intake date is required.");
  }

  if (isUpdate && !sanitize(payload.recordId)) {
    throw new Error("Record ID is required for updates.");
  }
}

export function normalizeRecord(payload, isUpdate = false) {
  const now = new Date().toISOString();
  return {
    recordId: payload.recordId || randomUUID(),
    scenarioName: sanitize(payload.scenarioName),
    exerciseName: sanitize(payload.exerciseName),
    intakeSite: sanitize(payload.intakeSite),
    intakeDate: sanitize(payload.intakeDate),
    screenedBy: sanitize(payload.screenedBy),
    languageSupport: sanitize(payload.languageSupport),
    subjectId: sanitize(payload.subjectId),
    firstName: sanitize(payload.firstName),
    lastName: sanitize(payload.lastName),
    alias: sanitize(payload.alias),
    dob: sanitize(payload.dob),
    nationality: sanitize(payload.nationality),
    groupMembers: sanitize(payload.groupMembers),
    immediateNeeds: sanitize(payload.immediateNeeds),
    medicalLevel: sanitize(payload.medicalLevel),
    safeguardingConcern: sanitize(payload.safeguardingConcern),
    currentStatus: sanitize(payload.currentStatus),
    propertyNotes: sanitize(payload.propertyNotes),
    welfareNotes: sanitize(payload.welfareNotes),
    originLocation: sanitize(payload.originLocation),
    transitPoint: sanitize(payload.transitPoint),
    destination: sanitize(payload.destination),
    arrivalMethod: sanitize(payload.arrivalMethod),
    consentScript: sanitize(payload.consentScript),
    additionalNotes: sanitize(payload.additionalNotes),
    referralDestination: sanitize(payload.referralDestination),
    followUpOwner: sanitize(payload.followUpOwner),
    followUpDate: sanitize(payload.followUpDate),
    classification: sanitize(payload.classification) || "Training use only",
    syntheticConfirmed: true,
    storageMode: "managed-postgres",
    createdAt: isUpdate ? sanitize(payload.createdAt) || now : now,
    updatedAt: now,
  };
}
