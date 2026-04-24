const API_BASE = "/api";
const CACHE_KEY = "opsscreen-platform-cache-v1";
const SETTINGS_KEY = "opsscreen-ui-settings-v1";

const installButton = document.getElementById("installButton");
const syncNowButton = document.getElementById("syncNowButton");
const seedDemoButton = document.getElementById("seedDemoButton");
const backendStatus = document.getElementById("backendStatus");
const actingUserSelect = document.getElementById("actingUserSelect");
const actingOrgSelect = document.getElementById("actingOrgSelect");
const actingScenarioSelect = document.getElementById("actingScenarioSelect");
const roleSummary = document.getElementById("roleSummary");
const metrics = document.getElementById("metrics");
const contextTitle = document.getElementById("contextTitle");
const contextDetail = document.getElementById("contextDetail");
const scenarioBoard = document.getElementById("scenarioBoard");
const organizationList = document.getElementById("organizationList");
const platformUserList = document.getElementById("platformUserList");
const memberRoleUserSelect = document.getElementById("memberRoleUserSelect");
const orgAdminOrgSelect = document.getElementById("orgAdminOrgSelect");
const orgAdminUserSelect = document.getElementById("orgAdminUserSelect");
const superAdminSection = document.getElementById("superAdminSection");
const orgAdminSection = document.getElementById("orgAdminSection");
const memberSection = document.getElementById("memberSection");
const auditSection = document.getElementById("auditSection");
const auditList = document.getElementById("auditList");
const recordScopeBanner = document.getElementById("recordScopeBanner");
const searchInput = document.getElementById("searchInput");
const recordsList = document.getElementById("recordsList");
const form = document.getElementById("screeningForm");
const saveStatus = document.getElementById("saveStatus");

let deferredInstallPrompt = null;
let state = {
  platform: loadCachedPlatform(),
  records: [],
  auditEntries: [],
  api: { available: false, detail: "Checking backend connection..." },
  ui: loadUiSettings(),
};

bindEvents();
initialize();

function bindEvents() {
  actingUserSelect.addEventListener("change", handleContextChange);
  actingOrgSelect.addEventListener("change", handleContextChange);
  actingScenarioSelect.addEventListener("change", handleContextChange);
  syncNowButton.addEventListener("click", refreshWorkspace);
  seedDemoButton.addEventListener("click", loadDemoRecord);
  searchInput.addEventListener("input", renderRecords);

  document.getElementById("createOrganizationForm").addEventListener("submit", handleCreateOrganization);
  document.getElementById("setOrgAdminForm").addEventListener("submit", handleSetOrgAdmin);
  document.getElementById("createUserForm").addEventListener("submit", handleCreateUser);
  document.getElementById("assignRoleForm").addEventListener("submit", handleAssignRole);
  document.getElementById("createScenarioForm").addEventListener("submit", handleCreateScenario);
  document.getElementById("joinOrganizationForm").addEventListener("submit", handleJoinOrganization);
  document.getElementById("joinScenarioForm").addEventListener("submit", handleJoinScenario);
  form.addEventListener("submit", handleRecordSubmit);

  organizationList.addEventListener("click", handleOrganizationActions);
  recordsList.addEventListener("click", handleRecordActions);

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
    window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js"));
  }
}

async function initialize() {
  form.intakeDate.value = formatDateTimeLocal(new Date());
  renderAll();
  await refreshWorkspace();
}

async function refreshWorkspace() {
  await checkBackend();
  if (!state.api.available) {
    renderAll();
    return;
  }

  await loadPlatform();
  applyDefaultSelections();
  await Promise.all([loadRecords(), loadAuditLog()]);
  renderAll();
}

async function checkBackend() {
  try {
    const payload = await apiRequest("/health");
    state.api = {
      available: true,
      detail: payload.detail,
    };
  } catch {
    state.api = {
      available: false,
      detail: "API unavailable. Cached platform data may be stale until the backend returns.",
    };
  }
}

