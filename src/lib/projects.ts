import { randomUUID } from "node:crypto";
import { getEnv } from "./env";
import { buildInitialState } from "./seed";
import { deploymentTenant, getStore, type DataStore } from "./store";
import { isAccessError, requireProjectAccess, type UserAccess } from "./authorization";
import type { AppState, ManagedProjectRecord, ProjectRole } from "./types";

export interface Project {
  id: string;
  name: string;
  customer?: string;
  archivedAt?: string;
  accessRole?: "app_admin" | ProjectRole;
}

interface ConfiguredProject extends Project {
  tenant: string;
}

const SAFE_ID = /^[A-Za-z0-9._-]+$/;
const SAFE_TENANT = /^[A-Za-z0-9:._-]+$/;
const MANAGED_PROJECT_ID = /^project-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADMIN_REGISTRY_TENANT = "page-watch-admin-registry:live";

function defaultProject(): ConfiguredProject {
  return { id: "brand-studio", name: "Brand Studio", tenant: deploymentTenant() };
}

/** Parse the deployment-owned project allowlist without exposing tenant keys to the browser. */
export function parseProjectConfiguration(raw: string | undefined): ConfiguredProject[] {
  if (!raw?.trim()) return [defaultProject()];

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("PAGE_WATCH_PROJECTS must be valid JSON");
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("PAGE_WATCH_PROJECTS must contain at least one project");
  }

  const ids = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`PAGE_WATCH_PROJECTS[${index}] must be an object`);
    }
    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    const customer = typeof candidate.customer === "string" ? candidate.customer.trim() : undefined;
    const tenant = typeof candidate.tenant === "string" ? candidate.tenant.trim() : "";
    if (!id || id.length > 80 || !SAFE_ID.test(id)) {
      throw new Error(`PAGE_WATCH_PROJECTS[${index}].id is invalid`);
    }
    if (!name || name.length > 120) {
      throw new Error(`PAGE_WATCH_PROJECTS[${index}].name is invalid`);
    }
    if (customer !== undefined && customer.length > 120) {
      throw new Error(`PAGE_WATCH_PROJECTS[${index}].customer is invalid`);
    }
    if (!tenant || tenant.length > 160 || !SAFE_TENANT.test(tenant)) {
      throw new Error(`PAGE_WATCH_PROJECTS[${index}].tenant is invalid`);
    }
    if (ids.has(id)) throw new Error(`PAGE_WATCH_PROJECTS contains duplicate id ${id}`);
    ids.add(id);
    return { id, name, ...(customer ? { customer } : {}), tenant };
  });
}

function configuredProjects(): ConfiguredProject[] {
  return parseProjectConfiguration(getEnv("PAGE_WATCH_PROJECTS"));
}

function validManagedProjects(state: AppState, configured = configuredProjects()): ManagedProjectRecord[] {
  const seen = new Set<string>();
  const configuredById = new Map(configured.map((project) => [project.id, project]));
  if (!Array.isArray(state.managedProjects)) return [];
  return state.managedProjects.filter((project) => {
    const id = typeof project?.id === "string" ? project.id : "";
    const configuredProject = configuredById.get(id);
    const validIdentity = !!id && (configuredProject
      ? project?.tenant === configuredProject.tenant
      : MANAGED_PROJECT_ID.test(id) && project?.tenant === `${id}:live`);
    if (
      typeof project?.id !== "string"
      || typeof project.name !== "string"
      || typeof project.tenant !== "string"
      || typeof project.createdAt !== "string"
      || !validIdentity
      || !project.name.trim()
      || project.name.length > 120
      || (project.customer !== undefined && (typeof project.customer !== "string" || project.customer.length > 120))
      || !SAFE_TENANT.test(project.tenant)
      || (project.archivedAt !== undefined && !Number.isFinite(Date.parse(project.archivedAt)))
      || seen.has(project.id)
    ) return false;
    seen.add(project.id);
    return true;
  });
}

