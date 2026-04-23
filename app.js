const STORAGE_KEY = "opsscreen-records-v2";
const DRAFT_KEY = "opsscreen-draft-v1";
const API_BASE = "/api";

const form = document.getElementById("screeningForm");
const recordsList = document.getElementById("recordsList");
const metrics = document.getElementById("metrics");
const saveStatus = document.getElementById("saveStatus");
const searchInput = document.getElementById("searchInput");
const installButton = document.getElementById("installButton");
const backendStatus = document.getElementById("backendStatus");
const syncNowButton = document.getElementById("syncNowButton");
const pullServerDataButton = document.getElementById("pullServerDataButton");

let deferredInstallPrompt = null;
let records = loadLocalRecords();
let apiState = {
  available: false,
  mode: "offline",
  detail: "Using local browser storage only.",
};

document.getElementById("saveDraftButton").addEventListener("click", saveDraft);
document.getElementById("newRecordButton").addEventListener("click", resetForm);
document.getElementById("exportJsonButton").addEventListener("click", exportJson);
document.getElementById("exportCsvButton").addEventListener("click", exportCsv);
document.getElementById("seedDemoButton").addEventListener("click", loadDemoRecord);
document.getElementById("printButton").addEventListener("click", () => window.print());
syncNowButton.addEventListener("click", syncNow);
pullServerDataButton.addEventListener("click", pullServerData);
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

window.addEventListener("online", checkBackendAvailability);
window.addEventListener("offline", () => {
  apiState = {
    available: false,
    mode: "offline",
    detail: "Browser reports no network. Local storage remains available.",
  };
  renderBackendStatus();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js");
  });
}

hydrateDraft();
renderRecords();
renderMetrics();
renderBackendStatus();
checkBackendAvailability().then(loadInitialData);

function loadLocalRecords() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? [];
  } catch {
    return [];
  }
}

function persistLocalRecords() {
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

async function loadInitialData() {
  if (!apiState.available) {
    return;
  }

  try {
    const payload = await apiRequest("/records");
    if (Array.isArray(payload.records)) {
      records = payload.records;
      persistLocalRecords();
      renderRecords();
      renderMetrics();
      saveStatus.textContent = "Loaded training records from backend storage.";
    }
  } catch {
    saveStatus.textContent = "Backend read failed. Continuing with local data.";
  }
}

async function checkBackendAvailability() {
  try {
    const payload = await apiRequest("/health");
    apiState = {
      available: true,
      mode: payload.mode || "api",
      detail: payload.detail || "API and database are available.",
    };
  } catch {
    apiState = {
      available: false,
      mode: "offline",
      detail: "API unavailable. The app will keep working from local browser storage.",
    };
  }

  renderBackendStatus();
}

function renderBackendStatus() {
  backendStatus.classList.toggle("status-panel--online", apiState.available);
  backendStatus.classList.toggle("status-panel--offline", !apiState.available);
  backendStatus.querySelector(".status-panel__headline").textContent = apiState.available
    ? "Backend connected"
    : "Offline/local mode";
  backendStatus.querySelector(".status-panel__detail").textContent = apiState.detail;
}

async function handleSubmit(event) {
  event.preventDefault();
  const record = readFormData();

  if (apiState.available) {
    await saveRecordToApi(record);
    return;
  }

  upsertLocalRecord(record);
  saveStatus.textContent = `Record saved locally at ${new Date().toLocaleTimeString()}.`;
}

async function saveRecordToApi(record) {
  const existing = records.find((item) => item.recordId === record.recordId);
  const endpoint = existing ? `/records/${record.recordId}` : "/records";
  const method = existing ? "PUT" : "POST";

  try {
    const payload = await apiRequest(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    });
    upsertLocalRecord(payload.record, false);
    saveStatus.textContent = `Record saved to backend at ${new Date().toLocaleTimeString()}.`;
  } catch {
    upsertLocalRecord(record);
    saveStatus.textContent =
      "Backend save failed. Record preserved locally; use Sync Now when the API returns.";
  }
}

function readFormData() {
  const formData = new FormData(form);
  const object = Object.fromEntries(formData.entries());
  object.syntheticConfirmed = formData.get("syntheticConfirmed") === "on";
  object.recordId = object.recordId || crypto.randomUUID();
  object.updatedAt = new Date().toISOString();
  object.storageMode = apiState.available ? "api" : "local";
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
    ["Storage model", apiState.available ? "Backend + local cache" : "Local device only"],
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

    fragment.querySelector("[data-action='duplicate']").addEventListener("click", async () => {
      const copy = {
        ...record,
        recordId: crypto.randomUUID(),
        subjectId: `${record.subjectId}-COPY`,
        updatedAt: new Date().toISOString(),
      };

      if (apiState.available) {
        await saveRecordToApi(copy);
        return;
      }

      upsertLocalRecord(copy);
      saveStatus.textContent = `Duplicated ${record.subjectId} locally.`;
    });

    fragment.querySelector("[data-action='delete']").addEventListener("click", async () => {
      if (apiState.available) {
        try {
          await apiRequest(`/records/${record.recordId}`, { method: "DELETE" });
        } catch {
          saveStatus.textContent =
            "Backend delete failed. The record remains on the server; local cache was not removed.";
          return;
        }
      }

      records = records.filter((item) => item.recordId !== record.recordId);
      persistLocalRecords();
      renderRecords();
      renderMetrics();
      saveStatus.textContent = `Deleted ${record.subjectId}.`;
    });

    recordsList.appendChild(fragment);
  });
}

async function syncNow() {
  await checkBackendAvailability();
  if (!apiState.available) {
    saveStatus.textContent = "Sync unavailable because the backend is offline.";
    return;
  }

  const localOnly = loadLocalRecords().filter(
    (record) => !records.some((stored) => stored.recordId === record.recordId)
  );

  for (const record of localOnly) {
    try {
      await apiRequest("/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      });
    } catch {
      saveStatus.textContent = "Some local records could not be synced to the backend.";
      return;
    }
  }

  await pullServerData();
  saveStatus.textContent = "Local records synced with backend storage.";
}

async function pullServerData() {
  await checkBackendAvailability();
  if (!apiState.available) {
    saveStatus.textContent = "Server refresh unavailable because the backend is offline.";
    return;
  }

  try {
    const payload = await apiRequest("/records");
    records = payload.records ?? [];
    persistLocalRecords();
    renderRecords();
    renderMetrics();
    saveStatus.textContent = "Pulled latest records from backend storage.";
  } catch {
    saveStatus.textContent = "Server refresh failed. Local data is unchanged.";
  }
}

function upsertLocalRecord(record, reset = true) {
  const existingIndex = records.findIndex((item) => item.recordId === record.recordId);
  if (existingIndex >= 0) {
    records[existingIndex] = record;
  } else {
    records.unshift(record);
  }

  persistLocalRecords();
  renderRecords();
  renderMetrics();
  localStorage.removeItem(DRAFT_KEY);
  if (reset) {
    resetForm();
  }
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

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    throw new Error(`API request failed with status ${response.status}`);
  }
  return response.json();
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
    consentScript:
      "This is a training record using synthetic data. No live operational information is being collected.",
    additionalNotes: "Escort team requested interpreter continuity at handoff.",
    referralDestination: "Family assistance desk",
    followUpOwner: "Cell Bravo",
    followUpDate: new Date().toISOString().slice(0, 10),
    classification: "Training use only",
    syntheticConfirmed: true,
  });
  saveStatus.textContent = "Demo record loaded. Review and save when ready.";
}