async function loadPlatform() {
  const payload = await apiRequest("/platform");
  state.platform = payload;
  cachePlatform();
}

async function loadRecords() {
  const currentUser = getCurrentUser();
  const currentOrg = getCurrentOrg();
  const currentScenario = getCurrentScenario();
  if (!currentUser) {
    state.records = [];
    return;
  }

  const params = new URLSearchParams({ actorUserId: currentUser.userId });
  if (currentOrg) {
    params.set("orgId", currentOrg.orgId);
  }
  if (currentScenario) {
    params.set("scenarioId", currentScenario.scenarioId);
  }

  try {
    const payload = await apiRequest(`/records?${params.toString()}`);
    state.records = payload.records || [];
  } catch {
    state.records = [];
  }
}

async function loadAuditLog() {
  const currentUser = getCurrentUser();
  const currentOrg = getCurrentOrg();
  if (!currentUser || (!isSuperAdmin() && !isOrgAdmin(currentOrg?.orgId))) {
    state.auditEntries = [];
    return;
  }

  const params = new URLSearchParams({ actorUserId: currentUser.userId });
  if (!isSuperAdmin() && currentOrg) {
    params.set("orgId", currentOrg.orgId);
  }

  try {
    const payload = await apiRequest(`/audit-log?${params.toString()}`);
    state.auditEntries = payload.entries || [];
  } catch {
    state.auditEntries = [];
  }
}

function handleContextChange(event) {
  if (event.target === actingUserSelect) {
    state.ui.currentUserId = actingUserSelect.value || "";
    const memberships = getMembershipsForUser(state.ui.currentUserId);
    state.ui.currentOrgId = memberships[0]?.orgId || "";
    state.ui.currentScenarioId = "";
  }

  if (event.target === actingOrgSelect) {
    state.ui.currentOrgId = actingOrgSelect.value || "";
    state.ui.currentScenarioId = "";
  }

  if (event.target === actingScenarioSelect) {
    state.ui.currentScenarioId = actingScenarioSelect.value || "";
  }

  saveUiSettings();
  applyDefaultSelections();
  refreshWorkspace();
}

function applyDefaultSelections() {
  if (!state.platform.users?.length) {
    return;
  }

  if (!state.ui.currentUserId || !findUser(state.ui.currentUserId)) {
    state.ui.currentUserId =
      state.platform.users.find((user) => user.platformRole === "super_admin")?.userId ||
      state.platform.users[0].userId;
  }

  const availableOrgs = getAvailableOrganizations();
  if (!availableOrgs.find((org) => org.orgId === state.ui.currentOrgId)) {
    state.ui.currentOrgId = availableOrgs[0]?.orgId || "";
  }

  const availableScenarios = getAvailableScenarios();
  if (!availableScenarios.find((scenario) => scenario.scenarioId === state.ui.currentScenarioId)) {
    state.ui.currentScenarioId = availableScenarios[0]?.scenarioId || "";
  }

  saveUiSettings();
}

function renderAll() {
  renderBackendStatus();
  renderSelectors();
  renderRoleSummary();
  renderMetrics();
  renderContextHeader();
  renderScenarioBoard();
  renderSuperAdminSection();
  renderOrgAdminSection();
  renderMemberSection();
  renderRecordScope();
  renderRecords();
  renderAuditLog();
}

function renderBackendStatus() {
  backendStatus.classList.toggle("status-panel--online", state.api.available);
  backendStatus.classList.toggle("status-panel--offline", !state.api.available);
  backendStatus.querySelector(".status-panel__headline").textContent = state.api.available
    ? "Backend connected"
    : "Offline / cached mode";
  backendStatus.querySelector(".status-panel__detail").textContent = state.api.detail;
}