async function managedProjects(): Promise<ManagedProjectRecord[]> {
  const state = await getStore(ADMIN_REGISTRY_TENANT).getState();
  return validManagedProjects(state);
}

async function projectCatalog(): Promise<ConfiguredProject[]> {
  const configured = configuredProjects();
  const records = await managedProjects();
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const configuredIds = new Set(configured.map((project) => project.id));
  return [
    ...configured.map((project) => {
      const override = recordsById.get(project.id);
      return {
        ...project,
        name: override?.name ?? project.name,
        customer: override && "customer" in override ? override.customer : project.customer,
        ...(override?.archivedAt ? { archivedAt: override.archivedAt } : {}),
      };
    }),
    ...records
      .filter(({ id }) => !configuredIds.has(id))
      .map(({ id, name, customer, tenant, archivedAt }) => ({ id, name, customer, tenant, ...(archivedAt ? { archivedAt } : {}) })),
  ];
}

function publicProject({ id, name, customer, archivedAt }: ConfiguredProject): Project {
  return { id, name, ...(customer ? { customer } : {}), ...(archivedAt ? { archivedAt } : {}) };
}

export async function availableProjects(): Promise<Project[]> {
  return (await projectCatalog()).filter((project) => !project.archivedAt).map(publicProject);
}

export async function adminProjects(): Promise<Project[]> {
  return (await projectCatalog()).map(publicProject);
}

export async function accessibleProjects(access: UserAccess, includeArchived = false): Promise<Project[]> {
  return (await projectCatalog())
    .filter((project) => includeArchived || !project.archivedAt)
    .filter((project) => access.isAppAdmin || !!access.projectRoles[project.id])
    .map((project) => ({
      ...publicProject(project),
      accessRole: access.isAppAdmin ? "app_admin" : access.projectRoles[project.id],
    }));
}

export function selectAccessibleProject(
  projects: ConfiguredProject[],
  access: UserAccess,
  preferredId?: string,
): ConfiguredProject | null {
  const accessible = projects.filter((project) =>
    !project.archivedAt && (access.isAppAdmin || !!access.projectRoles[project.id]));
  return accessible.find((project) => project.id === preferredId) ?? accessible[0] ?? null;
}

export async function defaultAccessibleProject(access: UserAccess, preferredId?: string): Promise<ConfiguredProject | null> {
  return selectAccessibleProject(await projectCatalog(), access, preferredId);
}

export async function defaultAvailableProject(): Promise<ConfiguredProject> {
  const project = (await projectCatalog()).find((candidate) => !candidate.archivedAt);
  if (!project) throw new Error("At least one active project is required");
  return project;
}

export class UnknownProjectError extends Error {
  constructor(id: string) {
    super(`Unknown project: ${id}`);
    this.name = "UnknownProjectError";
  }
}

export class ArchivedProjectError extends Error {
  constructor(id: string) {
    super(`Archived project is unavailable: ${id}`);
    this.name = "ArchivedProjectError";
  }
}

export function isProjectAccessError(error: unknown): boolean {
  return error instanceof ArchivedProjectError || error instanceof UnknownProjectError || isAccessError(error);
}

export async function projectForRequest(request: Request): Promise<ConfiguredProject> {
  const requestedId = new URL(request.url).searchParams.get("project");
  const projects = await projectCatalog();
  if (!requestedId) {
    const fallback = projects.find((project) => !project.archivedAt);
    if (!fallback) throw new Error("At least one active project is required");
    return fallback;
  }
  const project = projects.find(({ id }) => id === requestedId);
  if (project?.archivedAt) throw new ArchivedProjectError(requestedId);
  if (project) return project;
  throw new UnknownProjectError(requestedId);
}

export async function projectStore(request: Request): Promise<DataStore> {
  const project = await projectForRequest(request);
  await requireProjectAccess(request, project.id, request.method === "GET" || request.method === "HEAD" ? "viewer" : "admin");
  return getStore(project.tenant);
}

