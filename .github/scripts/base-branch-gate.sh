#!/usr/bin/env bash
#
# Publishes the `base-branch-green` commit status on open pull requests.
#
# It answers one question: is the pipeline of the branch this PR would merge
# INTO passing right now? It runs no checks and adds no verification. It reads
# the result CI already produced for the base branch's tip commit and republishes
# it as a status on the PR, where branch protection can require it.
#
# Usage:
#   base-branch-gate.sh <base-branch> [pr-number ...]
#
# With no PR numbers, every open PR targeting <base-branch> is updated. That is
# how a PR un-blocks itself: when main's CI finishes, the gate re-runs and
# rewrites the status on all of them, so nobody has to push an empty commit to
# ask again.
#
# Environment:
#   GH_TOKEN   required, needs `statuses: write` on the repo
#   REPO       owner/name, defaults to the current repo
#   DRY_RUN    if set to 1, print what would be posted and post nothing
#
# Run it locally to see the current verdict without changing anything:
#   DRY_RUN=1 .github/scripts/base-branch-gate.sh main

set -euo pipefail

BASE_BRANCH="${1:-main}"
shift || true

REPO="${REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
DRY_RUN="${DRY_RUN:-0}"

# The workflow whose result counts as "the branch's own pipeline".
CI_WORKFLOW="${CI_WORKFLOW:-ci.yml}"

# A PR carrying this label is exempt. A repair is how a red branch becomes
# green again, so gating repairs on the branch being green would lock the
# branch shut. The exemption is not a judgement call and not silent: the label
# is on the PR and the claim is a row in REPAIRS.md.
REPAIR_LABEL="${REPAIR_LABEL:-repair}"

CONTEXT="base-branch-green"

log() { printf '%s\n' "$*" >&2; }

# ---------------------------------------------------------------------------
# The verdict on the base branch, computed once for all PRs that share it.
# ---------------------------------------------------------------------------

base_sha="$(gh api "repos/${REPO}/commits/${BASE_BRANCH}" --jq .sha)"
short_sha="${base_sha:0:7}"

# The newest CI run for that exact commit, whatever event produced it.
run_json="$(
  gh api "repos/${REPO}/actions/workflows/${CI_WORKFLOW}/runs?head_sha=${base_sha}&per_page=100" \
    --jq '[.workflow_runs[]] | sort_by(.run_started_at // .created_at) | last // empty'
)"

if [ -z "${run_json}" ]; then
  # Nothing has judged this commit. That is not a failure, and refusing merges
  # over it would gate on silence.
  state="success"
  description="No CI run found for ${BASE_BRANCH} @ ${short_sha}"
  target_url="https://github.com/${REPO}/commits/${BASE_BRANCH}"
else
  run_status="$(printf '%s' "${run_json}" | jq -r '.status')"
  run_conclusion="$(printf '%s' "${run_json}" | jq -r '.conclusion // ""')"
  target_url="$(printf '%s' "${run_json}" | jq -r '.html_url')"

  if [ "${run_status}" != "completed" ]; then
    state="pending"
    description="${BASE_BRANCH} @ ${short_sha} is still building"
  else
    case "${run_conclusion}" in
      success)
        state="success"
        description="${BASE_BRANCH} @ ${short_sha} is green"
        ;;
      failure | timed_out | startup_failure)
        state="failure"
        description="${BASE_BRANCH} @ ${short_sha} is failing (${run_conclusion}) - do not merge onto it"
        ;;
      cancelled | skipped | neutral | stale)
        # A cancelled run judged nothing, so it reports nothing. Treating it as
        # a failure is the false record this gate exists to stop repeating.
        state="success"
        description="${BASE_BRANCH} @ ${short_sha}: last run was ${run_conclusion}, not a failure"
        ;;
      *)
        state="success"
        description="${BASE_BRANCH} @ ${short_sha}: unrecognised conclusion ${run_conclusion}, not treated as failure"
        ;;
    esac
  fi
fi

log "base=${BASE_BRANCH} sha=${base_sha} state=${state}"
log "reason=${description}"

# ---------------------------------------------------------------------------
# The pull requests to publish it on.
# ---------------------------------------------------------------------------

if [ "$#" -gt 0 ]; then
  pr_numbers="$*"
else
  pr_numbers="$(
    gh pr list --repo "${REPO}" --base "${BASE_BRANCH}" --state open \
      --limit 100 --json number --jq '.[].number'
  )"
fi

if [ -z "${pr_numbers}" ]; then
  log "No open pull requests target ${BASE_BRANCH}; nothing to publish."
  exit 0
fi

exit_code=0

for pr in ${pr_numbers}; do
  pr_json="$(gh pr view "${pr}" --repo "${REPO}" --json headRefOid,labels,title,isDraft)"
  head_sha="$(printf '%s' "${pr_json}" | jq -r '.headRefOid')"
  has_repair_label="$(
    printf '%s' "${pr_json}" | jq -r --arg l "${REPAIR_LABEL}" \
      '[.labels[].name] | index($l) != null'
  )"

  pr_state="${state}"
  pr_description="${description}"

  if [ "${has_repair_label}" = "true" ] && [ "${state}" = "failure" ]; then
    pr_state="success"
    pr_description="Repair PR: gate waived so a red ${BASE_BRANCH} can be fixed. Claim it in REPAIRS.md."
  fi

  # The statuses API truncates past 140 characters; do it here so the text
  # stays a sentence rather than a fragment.
  pr_description="$(printf '%.140s' "${pr_description}")"

  if [ "${DRY_RUN}" = "1" ]; then
    printf 'would post: pr=#%s sha=%s state=%s "%s"\n' \
      "${pr}" "${head_sha}" "${pr_state}" "${pr_description}"
    continue
  fi

  if gh api --silent --method POST "repos/${REPO}/statuses/${head_sha}" \
    -f "state=${pr_state}" \
    -f "context=${CONTEXT}" \
    -f "description=${pr_description}" \
    -f "target_url=${target_url}"; then
    log "posted: pr=#${pr} sha=${head_sha} state=${pr_state}"
  else
    log "FAILED to post status on pr=#${pr} sha=${head_sha}"
    exit_code=1
  fi
done

exit "${exit_code}"