function renderSelectors() {
  fillSelect(
    actingUserSelect,
    state.platform.users || [],
    (user) => user.userId,
    (user) => `${user.fullName} · ${formatPlatformRole(user.platformRole)}`
  );
  actingUserSelect.value = state.ui.currentUserId || "";

  fillSelect(
    actingOrgSelect,
    getAvailableOrganizations(),
    (org) => org.orgId,
    (org) => `${org.name}${org.active ? "" : " · inactive"}`
  );
  actingOrgSelect.value = state.ui.currentOrgId || "";

  fillSelect(
    actingScenarioSelect,
    getAvailableScenarios(),
    (scenario) => scenario.scenarioId,
    (scenario) => scenario.name
  );
  actingScenarioSelect.value = state.ui.currentScenarioId || "";

  fillSelect(
    orgAdminOrgSelect,
    state.platform.organizations || [],
    (org) => org.orgId,
    (org) => org.name
  );
  fillSelect(
    orgAdminUserSelect,
    state.platform.users || [],
    (user) => user.userId,
    (user) => `${user.fullName} · ${user.email}`
  );
  fillSelect(
    memberRoleUserSelect,
    getUsersForCurrentOrganization(),
    (user) => user.userId,
    (user) => `${user.fullName} · ${user.email}`
  );
}

function renderRoleSummary() {
  const currentUser = getCurrentUser();
  const currentOrg = getCurrentOrg();
  const tags = [];

  if (currentUser) {
    tags.push(`<span class="tag">${formatPlatformRole(currentUser.platformRole)}</span>`);
  }
  if (currentOrg) {
    const membership = getMembership(currentUser?.userId, currentOrg.orgId);
    if (membership) {
      tags.push(`<span class="tag">${formatOrgRole(membership.orgRole)}</span>`);
    }
  }
  const currentScenario = getCurrentScenario();
  if (currentScenario) {
    tags.push(`<span class="tag">${currentScenario.name}</span>`);
  }

  roleSummary.innerHTML = tags.join("") || `<span class="tag">No active role context</span>`;
}

