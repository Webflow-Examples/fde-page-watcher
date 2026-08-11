import { randomUUID } from "node:crypto";
import { getEnv } from "./env";
import { buildInitialState } from "./seed";
import { deploymentTenant, getStore, type DataStore } from "./store";
import type { AppState, ManagedProjectRecord } from "./types";

export interface Project {
  id: string;
  name: string;
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
    const tenant = typeof candidate.tenant === "string" ? candidate.tenant.trim() : "";
    if (!id || id.length > 80 || !SAFE_ID.test(id)) {
      throw new Error(`PAGE_WATCH_PROJECTS[${index}].id is invalid`);
    }
    if (!name || name.length > 120) {
      throw new Error(`PAGE_WATCH_PROJECTS[${index}].name is invalid`);
    }
    if (!tenant || tenant.length > 160 || !SAFE_TENANT.test(tenant)) {
      throw new Error(`PAGE_WATCH_PROJECTS[${index}].tenant is invalid`);
    }
    if (ids.has(id)) throw new Error(`PAGE_WATCH_PROJECTS contains duplicate id ${id}`);
    ids.add(id);
    return { id, name, tenant };
  });
}

function configuredProjects(): ConfiguredProject[] {
  return parseProjectConfiguration(getEnv("PAGE_WATCH_PROJECTS"));
}

function validManagedProjects(state: AppState): ManagedProjectRecord[] {
  const seen = new Set<string>();
  if (!Array.isArray(state.managedProjects)) return [];
  return state.managedProjects.filter((project) => {
    if (
      typeof project?.id !== "string"
      || typeof project.name !== "string"
      || typeof project.tenant !== "string"
      || typeof project.createdAt !== "string"
      || !MANAGED_PROJECT_ID.test(project.id)
      || !project.name.trim()
      || project.name.length > 120
      || project.tenant !== `${project.id}:live`
      || !SAFE_TENANT.test(project.tenant)
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

export async function availableProjects(): Promise<Project[]> {
  const configured = configuredProjects();
  const configuredIds = new Set(configured.map(({ id }) => id));
  const managed = (await managedProjects()).filter(({ id }) => !configuredIds.has(id));
  return [
    ...configured.map(({ id, name }) => ({ id, name })),
    ...managed.map(({ id, name }) => ({ id, name })),
  ];
}

export function defaultConfiguredProject(): ConfiguredProject {
  return configuredProjects()[0];
}

export class UnknownProjectError extends Error {
  constructor(id: string) {
    super(`Unknown project: ${id}`);
    this.name = "UnknownProjectError";
  }
}

export function projectForRequest(request: Request): ConfiguredProject {
  const requestedId = new URL(request.url).searchParams.get("project");
  const projects = configuredProjects();
  if (!requestedId) return projects[0];
  const project = projects.find(({ id }) => id === requestedId);
  if (project) return project;
  if (MANAGED_PROJECT_ID.test(requestedId)) {
    return { id: requestedId, name: requestedId, tenant: `${requestedId}:live` };
  }
  throw new UnknownProjectError(requestedId);
}

export function projectStore(request: Request): DataStore {
  return getStore(projectForRequest(request).tenant);
}

function replaceState(target: AppState, source: AppState): void {
  for (const key of Object.keys(target) as Array<keyof AppState>) delete target[key];
  Object.assign(target, structuredClone(source));
}

export async function createManagedProject(nameInput: string): Promise<{ project: Project; projects: Project[] }> {
  const name = nameInput.trim();
  if (!name) throw new Error("Project name is required");
  if (name.length > 120) throw new Error("Project name must be 120 characters or fewer");

  const registry = getStore(ADMIN_REGISTRY_TENANT);
  const existing = [
    ...configuredProjects().map(({ name: configuredName }) => configuredName),
    ...(await managedProjects()).map(({ name: managedName }) => managedName),
  ];
  if (existing.some((candidate) => candidate.localeCompare(name, undefined, { sensitivity: "accent" }) === 0)) {
    throw new Error("A project with this name already exists");
  }

  const id = `project-${randomUUID()}`;
  const tenant = `${id}:live`;
  const record: ManagedProjectRecord = { id, name, tenant, createdAt: new Date().toISOString() };

  // Every newly created project starts empty, even when local development is
  // displaying the bundled demo dataset for the default project.
  await getStore(tenant).updateState((draft) => replaceState(draft, buildInitialState("live")));
  await registry.updateState((draft) => {
    draft.managedProjects = validManagedProjects(draft);
    if (draft.managedProjects.some((project) => project.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0)) {
      throw new Error("A project with this name already exists");
    }
    draft.managedProjects.push(record);
  });

  return { project: { id, name }, projects: await availableProjects() };
}
