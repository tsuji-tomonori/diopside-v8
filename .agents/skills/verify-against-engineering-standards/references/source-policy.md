# Standards source policy

- Prefer the issuing body's official page for external standards. Repository-owned standards use the canonical repository URL and a local artifact SHA-256. Secondary summaries cannot establish the current external version or replace the repository-owned source.
- The registry pins `version`, `url`, `checked_at`, `refresh_days`, `scope`, `change_checked_at`, `change_summary`, and a local artifact SHA-256 when applicable. This makes a review reproducible while forcing periodic revalidation.
- A changed official page does not automatically rewrite requirements or checklist rules. Open a governed delta, describe the source change, affected checks, migration impact, and evidence.
- SWEBOK supplies software-engineering lifecycle knowledge areas. Vendor Well-Architected frameworks supply workload-specific cloud practices. They complement rather than replace product requirements and are not universal pass/fail standards.
- SWEBOK scope claims must map all 18 knowledge areas and explain direct coverage, partial alignment, and exclusions. Use “reference/alignment” unless an independently justified compliance claim exists.
- Select profiles in this order: Core, Cloud Common, actual vendor delta, then conditional AI/regulatory/availability profiles. Reuse evidence for duplicate controls and count one root risk once.
- Cloud frameworks evolve continuously. Google explicitly describes continuous updates; therefore passing a historical checklist without a freshness check must not be reported as current best-practice compliance.

Primary entry points are maintained in `governance/standards/registry.json`, copied byte-for-byte to `assets/standards.registry.json`, and generated into `docs/standards/SOURCES.md`.
