# AKSARA Architecture

## Runtime
- Frontend: static SPA on GitHub Pages / gh-pages fallback.
- Backend: Supabase Postgres + Auth + private Storage.
- Browser uses only the Supabase publishable client key; no service-role credential is included.

## Source of truth
1. KMK HK.01.07/MENKES/1596/2024.
2. Hospital master: 16 Pokja / 221 EP.
3. Hospital Integration Matrix 1.0.0.
4. Operational evidence, verification and readiness.

## Core domain graph
Pokja -> Standard -> EP -> Evidence Requirement -> Evidence -> Version
EP <-> Evidence
EP -> Integration -> Integration Instance -> Checklist / Verification
Evidence + Integration -> Readiness -> Blocker -> Task

## Evidence principles
Evidence is reusable. The same logical evidence can support multiple EPs and requirements. File versions are immutable history records; the current version is referenced by the logical evidence item.

## Integration principles
The 2,074 matrix relations are versioned. Baseline 1.0.0 is published with A=REQUIRED and B/C=RECOMMENDED. This is hospital governance data, not an accreditation scoring instrument.

## Security
- Public: accreditation master and published integration metadata only.
- Private: users, scopes, evidence metadata, file objects, verification, tasks, readiness.
- RLS is enabled on application tables.
- Storage bucket is private.
- Audit log writes are server-side/trigger based.

## Readiness
Readiness is explanatory and blocker-first. It is not an official accreditation score. EP state is derived from published requirements, evidence validity/verification, mandatory integration execution and blockers.