function renderMetrics() {
  const activeOrgCount = (state.platform.organizations || []).filter((org) => org.active).length;
  const currentOrg = getCurrentOrg();
  const currentScenario = getCurrentScenario();

  metrics.innerHTML = "";
  [
    ["Organizations", String(state.platform.organizations?.length || 0)],
    ["Active organizations", String(activeOrgCount)],
    ["Users", String(state.platform.users?.length || 0)],
    ["Scenarios in scope", String(getAvailableScenarios().length)],
    ["Records loaded", String(state.records.length)],
    ["Active scenario", currentScenario?.name || "None selected"],
    ["Current org", currentOrg?.name || "No organization"],
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

function renderContextHeader() {
  const currentUser = getCurrentUser();
  const currentOrg = getCurrentOrg();
  const currentScenario = getCurrentScenario();

  contextTitle.textContent = currentUser
    ? `${currentUser.fullName} in ${currentOrg?.name || "no organization"}`
    : "No active user";

  contextDetail.textContent = currentScenario
    ? `${currentScenario.name} is the active scenario context. Records and visibility are scoped to this selection.`
    : "Select or join a scenario to submit scenario-scoped screening sheets.";
}

function renderScenarioBoard() {
  const scenarios = getAvailableScenarios();
  if (!scenarios.length) {
    scenarioBoard.innerHTML = `<div class="empty-state">No scenarios available for this context yet.</div>`;
    return;
  }

  scenarioBoard.innerHTML = scenarios
    .map((scenario) => {
      const members = getScenarioMembers(scenario.scenarioId).length;
      return `
        <article class="data-item">
          <div>
            <div class="data-item__header">
              <h3>${escapeHtml(scenario.name)}</h3>
              <span class="record-pill">${scenario.active ? "Active" : "Inactive"}</span>
            </div>
            <p class="record-item__meta">${escapeHtml(scenario.description || "No description.")}</p>
            <p class="record-item__notes">Join code: <strong>${escapeHtml(scenario.joinCode)}</strong> · Members: ${members}</p>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderSuperAdminSection() {
  superAdminSection.classList.toggle("hidden", !isSuperAdmin());
  if (!isSuperAdmin()) {
    return;
  }

  organizationList.innerHTML = (state.platform.organizations || [])
    .map((org) => {
      const admins = getOrganizationMembers(org.orgId)
        .filter((item) => item.membership.orgRole === "org_admin")
        .map((item) => item.user.fullName)
        .join(", ");
      return `
        <article class="data-item">
          <div>
            <div class="data-item__header">
              <h3>${escapeHtml(org.name)}</h3>
              <span class="record-pill">${org.active ? "Active" : "Inactive"}</span>
            </div>
            <p class="record-item__meta">Join code: <strong>${escapeHtml(org.joinCode)}</strong></p>
            <p class="record-item__notes">Org admins: ${escapeHtml(admins || "None assigned")}</p>
          </div>
          <div class="record-item__actions">
            <button class="button button--ghost" data-action="toggle-org" data-org-id="${org.orgId}" data-active="${org.active}">
              ${org.active ? "Deactivate" : "Activate"}
            </button>
          </div>
        </article>
      `;
    })
    .join("");

  platformUserList.innerHTML = (state.platform.users || [])
    .map((user) => {
      const orgs = getMembershipsForUser(user.userId)
        .map((membership) => {
          const org = findOrganization(membership.orgId);
          return `${org?.name || membership.orgId} (${formatOrgRole(membership.orgRole)})`;
        })
        .join(", ");
      return `
        <article class="data-item">
          <div>
            <div class="data-item__header">
              <h3>${escapeHtml(user.fullName)}</h3>
              <span class="record-pill">${formatPlatformRole(user.platformRole)}</span>
            </div>
            <p class="record-item__meta">${escapeHtml(user.email)}</p>
            <p class="record-item__notes">${escapeHtml(orgs || "No org memberships")}</p>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderOrgAdminSection() {
  const canManage = isOrgAdmin(getCurrentOrg()?.orgId) || isSuperAdmin();
  orgAdminSection.classList.toggle("hidden", !canManage);
}

function renderMemberSection() {
  memberSection.classList.toggle("hidden", !getCurrentUser());
}

function renderRecordScope() {
  const currentUser = getCurrentUser();
  const currentOrg = getCurrentOrg();
  const currentScenario = getCurrentScenario();
  recordScopeBanner.innerHTML = `
    <strong>Submitting as:</strong> ${escapeHtml(currentUser?.fullName || "No user")}
    <span class="context-banner__divider">|</span>
    <strong>Organization:</strong> ${escapeHtml(currentOrg?.name || "None")}
    <span class="context-banner__divider">|</span>
    <strong>Scenario:</strong> ${escapeHtml(currentScenario?.name || "None")}
  `;
}

function renderRecords() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = state.records.filter((record) => {
    const haystack = [
      record.subjectId,
      record.scenarioName,
      record.intakeSite,
      record.firstName,
      record.lastName,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });

  if (!filtered.length) {
    recordsList.innerHTML = `<div class="empty-state">No records found for this context.</div>`;
    return;
  }

  recordsList.innerHTML = filtered
    .map((record) => `
      <article class="data-item">
        <div>
          <div class="data-item__header">
            <h3>${escapeHtml(record.subjectId)} · ${escapeHtml(record.firstName || "Unnamed")} ${escapeHtml(record.lastName || "")}</h3>
            <span class="record-pill">${escapeHtml(record.currentStatus)}</span>
          </div>
          <p class="record-item__meta">${escapeHtml(record.scenarioName)} · ${escapeHtml(record.intakeSite || "No site")} · ${formatReadableDate(record.intakeDate)}</p>
          <p class="record-item__notes">${escapeHtml(record.welfareNotes || record.additionalNotes || "No notes.")}</p>
        </div>
        <div class="record-item__actions">
          <button class="button button--ghost" data-action="edit-record" data-record-id="${record.recordId}">Edit</button>
          <button class="button button--ghost" data-action="delete-record" data-record-id="${record.recordId}">Delete</button>
        </div>
      </article>
    `)
    .join("");
}

function renderAuditLog() {
  const canView = isSuperAdmin() || isOrgAdmin(getCurrentOrg()?.orgId);
  auditSection.classList.toggle("hidden", !canView);
  if (!canView) {
    return;
  }

  if (!state.auditEntries.length) {
    auditList.innerHTML = `<div class="empty-state">No audit events loaded for this scope.</div>`;
    return;
  }

  auditList.innerHTML = state.auditEntries
    .map((entry) => `
      <article class="data-item">
        <div>
          <div class="data-item__header">
            <h3>${escapeHtml(entry.action)} · ${escapeHtml(entry.entityType)}</h3>
            <span class="record-pill">${formatReadableDate(entry.createdAt)}</span>
          </div>
          <p class="record-item__meta">Actor: ${escapeHtml(entry.actor)} · Entity: ${escapeHtml(entry.entityId)}</p>
          <p class="record-item__notes">${escapeHtml(JSON.stringify(entry.details || {}))}</p>
        </div>
      </article>
    `)
    .join("");
}

async function handleCreateOrganization(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  await runPlatformAction("createOrganization", { name: formData.get("name") });
  event.currentTarget.reset();
}

async function handleSetOrgAdmin(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  await runPlatformAction("setOrgAdmin", {
    orgId: formData.get("orgId"),
    userId: formData.get("userId"),
    enabled: formData.get("enabled") === "true",
  });
}

async function handleCreateUser(event) {
  event.preventDefault();
  const currentOrg = getCurrentOrg();
  if (!currentOrg) {
    setSaveStatus("Select an organization before adding users.");
    return;
  }
  const formData = new FormData(event.currentTarget);
  await runPlatformAction("createUser", {
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    orgId: currentOrg.orgId,
    orgRole: formData.get("orgRole"),
  });
  event.currentTarget.reset();
}

async function handleAssignRole(event) {
  event.preventDefault();
  const currentOrg = getCurrentOrg();
  if (!currentOrg) {
    setSaveStatus("Select an organization before assigning roles.");
    return;
  }
  const formData = new FormData(event.currentTarget);
  await runPlatformAction("assignOrganizationRole", {
    orgId: currentOrg.orgId,
    userId: formData.get("userId"),
    orgRole: formData.get("orgRole"),
  });
}

async function handleCreateScenario(event) {
  event.preventDefault();
  const currentOrg = getCurrentOrg();
  if (!currentOrg) {
    setSaveStatus("Select an organization before creating a scenario.");
    return;
  }
  const formData = new FormData(event.currentTarget);
  await runPlatformAction("createScenario", {
    orgId: currentOrg.orgId,
    name: formData.get("name"),
    description: formData.get("description"),
  });
  event.currentTarget.reset();
}

async function handleJoinOrganization(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  await runPlatformAction("joinOrganization", { joinCode: formData.get("joinCode") });
  event.currentTarget.reset();
}

async function handleJoinScenario(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  await runPlatformAction("joinScenario", { joinCode: formData.get("joinCode") });
  event.currentTarget.reset();
}

async function handleRecordSubmit(event) {
  event.preventDefault();
  const currentUser = getCurrentUser();
  const currentOrg = getCurrentOrg();
  const currentScenario = getCurrentScenario();
  if (!currentUser || !currentOrg || !currentScenario) {
    setSaveStatus("Select an acting user, organization, and scenario before saving records.");
    return;
  }

  const formData = new FormData(form);
  const record = Object.fromEntries(formData.entries());
  record.syntheticConfirmed = formData.get("syntheticConfirmed") === "on";
  record.recordId = record.recordId || crypto.randomUUID();
  record.orgId = currentOrg.orgId;
  record.scenarioId = currentScenario.scenarioId;
  record.scenarioName = currentScenario.name;
  record.createdBy = currentUser.userId;
  record.createdByName = currentUser.fullName;
  record.actorUserId = currentUser.userId;

  const exists = state.records.find((item) => item.recordId === record.recordId);
  const endpoint = exists ? `/records/${record.recordId}` : "/records";
  const method = exists ? "PUT" : "POST";

  try {
    await apiRequest(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    });
    form.reset();
    form.recordId.value = "";
    form.intakeDate.value = formatDateTimeLocal(new Date());
    setSaveStatus("Record saved to the active scenario.");
    await Promise.all([loadRecords(), loadAuditLog()]);
    renderAll();
  } catch (error) {
    setSaveStatus(error.message || "Failed to save record.");
  }
}

async function handleOrganizationActions(event) {
  const button = event.target.closest("[data-action='toggle-org']");
  if (!button) {
    return;
  }

  await runPlatformAction("setOrganizationStatus", {
    orgId: button.dataset.orgId,
    active: button.dataset.active !== "true",
  });
}

async function handleRecordActions(event) {
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) {
    return;
  }

  const record = state.records.find((item) => item.recordId === actionTarget.dataset.recordId);
  if (!record) {
    return;
  }

  if (actionTarget.dataset.action === "edit-record") {
    populateRecordForm(record);
    return;
  }

  if (actionTarget.dataset.action === "delete-record") {
    try {
      await apiRequest(
        `/records/${record.recordId}?${new URLSearchParams({ actorUserId: getCurrentUser().userId })}`,
        { method: "DELETE" }
      );
      setSaveStatus("Record deleted.");
      await Promise.all([loadRecords(), loadAuditLog()]);
      renderAll();
    } catch (error) {
      setSaveStatus(error.message || "Failed to delete record.");
    }
  }
}

async function runPlatformAction(action, payload) {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    setSaveStatus("Choose an acting user first.");
    return;
  }

  try {
    await apiRequest("/platform", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        actorUserId: currentUser.userId,
        ...payload,
      }),
    });
    await refreshWorkspace();
    setSaveStatus(`Platform action "${action}" completed.`);
  } catch (error) {
    setSaveStatus(error.message || `Platform action "${action}" failed.`);
  }
}

