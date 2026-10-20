# Local RKX adaptations

Upstream baseline: `0283048c85f8aa278d9dae0307e9ff2bb3949e00` from
https://github.com/overment/limen. This directory is its own local Git repository;
`codex/rkx-adaptations` is the local adaptation branch. Nothing has been published.

Use upstream commands, supervision, wake routing, steering and default prompts. Changes are
limited to Foundation styleguide resolution, flexible document writing, an opt-in inherited
manual alongside compact project AGENTS.md, and explicit shared-checkout/resource execution.
The existing RKX Codex route is retained outside this package; Codex/Grok engines have not
been added to this fork. Do not describe them as supported by this fork.

`spec/foundation/styleguide.md` is authoritative when present. The old
`.agents/limen/styleguide.md` is a fallback only when the canonical file is absent; init preserves
existing content and reports the migration rather than overwriting it. Foundation, research and
notes stay project-owned, with selective links from vision and project guidance.

The linked `limen` command is available on PATH. On Node versions below 24 its executable
restarts once using `RKX_NODE`. The project Pi extension discovers this linked package,
puts Node 24 on its subprocess PATH, and defaults `LIMEN_INHERIT_SHOP=1` so normal `pi`
inherits the package manual alongside the project router. Explicit `0` remains respected.
No global Pi settings, model defaults or hook trust are changed.
Use only one project extension set: the upstream limen stub or the old rkx stub, never both.

Update by fetching upstream, reviewing and rebasing these patches, running `npm run check`,
then testing a disposable Pi lifecycle before reloading active project coordinators. Do not
blindly pull new defaults into live sessions. The integration evidence lives in RKX
`spec/features/active/F051-direct-limen-adoption/`.

## Stream completion repair

The detached wrapper coalesces repeated activity deltas before queuing filesystem work.
Git file-count scans run at most once per two seconds on tools plus a final refresh,
not per streamed token. Scan errors are advisory and cannot discard final answers.
This repairs upstream completion backlog on large repositories; fixture regressions
cover 4,000 streamed updates and oversized Git status output.

Existing-checkout review capture uses a disposable index with directory-based staging,
restores runtime paths in that index, and has a 180-second total Git budget (override:
LIMEN_CAPTURE_TIMEOUT_MS). Routing metadata precedes capture; captured setup errors
use ordinary terminal finalization and notifications. The launcher remains synchronous.

## Cross-checkout completion discovery

The Pi wake hook passes its session-bound registry address to child CLI commands via
LIMEN_WAKE_ORIGIN. Spawn and watch register canonical job paths; the existing sweep
observes registered external jobs only for their subscribed session, reusing completion
receipts and including the foreign checkout path in messages. No global scan or external
fallback/reaper is introduced. Reload existing Pi sessions, then watch existing foreign
jobs; new spawns register automatically. Shutdown restores the prior environment value.

## Ready-work continuation and board guidance

Coordinator instructions and normal completion/advisory wakes ask the owning session to
reconcile all authorized work and start ready independent assignments before ending its turn.
Blockers and repair limits stay scoped to the affected task; pauses, model/budget choices,
resource ownership and fallback/unwatched restrictions remain intact. This is prompt guidance,
not a scheduler or guarantee of model compliance. Board templates keep current commitments,
next actions and blockers concise, with detailed evidence in feature records.

## Fork backup

The adapted branch is backed up at https://github.com/Kialarr/limen/tree/codex/rkx-adaptations.
Project extensions load the shared local package; pushing the fork does not automatically
update other machines. Use this adapted branch rather than upstream main when reproducing
this setup. Reload existing Pi sessions after updating loaded hooks.
