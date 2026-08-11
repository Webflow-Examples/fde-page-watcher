"use client";

import { useState } from "react";
import { FolderSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import { useStore } from "@/components/store";

export default function AdminPage() {
  const { projects, project, createProject, projectCreating } = useStore();
  const [name, setName] = useState("");
  const trimmedName = name.trim();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!trimmedName || projectCreating) return;
    const created = await createProject(trimmedName);
    if (created) setName("");
  };

  return (
    <div className="admin-page">
      <header className="admin-page__header">
        <div>
          <div className="admin-page__eyebrow">Workspace administration</div>
          <h1>Projects</h1>
          <p>View every Page Watch project and create a new, empty project.</p>
        </div>
        <div className="admin-page__count" aria-label={`${projects.length} projects`}>
          <strong>{projects.length}</strong>
          <span>{projects.length === 1 ? "project" : "projects"}</span>
        </div>
      </header>

      <div className="admin-page__grid">
        <section className="admin-card" aria-labelledby="existing-projects-heading">
          <div className="admin-card__heading">
            <div>
              <h2 id="existing-projects-heading">Existing projects</h2>
              <p>All projects available in this Page Watch workspace.</p>
            </div>
          </div>
          <div className="admin-project-list">
            {projects.map((item) => {
              const current = item.id === project.id;
              return (
                <div className="admin-project-row" key={item.id}>
                  <span className="admin-project-row__icon" aria-hidden="true">
                    <FolderSimpleIcon size={18} weight="fill" />
                  </span>
                  <div className="admin-project-row__name">
                    <strong>{item.name}</strong>
                    <span>{current ? "Currently viewing" : "Available to switch"}</span>
                  </div>
                  <span className={`admin-project-row__status${current ? " admin-project-row__status--current" : ""}`}>
                    {current ? "Current" : "Active"}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="admin-card admin-card--create" aria-labelledby="create-project-heading">
          <span className="admin-card__create-icon" aria-hidden="true"><PlusIcon size={18} weight="bold" /></span>
          <h2 id="create-project-heading">Create a project</h2>
          <p>New projects start empty and appear immediately in the project selector.</p>
          <form onSubmit={submit}>
            <label htmlFor="new-project-name">Project name</label>
            <input
              id="new-project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              placeholder="e.g. Marketing site"
              autoComplete="off"
            />
            <button type="submit" disabled={!trimmedName || projectCreating}>
              <PlusIcon size={15} weight="bold" />
              {projectCreating ? "Creating…" : "Create project"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