function populateRecordForm(record) {
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
  setSaveStatus(`Editing ${record.subjectId}.`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function loadDemoRecord() {
  const currentUser = getCurrentUser();
  const currentScenario = getCurrentScenario();
  if (!currentUser || !currentScenario) {
    setSaveStatus("Select an acting user and scenario before loading a demo record.");
    return;
  }

  populateRecordForm({
    recordId: "",
    exerciseName: currentScenario.name,
    intakeSite: "Checkpoint Echo",
    intakeDate: formatDateTimeLocal(new Date()),
    screenedBy: currentUser.fullName,
    languageSupport: "Interpreter present",
    subjectId: `MOCK-${Math.floor(Math.random() * 9000 + 1000)}`,
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
    welfareNotes: "Subject appears fatigued and requests family reunification assistance.",
    additionalNotes: "Escort team requested interpreter continuity at handoff.",
    referralDestination: "Family assistance desk",
    followUpOwner: currentUser.fullName,
    followUpDate: new Date().toISOString().slice(0, 10),
    classification: "Training use only",
    syntheticConfirmed: true,
  });
  setSaveStatus("Demo record loaded for the active scenario.");
}

function loadCachedPlatform() {
  try {
    return (
      JSON.parse(localStorage.getItem(CACHE_KEY)) || {
        users: [],
        organizations: [],
        memberships: [],
        scenarios: [],
        scenarioMemberships: [],
      }
    );
  } catch {
    return {
      users: [],
      organizations: [],
      memberships: [],
      scenarios: [],
      scenarioMemberships: [],
    };
  }
}

function cachePlatform() {
  localStorage.setItem(CACHE_KEY, JSON.stringify(state.platform));
}

function loadUiSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveUiSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.ui));
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }
  return payload;
}

