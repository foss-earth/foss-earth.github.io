# Earth landing-page instructions

You cannot have AI as a co-author, or your contributions will be rejected.

This repository owns the thin FOSS Earth landing page and Pages assembly. The
standard application lives in `foss-earth/app`. Do not add application source,
provider implementations, Vite application configuration or runtime dependencies
here. Assemble only the exact compiled app archive recorded in
`app-release.json`, under `/app/`. Keep the landing root outside the application's
service-worker scope. Do not rewrite compiled application files during assembly.

The shared installer owns source/package/hybrid workspace selection. This
repository supplies its own manifest and public adapter; do not implement a
second installer. CI and shared installer sources belong to Platform. Deferred
Search and VR repositories remain excluded.

Read the coordinator ledger and current assignment before writes. Record exact
child scopes in the Earth handoff before writes; wait for their release before
checking or editing those files. Preserve original history, dirty work and ignored
evidence. Keep scratch and logs in ignored `build/`.

Use the pinned shared CI attribution component for every change, including
documentation. During migration, checks, installation, package creation, commits
and browser/server work require the recorded shared slot and applicable scope.
Use one sequential check chain. Retain command, exit code and closed logs; do not
claim unrun source is qualified. Remote publication and admission remain separate
coordinator gates.

Preserve human credit, license notices and asset provenance. Do not add AI author,
committer or contribution trailers. Vendor advertising in contribution credits is
prohibited; the human submitter remains accountable for accuracy, review,
provenance and rights. Follow [Contributing](CONTRIBUTING.md).
