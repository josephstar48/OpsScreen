const STORAGE_KEY = "opsscreen-records-v1";
const DRAFT_KEY = "opsscreen-draft-v1";

const form = document.getElementById("screeningForm");
const recordsList = document.getElementById("recordsList");
const metrics = document.getElementById("metrics");
const saveStatus = document.getElementById("saveStatus");
const searchInput = document.getElementById("searchInput");
const installButton = document.getElementById("installButton");

let deferredInstallPrompt = null;
let records = loadRecords();

document.getElementById("saveDraftButton").addEventListener("click", saveDraft);
document.getElementById("newRecordButton").addEventListener("click", resetForm);
document.getElementById("exportJsonButton").addEventListener("click", exportJson);
document.getElementById("exportCsvButton").addEventListener("click", exportCsv);
document.getElementById("seedDemoButton").addEventListener("click", loadDemoRecord);
document.getElementById("printButton").addEventListener("click", () => window.print());
searchInput.addEventListener("input", renderRecords);
form.addEventListener("submit", handleSubmit);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) {
    return;
  }

  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.hidden = true;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js");
  });
}

hydrateDraft();
renderRecords();
renderMetrics();

function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? [];
  } catch {
    return [];
  }
}

function persistRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function saveDraft() {
  const draft = readFormData();
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  saveStatus.textContent = `Draft saved locally at ${new Date().toLocaleTimeString()}.`;
}

function hydrateDraft() {
  const savedDraft = localStorage.getItem(DRAFT_KEY);
  if (!savedDraft) {
    form.intakeDate.value = formatDateTimeLocal(new Date());
    return;
  }

  try {
    populateForm(JSON.parse(savedDraft));
    saveStatus.textContent = "Recovered your last local draft.";
  } catch {
    form.intakeDate.value = formatDateTimeLocal(new Date());
  }
}

function handleSubmit(event) {
  event.preventDefault();
  const record = readFormData();
  const existingIndex = records.findIndex((item) => item.recordId === record.recordId);

  if (existingIndex >= 0) {
    records[existingIndex] = record;
  } else {
    records.unshift(record);
  }

  persistRecords();
  localStorage.removeItem(DRAFT_KEY);
  saveStatus.textContent = `Record saved locally at ${new Date().toLocaleTimeString()}.`;
  renderRecords();
  renderMetrics();
  resetForm();
}

function readFormData() {
  const formData = new FormData(form);
  const object = Object.fromEntries(formData.entries());
  object.syntheticConfirmed = formData.get("syntheticConfirmed") === "on";
  object.recordId = object.recordId || crypto.randomUUID();
  object.updatedAt = new Date().toISOString();
  return object;
}

function populateForm(record) {
  Object.entries(record).forEach(([key, value]) => {
    const field = form.elements.namedItem(key);
    if (!field) {
      return;
    }

    if (field.type === "checkbox") {
      field.checked = Boolean(value);
      return;
    }

    field.value = value ?? "";
  });
}