function fillSelect(select, items, valueGetter, labelGetter) {
  select.innerHTML = items.length
    ? items
        .map((item) => `<option value="${escapeHtml(valueGetter(item))}">${escapeHtml(labelGetter(item))}</option>`)
        .join("")
    : `<option value="">None available</option>`;
}

function getCurrentUser() {
  return findUser(state.ui.currentUserId);
}

function getCurrentOrg() {
  return findOrganization(state.ui.currentOrgId);
}

function getCurrentScenario() {
  return state.platform.scenarios?.find((scenario) => scenario.scenarioId === state.ui.currentScenarioId);
}

function findUser(userId) {
  return state.platform.users?.find((user) => user.userId === userId);
}

function findOrganization(orgId) {
  return state.platform.organizations?.find((org) => org.orgId === orgId);
}

function getMembership(userId, orgId) {
  return state.platform.memberships?.find(
    (membership) => membership.userId === userId && membership.orgId === orgId && membership.active
  );
}

function getMembershipsForUser(userId) {
  return (state.platform.memberships || []).filter(
    (membership) => membership.userId === userId && membership.active
  );
}

function getAvailableOrganizations() {
  const user = getCurrentUser();
  if (!user) {
    return [];
  }
  if (user.platformRole === "super_admin") {
    return state.platform.organizations || [];
  }
  const membershipOrgIds = new Set(getMembershipsForUser(user.userId).map((membership) => membership.orgId));
  return (state.platform.organizations || []).filter((org) => membershipOrgIds.has(org.orgId));
}

