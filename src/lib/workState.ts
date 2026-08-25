import type { WorkState } from "./vocabulary";
import type { TaskStatus } from "./types";

/**
 * Adapters from the store's legacy status strings to the seven F1 work states.
 *
 * The store predates the vocabulary registry and writes its own spellings —
 * `"in-progress"` with a hyphen where F1 declares `"in_progress"`, and a single
 * `"done"` where F1 splits shipped-but-unconfirmed from evidence-agreed. Every
 * `<StatusChip>` needs a `WorkState`, so without one shared translation each
 * call site invents its own ternary, which is the thing chunk F3 removes.
 *
 * This lives outside `vocabulary.ts` on purpose: that file mirrors
 * `vocabulary.json` and is checked against it, so legacy compatibility does not
 * belong there. Delete this file when the store writes F1 states directly.
 */

/**
 * A user-marked "done" becomes `resolved`, not `fixed`.
 *
 * F1 reserves `fixed` for "the change shipped, evidence has not agreed yet",
 * which puts a case in Watch with a checkpoint due. Every legacy record is
 * months old with nothing scheduled behind it, so `fixed` would fill Watch with
 * work nobody is going to re-verify. A person ticking a task off is the closest
 * thing this data has to an agreed outcome.
 *
 * This is display only. The storage-side migration is `stateFromTaskStatus` in
 * `src/lib/issue-case.ts`, and its `done` arm must stay in step with this one —
 * it also writes the "no checkpoint evidence was gathered" caveat into the
 * case's history, which is the condition this mapping was approved on.
 */
export const TASK_STATUS_WORK_STATE: Record<TaskStatus, WorkState> = {
  todo: "todo",
  "in-progress": "in_progress",
  done: "resolved",
};

export function taskStatusWorkState(status: TaskStatus): WorkState {
  return TASK_STATUS_WORK_STATE[status];
}