function resetForm() {
  form.reset();
  form.recordId.value = "";
  form.syntheticConfirmed.checked = false;
  form.intakeDate.value = formatDateTimeLocal(new Date());
  saveStatus.textContent = "Ready for a new synthetic training record.";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderMetrics() {
  const urgentCount = records.filter((record) => record.medicalLevel === "Urgent referral").length;
  const shelterCount = records.filter((record) => record.currentStatus === "Referred to shelter").length;
  const scenarioCount = new Set(records.map((record) => record.scenarioName).filter(Boolean)).size;

  metrics.innerHTML = "";

  [
    ["Stored records", String(records.length)],
    ["Training scenarios", String(scenarioCount)],
    ["Urgent medical referrals", String(urgentCount)],
    ["Shelter referrals", String(shelterCount)],
    ["Storage model", "Local device only"],
  ].forEach(([label, value]) => {
    const wrapper = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    wrapper.append(dt, dd);
    metrics.appendChild(wrapper);
  });
}

function renderRecords() {
  const query = searchInput.value.trim().toLowerCase();
  const filteredRecords = records.filter((record) => {
    const haystack = [
      record.scenarioName,
      record.subjectId,
      record.firstName,
      record.lastName,
      record.intakeSite,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });

  recordsList.innerHTML = "";

  if (!filteredRecords.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = query
      ? "No matching local records."
      : "No training records saved yet. Start by loading a demo record or saving your first sheet.";
    recordsList.appendChild(empty);
    return;
  }

  const template = document.getElementById("recordTemplate");
  filteredRecords.forEach((record) => {
    const fragment = template.content.cloneNode(true);
    fragment.querySelector("[data-field='title']").textContent =
      `${record.subjectId} · ${record.firstName || "Unnamed"} ${record.lastName || ""}`.trim();
    fragment.querySelector("[data-field='status']").textContent = record.currentStatus;
    fragment.querySelector("[data-field='meta']").textContent =
      `${record.scenarioName || "No scenario"} | ${record.intakeSite || "No site"} | ${formatReadableDate(record.intakeDate)}`;
    fragment.querySelector("[data-field='notes']").textContent =
      record.welfareNotes || record.additionalNotes || "No additional notes.";

    fragment.querySelector("[data-action='edit']").addEventListener("click", () => {
      populateForm(record);
      saveStatus.textContent = `Editing record ${record.subjectId}.`;
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    fragment.querySelector("[data-action='duplicate']").addEventListener("click", () => {
      const copy = {
        ...record,
        recordId: crypto.randomUUID(),
        subjectId: `${record.subjectId}-COPY`,
        updatedAt: new Date().toISOString(),
      };
      records.unshift(copy);
      persistRecords();
      renderRecords();
      renderMetrics();
    });

    fragment.querySelector("[data-action='delete']").addEventListener("click", () => {
      records = records.filter((item) => item.recordId !== record.recordId);
      persistRecords();
      renderRecords();
      renderMetrics();
    });

    recordsList.appendChild(fragment);
  });
}

function exportJson() {
  downloadFile(
    "opsscreen-training-records.json",
    JSON.stringify(records, null, 2),
    "application/json"
  );
}

function exportCsv() {
  if (!records.length) {
    saveStatus.textContent = "Save at least one record before exporting CSV.";
    return;
  }

  const columns = [
    "subjectId",
    "scenarioName",
    "firstName",
    "lastName",
    "nationality",
    "intakeSite",
    "intakeDate",
    "immediateNeeds",
    "medicalLevel",
    "safeguardingConcern",
    "currentStatus",
    "referralDestination",
    "screenedBy",
    "classification",
  ];

  const csvRows = [
    columns.join(","),
    ...records.map((record) =>
      columns
        .map((column) => `"${String(record[column] ?? "").replaceAll('"', '""')}"`)
        .join(",")
    ),
  ];

  downloadFile("opsscreen-training-records.csv", csvRows.join("\n"), "text/csv");
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatDateTimeLocal(date) {
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function formatReadableDate(value) {
  if (!value) {
    return "No date";
  }
  return new Date(value).toLocaleString();
}

function loadDemoRecord() {
  populateForm({
    recordId: "",
    scenarioName: "River Crossing Reception Lane",
    exerciseName: "Spring Humanitarian Intake Lab",
    intakeSite: "Checkpoint Echo",
    intakeDate: formatDateTimeLocal(new Date()),
    screenedBy: "Student 12B",
    languageSupport: "Interpreter present",
    subjectId: "MOCK-1007",
    firstName: "Leila",
    lastName: "Karim",
    alias: "N/A",
    dob: "1996-08-21",
    nationality: "Synthetic Republic",
    groupMembers: "Traveling with one child and one elderly parent.",
    immediateNeeds: "Multiple needs",
    medicalLevel: "Routine follow-up",
    safeguardingConcern: "Separated family member",
    currentStatus: "Awaiting processing",
    propertyNotes: "One backpack, paper identity card, bottled water.",
    welfareNotes: "Subject appears fatigued, cooperative, and requests family reunification assistance.",
    originLocation: "North Valley District",
    transitPoint: "Temporary bus transfer site",
    destination: "Camp Meridian",
    arrivalMethod: "Bus convoy",
    consentScript: "This is a training record using synthetic data. No live operational information is being collected.",
    additionalNotes: "Escort team requested interpreter continuity at handoff.",
    referralDestination: "Family assistance desk",
    followUpOwner: "Cell Bravo",
    followUpDate: new Date().toISOString().slice(0, 10),
    classification: "Training use only",
    syntheticConfirmed: true,
  });
  saveStatus.textContent = "Demo record loaded. Review and save when ready.";
}
