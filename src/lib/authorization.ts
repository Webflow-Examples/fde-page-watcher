import { identityFromRequest, isBootstrapAppAdmin, normalizeEmail, validEmail, type Identity } from "./identity";
import { getStore } from "./store";
import type { AppAdminGrant, AppState, ProjectMembership, ProjectRole } from "./types";

export const ADMIN_REGISTRY_TENANT = "page-watch-admin-registry:live";

export interface UserAccess {
  email: string;
  isAppAdmin: boolean;
  projectRoles: Record<string, ProjectRole>;
}

export interface AppAdminView {
  email: string;
  bootstrap: boolean;
  invitedBy?: string;
  invitedAt?: string;
}

export class AuthorizationError extends Error {
  readonly status: number;

  constructor(message = "You do not have access to this resource", status = 403) {
    super(message);
    this.name = "AuthorizationError";
    this.status = status;
  }
}

function validAppAdmins(state: AppState): AppAdminGrant[] {
  const seen = new Set<string>();
  return (Array.isArray(state.appAdmins) ? state.appAdmins : []).flatMap((grant) => {
    const email = normalizeEmail(typeof grant?.email === "string" ? grant.email : "");
    if (!validEmail(email) || isBootstrapAppAdmin(email) || seen.has(email)
      || typeof grant?.invitedBy !== "string" || typeof grant?.invitedAt !== "string") return [];
    seen.add(email);
    return [{ ...grant, email, invitedBy: normalizeEmail(grant.invitedBy) }];
  });
}

function validMemberships(state: AppState): ProjectMembership[] {
  const seen = new Set<string>();
  return (Array.isArray(state.projectMemberships) ? state.projectMemberships : []).flatMap((membership) => {
    const email = normalizeEmail(typeof membership?.email === "string" ? membership.email : "");
    const key = `${membership?.projectId}:${email}`;
    if (!validEmail(email) || typeof membership?.projectId !== "string" || !membership.projectId
      || (membership.role !== "project_admin" && membership.role !== "project_viewer")
      || typeof membership.invitedBy !== "string" || typeof membership.invitedAt !== "string" || seen.has(key)) return [];
    seen.add(key);
    return [{ ...membership, email, invitedBy: normalizeEmail(membership.invitedBy) }];
  });
}

async function registryState(): Promise<AppState> {
  return getStore(ADMIN_REGISTRY_TENANT).getState();
}

export async function accessForIdentity(identity: Identity): Promise<UserAccess> {
  const state = await registryState();
  return accessFromRegistryState(identity, state);
}

export function accessFromRegistryState(identity: Identity, state: AppState): UserAccess {
  const email = normalizeEmail(identity.email);
  const isAppAdmin = isBootstrapAppAdmin(email) || validAppAdmins(state).some((grant) => grant.email === email);
  const projectRoles = Object.fromEntries(validMemberships(state)
    .filter((membership) => membership.email === email)
    .map((membership) => [membership.projectId, membership.role])) as Record<string, ProjectRole>;
  return { email, isAppAdmin, projectRoles };
}

export async function accessForRequest(request: Request): Promise<UserAccess> {
  return accessForIdentity(await identityFromRequest(request));
}

export async function requireAppAdmin(request: Request): Promise<UserAccess> {
  const access = await accessForRequest(request);
  if (!access.isAppAdmin) throw new AuthorizationError("App administrator access is required");
  return access;
}

export async function requireProjectAccess(request: Request, projectId: string, required: "viewer" | "admin"): Promise<UserAccess> {
  const access = await accessForRequest(request);
  if (access.isAppAdmin) return access;
  const role = access.projectRoles[projectId];
  if (!role || (required === "admin" && role !== "project_admin")) {
    throw new AuthorizationError(required === "admin" ? "Project administrator access is required" : undefined);
  }
  return access;
}

export function isAccessError(error: unknown): error is AuthorizationError | import("./identity").AuthenticationError {
  return error instanceof AuthorizationError || (error instanceof Error && error.name === "AuthenticationError");
}

