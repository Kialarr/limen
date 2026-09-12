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

The RKX `scripts/start-limen-pi` launcher puts this package and Node24 on PATH and sets
`LIMEN_INHERIT_SHOP=1`, so Pi gets Limen's manual alongside the compact project router. It does
not change global Pi settings, model defaults or hook trust. Pass Pi's own arguments as needed.
Use only one project extension set: the upstream limen stub or the old rkx stub, never both.

Update by fetching upstream, reviewing and rebasing these patches, running `npm run check`,
then testing a disposable Pi lifecycle before reloading active project coordinators. Do not
blindly pull new defaults into live sessions. The integration evidence lives in RKX
`spec/features/active/F051-direct-limen-adoption/`.
