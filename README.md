# 🧵 Tailr

**Local-first job search platform with format-preserving AI resume tailoring.**
A free, self-hosted alternative to Huntr Pro — kanban job tracker + AI resume tailoring that
**never re-templates your resume**. Your DOCX stays your DOCX; the AI only rewrites the text
of the exact lines you approve.

> Full product spec lives in [PRD.md](PRD.md).

## Why

- AI resume tools flatten your carefully formatted resume into *their* template. Tailr mutates
  only the `<w:t>` text nodes inside your original DOCX — fonts, colors, columns, tables and
  layout pass through untouched.
- Inference runs through the **OpenAI Codex CLI** authenticated with your ChatGPT account
  (OAuth), so there's no API bill — it rides the subscription you already pay for.
- Everything is local: SQLite + flat files. Delete the folder, delete everything.

## Features

- **Kanban board** — Wishlist → Applied → Interview → Offer → Rejected, drag-and-drop
  (`@dnd-kit`), job drawer with details, activities (with due dates), contacts, archive,
  search/filter, per-stage conversion metrics.
- **JD analysis** — paste a job description; AI extracts qualifications, responsibilities,
  keywords and the "title essence", cached on the job card.
- **Job Match Score** — weighted semantic score (Quals 35% · Resp 30% · Keywords 25% ·
  Title 10%), with covered / partial / missing breakdown per item. Verdicts come from the
  LLM; the math is deterministic app code.
- **Tailoring Studio** — three panes: JD + extracted items (left), pixel-accurate PDF preview
  of *your* file (center, via LibreOffice + pdf.js), suggestion cards (right) with red/green
  word diffs, accept ✓ / reject ✗ / regenerate ↻ / edit ✎, undo, optimistic score updates,
  "Fix with AI" on any missing item or keyword, keyword chip cloud.
- **Truthfulness guardrails** — the AI may reframe and re-emphasize but never invent
  employers, titles, dates, degrees or tools. Anything new carries a yellow "verify this is
  true" banner and `[X]` placeholders for numbers you must fill in.
- **Export** — PDF or DOCX, named like `{Name}_Resume_{Company}.pdf`, logged as an activity.

## Setup

Requirements: **Node 20+**. Optional but recommended:

| Tool | Used for | Install (macOS) |
|---|---|---|
| [Codex CLI](https://github.com/openai/codex) | All AI features | `npm i -g @openai/codex` then sign in via Settings |
| LibreOffice | PDF preview + PDF export | `brew install --cask libreoffice` |
| poppler (`pdftotext`) | Hover highlights on the preview | `brew install poppler` |

The app runs without them — Settings shows live status and install hints for each.

```bash
git clone <this repo> && cd Tailr
npm install
npm start          # builds the client, serves everything at http://localhost:7777
# or for development (hot reload, client on :5173 proxying the API):
npm run dev
```

First run:
1. Open **Settings** → connect ChatGPT (or paste an API key as fallback).
2. Open **Resumes** → drop in your `.docx` resume (PDFs are rejected by design — formatting
   can't be preserved through a PDF round trip).
3. Add a job on the **Board** with its pasted JD → open the card → **Tailor resume for this
   job** → review, accept, export.

## Architecture

```
client/   React 18 + Vite + TypeScript + Tailwind 4 (+ @dnd-kit, pdf.js)
server/   Node + Fastify + better-sqlite3
  src/docx/      format-preserving engine: JSZip + @xmldom/xmldom,
                 parse → model.json, 4 surgical edit ops (see PRD §6)
  src/services/  ai/ (codex exec adapter + prompts + AJV schemas),
                 scoring (deterministic), tailoring (pipeline), convert (soffice)
  src/routes/    REST API per PRD §10 + SSE event bus
demos/    original Python prototypes the DOCX engine was ported from
```

Data lives in `app.db` + `storage/` (gitignored). Every AI prompt/response is logged to
`logs/ai/` for debugging.

```bash
npm test   # DOCX round-trip + edit-op test suite
```

## Status

v1 core loop is implemented end-to-end. See [AGENT_HANDOFF.md](AGENT_HANDOFF.md) for the
detailed state of each PRD milestone and what's intentionally left for follow-ups.
