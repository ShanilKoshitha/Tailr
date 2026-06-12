# Contributing to Tailr

Thanks for taking a look! Tailr is a local-first job tracker with format-preserving AI
resume tailoring. This guide gets you productive quickly.

## Setup

```bash
npm install        # installs all three workspaces (shared, server, client)
npm run dev        # server on :7777 (tsx watch) + client on :5173 (Vite, proxies /api)
```

Optional tools (the app degrades gracefully without them): Codex CLI for AI features,
LibreOffice for PDF previews/export, poppler for preview hover overlays. See the README.

## Project layout

```
shared/   @tailr/shared — domain & API types, the single source of truth
          imported by BOTH server and client (no type duplication)
server/   Fastify + better-sqlite3
  src/db/        row types (rows.ts) + typed query helpers (queries.ts)
  src/docx/      the format-preserving engine (parse → model, 4 edit ops)
  src/services/  ai/ (codex adapter, prompts, schemas), scoring, tailoring, convert, exec
  src/routes/    HTTP routes; bodies validated by JSON schema (bodySchemas.ts)
client/   React + Vite + Tailwind
  src/views/          route-level screens (Board, Studio, Resumes, Settings)
  src/components/     shared UI; board/ and studio/ hold the per-view pieces
```

## Quality bar

Every PR must pass CI, which runs exactly these:

```bash
npm run lint           # ESLint — @typescript-eslint, no-explicit-any is an ERROR
npm run format:check   # Prettier
npm run typecheck      # tsc --noEmit on all three workspaces
npm test               # DOCX engine round-trip + edit-op + parse tests
npm run build -w client
```

House rules the linters can't fully express:

- **No `any`.** Type DB rows in `server/src/db/rows.ts`, API shapes in `shared/`.
- **The user's resume file is sacred.** The DOCX engine may only mutate `<w:t>` text and
  whole `<w:p>` paragraphs — never re-serialize anything except `word/document.xml`. If you
  touch `server/src/docx/`, run the pixel-fidelity harness:
  `npm run test:fidelity -w server` (needs LibreOffice + poppler) — it must report ≥99.5%
  (it currently reports 100.000% on the fixture corpus).
- **Never put prompt/resume text on a CLI command line.** All child processes go through
  `server/src/services/exec.ts`; codex prompts travel over stdin (Windows-safe).
- **New endpoints**: add a JSON-schema body (`routes/bodySchemas.ts`), return errors as
  `{ error: string }`, and type the response in `shared/src/api.ts`.
- **AI calls**: one task = one prompt template + one AJV schema in
  `server/src/services/ai/`. The LLM never does arithmetic — scores are computed in
  `services/scoring.ts`.

## Tests

```bash
npm test                          # fast, no external tools needed
npm run test:fidelity -w server   # pixel-diff harness (LibreOffice + poppler)
npx tsx server/src/test/gen-fixtures.ts   # regenerate the synthetic resume fixtures
```

The real-resume regression test skips automatically when the (gitignored) personal fixture
isn't present, so a fresh clone always has a green `npm test`.
