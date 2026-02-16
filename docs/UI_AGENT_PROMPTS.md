# UI Agent Prompt Pack (Claude Code via tmux)

Runbook: see `docs/UI_AGENT_HANDOFF_RUNBOOK.md` for bridge startup, tmux launch flags (`--chrome`, `--dangerously-skip-permissions`), monitoring loop, and troubleshooting.

Use these prompts as a template. Adapt endpoints, field names, and features to your project.
If your project has a backend API, start it before running these prompts.

## Prompt 1 - Static Shell
Build the initial UI shell with:
- stats/summary bar
- main list view
- detail panel

Use your project's API contracts and real field names from backend responses.
Include relevant status badges and indicators.

Output required:
1. Changed files
2. Test results
3. Screenshot paths (desktop + mobile)

## Prompt 2 - Live API Wiring
Wire live endpoints from your backend API.
Add loading, retry, empty state, and error state for every view.
Do not change backend contracts.

Output required:
1. Changed files
2. Test results
3. Screenshot paths

## Prompt 3 - Filters and Navigation
Implement filter/query controls relevant to your data model (e.g. type, status, search, pagination).
Persist filters in URL. Add keyboard navigation for high-volume workflows.

Output required:
1. Changed files
2. Test results
3. Screenshot paths

## Prompt 4 - Feature-Specific Views
Add any domain-specific views your project needs (e.g. comparison tables, detail modals, analytics dashboards).
Keep dependencies minimal.

Output required:
1. Changed files
2. Test results
3. Screenshot paths

## Prompt 5 - Hardening
Perform UX hardening for large data sets:
- virtualization/pagination tuning
- sticky filters
- row-level quick actions
- mobile layout correctness

Also add/expand component tests for edge states.

Output required:
1. Changed files
2. Test results
3. Screenshot paths
4. Unresolved risks list