function getAvailableScenarios() {
  const user = getCurrentUser();
  const currentOrg = getCurrentOrg();
  if (!user || !currentOrg) {
    return [];
  }

  const orgScenarios = (state.platform.scenarios || []).filter(
    (scenario) => scenario.orgId === currentOrg.orgId && scenario.active
  );

  if (user.platformRole === "super_admin" || isOrgAdmin(currentOrg.orgId)) {
    return orgScenarios;
  }

  const joinedScenarioIds = new Set(
    (state.platform.scenarioMemberships || [])
      .filter((membership) => membership.userId === user.userId && membership.active)
      .map((membership) => membership.scenarioId)
  );
  return orgScenarios.filter((scenario) => joinedScenarioIds.has(scenario.scenarioId));
}

function getScenarioMembers(scenarioId) {
  return (state.platform.scenarioMemberships || []).filter(
    (membership) => membership.scenarioId === scenarioId && membership.active
  );
}

function getOrganizationMembers(orgId) {
  return (state.platform.memberships || [])
    .filter((membership) => membership.orgId === orgId && membership.active)
    .map((membership) => ({
      membership,
      user: findUser(membership.userId),
    }))
    .filter((item) => item.user);
}

function getUsersForCurrentOrganization() {
  const currentOrg = getCurrentOrg();
  if (!currentOrg) {
    return [];
  }
  return getOrganizationMembers(currentOrg.orgId).map((item) => item.user);
}

function isSuperAdmin() {
  return getCurrentUser()?.platformRole === "super_admin";
}

function isOrgAdmin(orgId) {
  const currentUser = getCurrentUser();
  if (!currentUser || !orgId) {
    return false;
  }
  if (currentUser.platformRole === "super_admin") {
    return true;
  }
  return Boolean(
    state.platform.memberships?.find(
      (membership) =>
        membership.userId === currentUser.userId &&
        membership.orgId === orgId &&
        membership.active &&
        membership.orgRole === "org_admin"
    )
  );
}

function setSaveStatus(message) {
  saveStatus.textContent = message;
}

function formatPlatformRole(role) {
  return role === "super_admin" ? "Super Admin" : "Platform User";
}

function formatOrgRole(role) {
  return {
    org_admin: "Org Admin",
    member: "Member",
    instructor: "Instructor",
    excon: "EXCON",
  }[role] || role;
}

function formatReadableDate(value) {
  if (!value) {
    return "No date";
  }
  return new Date(value).toLocaleString();
}

function formatDateTimeLocal(date) {
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