export function accessErrorStatus(error: unknown): number {
  return isAccessError(error) && "status" in error && typeof error.status === "number" ? error.status : 500;
}

export async function listAppAdmins(): Promise<AppAdminView[]> {
  const state = await registryState();
  const bootstrap: AppAdminView[] = ["matthew@webflow.com", "ben@webflow.com", "diego.rangel@webflow.com"]
    .map((email) => ({ email, bootstrap: true }));
  return [...bootstrap, ...validAppAdmins(state).map((grant) => ({ ...grant, bootstrap: false }))];
}

export async function addAppAdmin(emailInput: string, actor: string): Promise<AppAdminView[]> {
  const email = normalizeEmail(emailInput);
  if (!validEmail(email)) throw new Error("Enter a valid email address");
  if (!email.endsWith("@webflow.com")) throw new Error("App administrators must use a @webflow.com email address");
  if (isBootstrapAppAdmin(email)) return listAppAdmins();
  await getStore(ADMIN_REGISTRY_TENANT).updateState((draft) => {
    draft.appAdmins = validAppAdmins(draft);
    if (!draft.appAdmins.some((grant) => grant.email === email)) {
      draft.appAdmins.push({ email, invitedBy: normalizeEmail(actor), invitedAt: new Date().toISOString() });
    }
  });
  return listAppAdmins();
}

export async function removeAppAdmin(emailInput: string): Promise<AppAdminView[]> {
  const email = normalizeEmail(emailInput);
  if (isBootstrapAppAdmin(email)) throw new Error("Bootstrap app administrators cannot be removed");
  await getStore(ADMIN_REGISTRY_TENANT).updateState((draft) => {
    draft.appAdmins = validAppAdmins(draft).filter((grant) => grant.email !== email);
  });
  return listAppAdmins();
}

export async function listProjectMembers(projectId: string): Promise<ProjectMembership[]> {
  return validMemberships(await registryState()).filter((membership) => membership.projectId === projectId);
}

export async function setProjectMember(input: {
  projectId: string;
  email: string;
  role: ProjectRole;
  actor: UserAccess;
}): Promise<ProjectMembership[]> {
  const email = normalizeEmail(input.email);
  if (!validEmail(email)) throw new Error("Enter a valid email address");
  if (input.role !== "project_admin" && input.role !== "project_viewer") throw new Error("Select a valid project role");
  await getStore(ADMIN_REGISTRY_TENANT).updateState((draft) => {
    draft.projectMemberships = validMemberships(draft);
    const existing = draft.projectMemberships.find((membership) => membership.projectId === input.projectId && membership.email === email);
    if (existing) {
      const explicitAdmins = draft.projectMemberships.filter((membership) => membership.projectId === input.projectId && membership.role === "project_admin");
      if (existing.role === "project_admin" && input.role === "project_viewer" && explicitAdmins.length === 1 && !input.actor.isAppAdmin) {
        throw new Error("Only an app administrator can demote the final project administrator");
      }
      existing.role = input.role;
    }
    else draft.projectMemberships.push({
      projectId: input.projectId,
      email,
      role: input.role,
      invitedBy: input.actor.email,
      invitedAt: new Date().toISOString(),
    });
  });
  return listProjectMembers(input.projectId);
}

export async function removeProjectMember(projectId: string, emailInput: string, actor: UserAccess): Promise<ProjectMembership[]> {
  const email = normalizeEmail(emailInput);
  await getStore(ADMIN_REGISTRY_TENANT).updateState((draft) => {
    draft.projectMemberships = validMemberships(draft);
    const target = draft.projectMemberships.find((membership) => membership.projectId === projectId && membership.email === email);
    if (!target) return;
    const admins = draft.projectMemberships.filter((membership) => membership.projectId === projectId && membership.role === "project_admin");
    if (target.role === "project_admin" && admins.length === 1 && !actor.isAppAdmin) {
      throw new Error("Only an app administrator can remove the final project administrator");
    }
    draft.projectMemberships = draft.projectMemberships.filter((membership) => membership !== target);
  });
  return listProjectMembers(projectId);
}