export async function authorizedProjectForRequest(request: Request, required: "viewer" | "admin" = "admin"): Promise<ConfiguredProject> {
  const project = await projectForRequest(request);
  await requireProjectAccess(request, project.id, required);
  return project;
}

function replaceState(target: AppState, source: AppState): void {
  for (const key of Object.keys(target) as Array<keyof AppState>) delete target[key];
  Object.assign(target, structuredClone(source));
}

function validName(nameInput: string): string {
  const name = nameInput.trim();
  if (!name) throw new Error("Project name is required");
  if (name.length > 120) throw new Error("Project name must be 120 characters or fewer");
  return name;
}

function validCustomer(customerInput: string | undefined): string | undefined {
  if (customerInput === undefined) return undefined;
  const customer = customerInput.trim();
  if (customer.length > 120) throw new Error("Customer must be 120 characters or fewer");
  return customer;
}

function sameName(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function setRecord(
  records: ManagedProjectRecord[],
  project: ConfiguredProject,
  patch: { name?: string; customer?: string; archivedAt?: string | null },
  now: string,
): void {
  const existing = records.find((record) => record.id === project.id);
  if (existing) {
    if (patch.name !== undefined) existing.name = patch.name;
    if (patch.customer !== undefined) existing.customer = patch.customer;
    if (patch.archivedAt) existing.archivedAt = patch.archivedAt;
    else if (patch.archivedAt === null) delete existing.archivedAt;
    return;
  }
  records.push({
    id: project.id,
    name: patch.name ?? project.name,
    ...(patch.customer !== undefined ? { customer: patch.customer } : project.customer !== undefined ? { customer: project.customer } : {}),
    tenant: project.tenant,
    createdAt: now,
    ...(patch.archivedAt ? { archivedAt: patch.archivedAt } : {}),
  });
}

async function projectResponse(project: Project): Promise<{ project: Project; projects: Project[]; adminProjects: Project[] }> {
  const [projects, allProjects] = await Promise.all([availableProjects(), adminProjects()]);
  return { project, projects, adminProjects: allProjects };
}

export async function createManagedProject(nameInput: string, customerInput?: string): Promise<{ project: Project; projects: Project[]; adminProjects: Project[] }> {
  const name = validName(nameInput);
  const customer = validCustomer(customerInput);

  const registry = getStore(ADMIN_REGISTRY_TENANT);
  if ((await projectCatalog()).some((candidate) => sameName(candidate.name, name))) {
    throw new Error("A project with this name already exists");
  }

  const id = `project-${randomUUID()}`;
  const tenant = `${id}:live`;
  const record: ManagedProjectRecord = { id, name, ...(customer ? { customer } : {}), tenant, createdAt: new Date().toISOString() };

  // Every newly created project starts empty, even when local development is
  // displaying the bundled demo dataset for the default project.
  await getStore(tenant).updateState((draft) => replaceState(draft, buildInitialState("live")));
  await registry.updateState((draft) => {
    draft.managedProjects = validManagedProjects(draft);
    const configuredNames = configuredProjects()
      .filter((project) => !draft.managedProjects?.some((record) => record.id === project.id))
      .map((project) => project.name);
    if ([...configuredNames, ...draft.managedProjects.map((project) => project.name)].some((candidate) => sameName(candidate, name))) {
      throw new Error("A project with this name already exists");
    }
    draft.managedProjects.push(record);
  });

  return projectResponse({ id, name, ...(customer ? { customer } : {}) });
}

export async function renameProject(id: string, nameInput: string, customerInput?: string) {
  const name = validName(nameInput);
  const customer = validCustomer(customerInput);
  const project = (await projectCatalog()).find((candidate) => candidate.id === id);
  if (!project) throw new UnknownProjectError(id);
  const registry = getStore(ADMIN_REGISTRY_TENANT);
  await registry.updateState((draft) => {
    draft.managedProjects = validManagedProjects(draft);
    const configured = configuredProjects();
    const effectiveNames = configured.map((candidate) =>
      draft.managedProjects?.find((record) => record.id === candidate.id)?.name ?? candidate.name);
    const allNames = [
      ...effectiveNames,
      ...draft.managedProjects.filter((record) => !configured.some((candidate) => candidate.id === record.id)).map((record) => record.name),
    ];
    if (allNames.some((candidate) => !sameName(candidate, project.name) && sameName(candidate, name))) {
      throw new Error("A project with this name already exists");
    }
    setRecord(draft.managedProjects, project, { name, ...(customer !== undefined ? { customer } : {}) }, new Date().toISOString());
  });
  return projectResponse({ id, name, ...(customer !== undefined ? { customer } : project.customer ? { customer: project.customer } : {}), ...(project.archivedAt ? { archivedAt: project.archivedAt } : {}) });
}

const ACTIVE_JOB_STATES = new Set(["queued", "dispatching", "running", "waiting_for_evidence"]);

export function pauseProjectForArchive(state: AppState, archivedAt: string): void {
  state.projectArchivedAt = archivedAt;
  state.projectArchivePageFlags = Object.fromEntries(state.pages.map((page) => [page.id, page.flag]));
  for (const page of state.pages) {
    page.flag = "paused";
    delete page.runState;
    delete page.runId;
    delete page.startedAt;
  }
  for (const job of state.jobs ?? []) {
    if (!ACTIVE_JOB_STATES.has(job.state)) continue;
    job.state = "failed";
    job.error = "Project archived";
    job.updatedAt = archivedAt;
    job.completedAt = archivedAt;
    delete job.nextRetryAt;
    delete job.finalizationStartedAt;
  }
}

function isFlag(value: unknown): value is AppState["pages"][number]["flag"] {
  return value === "priority" || value === "watching" || value === "paused";
}

/** Reactivate an archived project without losing its pre-archive watchlist configuration. */
export function resumeProjectAfterArchive(state: AppState): void {
  const archivedFlags = state.projectArchivePageFlags;
  if (archivedFlags && typeof archivedFlags === "object") {
    for (const page of state.pages) {
      const priorFlag = archivedFlags[page.id];
      if (isFlag(priorFlag)) page.flag = priorFlag;
    }
  }
  delete state.projectArchivePageFlags;
  delete state.projectArchivedAt;
}

export async function archiveProject(id: string) {
  const catalog = await projectCatalog();
  const project = catalog.find((candidate) => candidate.id === id);
  if (!project) throw new UnknownProjectError(id);
  if (project.archivedAt) throw new Error("Project is already archived");
  if (catalog.filter((candidate) => !candidate.archivedAt).length <= 1) {
    throw new Error("At least one active project is required");
  }
  const archivedAt = new Date().toISOString();
  await getStore(project.tenant).updateState((draft) => pauseProjectForArchive(draft, archivedAt));
  await getStore(ADMIN_REGISTRY_TENANT).updateState((draft) => {
    draft.managedProjects = validManagedProjects(draft);
    setRecord(draft.managedProjects, project, { archivedAt }, archivedAt);
  });
  return projectResponse({ id, name: project.name, ...(project.customer ? { customer: project.customer } : {}), archivedAt });
}

export async function restoreProject(id: string) {
  const project = (await projectCatalog()).find((candidate) => candidate.id === id);
  if (!project) throw new UnknownProjectError(id);
  if (!project.archivedAt) throw new Error("Project is not archived");
  await getStore(project.tenant).updateState((draft) => {
    resumeProjectAfterArchive(draft);
  });
  await getStore(ADMIN_REGISTRY_TENANT).updateState((draft) => {
    draft.managedProjects = validManagedProjects(draft);
    setRecord(draft.managedProjects, project, { archivedAt: null }, new Date().toISOString());
  });
  return projectResponse({ id, name: project.name, ...(project.customer ? { customer: project.customer } : {}) });
}
