# ADR-0001: Stack and repository layout

**Status:** accepted · 2026-10-23

**Context.** The repository was empty. The blueprint requires React + TypeScript + Vite + Tailwind with shadcn-style RTL components, TanStack Query/Table, React Hook Form + Zod, Django REST Framework, PostgreSQL, optional Celery + Redis, PWA offline capture and Docker deployment.

**Decision.** Mono-repo `backend/` (Django 5.2 LTS, DRF 3.18, drf-spectacular, psycopg 3, Celery 5.6), `frontend/` (React 19, Vite 6, Tailwind 4, Radix primitives, TanStack Query 5 / Table 8, RHF 7 + Zod 3, Recharts 2, vite-plugin-pwa, idb), `docs/`, `infra/`.

- Versions were pinned to known-compatible releases rather than the newest majors (e.g. Vite 8, TypeScript 7, TanStack Table 9 exist but were not adopted) to reduce risk.
- shadcn/ui's CLI was not used; components are hand-written in the same pattern (Radix + CVA + tailwind-merge) using logical CSS properties so they're natively RTL.
- Peyda is not supplied or licensed in the repo, so Vazirmatn (OFL, self-hosted through `@fontsource`) is the fallback; the font stack lists `Peyda` first so a licensed copy takes over when installed.
- Session cookie auth with CSRF (same origin through the Vite proxy or nginx) instead of tokens in localStorage.

**Consequences.** One deployable unit per tier; no external CDN dependency at runtime.
