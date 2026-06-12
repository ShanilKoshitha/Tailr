# 🧵 Tailr

**Local-first job search platform with format-preserving AI resume tailoring.**
A free, self-hosted alternative to Huntr Pro — kanban job tracker + AI resume tailoring that
**never re-templates your resume**. Your DOCX stays your DOCX; the AI only rewrites the text
of the exact lines you approve.

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

## Quick start

```bash
git clone <this repo> Tailr && cd Tailr
npm install
npm start
```

Open **http://localhost:7777**. That's the whole app. The three optional tools below unlock
AI tailoring, PDF preview, and hover highlights — install them whenever you're ready; the app
runs without them and **Settings → status** tells you live what's missing.

## Requirements

| Dependency | Required? | What it powers |
|---|:---:|---|
| **Node.js 20+** | ✅ Required | Runs the whole app (server + build) |
| **[Codex CLI](https://github.com/openai/codex)** | ⭐ For AI | JD analysis, match score, resume tailoring (rides your ChatGPT plan) |
| **LibreOffice** | ◇ Recommended | Pixel-accurate PDF preview + PDF export (DOCX export works without it) |
| **poppler** (`pdftotext`) | ◇ Optional | Hover-highlight overlays on the resume preview |

### Installing the optional tools

<details open><summary><b>macOS</b></summary>

```bash
npm install -g @openai/codex                 # AI
brew install --cask libreoffice              # PDF preview/export
brew install poppler                         # hover highlights
```
</details>

<details><summary><b>Windows</b></summary>

```powershell
npm install -g @openai/codex                                   # AI
winget install TheDocumentFoundation.LibreOffice               # PDF preview/export
choco install poppler   # (or: scoop install poppler)          # hover highlights
```

LibreOffice is auto-detected at `C:\Program Files\LibreOffice`. Ensure `pdftotext` is on your
`PATH` (choco/scoop handle this). codex is installed as a `.cmd` shim — Tailr spawns it
through a shell automatically, no extra setup.
</details>

<details><summary><b>Linux (Debian/Ubuntu)</b></summary>

```bash
npm install -g @openai/codex                 # AI
sudo apt install -y libreoffice poppler-utils
```
</details>

## Definitive install & first run

Step-by-step, copy-paste safe. Each step is independent and verifiable.

```bash
# 1. Clone and install JS dependencies (the only mandatory step)
git clone <this repo> Tailr && cd Tailr
npm install

# 2. (Recommended) install the AI engine and sign in to your ChatGPT account
npm install -g @openai/codex
codex login            # opens a browser OAuth flow; you can also do this from Settings

# 3. Verify the toolchain is visible (all optional, but confirms your setup)
node --version         # must print v20 or higher
codex --version        # AI features
soffice --version      # PDF preview/export  (mac: /Applications/LibreOffice.app/... )
pdftotext -v           # hover highlights

# 4. Launch
npm start              # production: builds the client, serves app at http://localhost:7777
#   – or –
npm run dev            # development: hot reload, client on :5173 proxying the API on :7777
```

Then in the browser at **http://localhost:7777**:

1. **Settings** → confirm "Codex connected" (or click **Connect ChatGPT**; or paste an API
   key as a fallback). Settings also shows green/grey status dots for LibreOffice + poppler.
2. **Resumes** → drag in your `.docx` resume. *(PDFs are rejected by design — their formatting
   can't survive a round trip; export your resume to .docx first.)*
3. **Board** → **＋ Add job**, paste the job description → open the card → **Tailor resume for
   this job** → **AI Tailor** → accept/reject suggestions → **Export PDF/DOCX**.

### Environment variables (optional)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `7777` | Port the server listens on |
| `TAILR_DATA_DIR` | repo root | Where `app.db`, `storage/`, and `logs/` are written |

## For AI agents

Working on this repo programmatically? This sequence is deterministic:

```bash
npm install                          # install everything (npm workspaces: server + client)
npm run build -w server              # type-check the server (tsc --noEmit)
npm run build -w client              # type-check + bundle the client
npm test                             # DOCX round-trip + edit-op + real-resume parse tests
npm run test:fidelity -w server      # pixel-fidelity harness (needs LibreOffice + poppler)
```

- The round-trip and parse tests are self-contained; the real-resume test **skips cleanly**
  if `shanil-hewage.docx` (gitignored personal data) isn't present.
- `server/test-fixtures/` holds committed synthetic resumes (`npx tsx src/test/gen-fixtures.ts`
  regenerates them) for the fidelity harness and the `resume.classify` fallback path.
- Never spawn `codex` or `soffice` on a command line that embeds resume/JD text — Tailr routes
  all CLI calls through `server/src/services/exec.ts` (prompts go over **stdin**, cross-platform).

## Architecture

```
client/   React 18 + Vite + TypeScript + Tailwind 4 (+ @dnd-kit, pdf.js)
server/   Node + Fastify + better-sqlite3
  src/docx/      format-preserving engine: JSZip + @xmldom/xmldom,
                 parse → model.json, 4 surgical edit ops
  src/services/  ai/ (codex exec adapter + prompts + AJV schemas),
                 scoring (deterministic), tailoring (pipeline), convert (soffice)
  src/routes/    REST API + SSE event bus
demos/    original Python prototypes the DOCX engine was ported from
```

Data lives in `app.db` + `storage/` (gitignored). Every AI prompt/response is logged to
`logs/ai/` for debugging.

```bash
npm test   # DOCX round-trip + edit-op test suite
```

## Status

v1 core loop is implemented end-to-end: upload a DOCX, analyze a JD, score the match, run
AI Tailor, accept/reject suggestions on a pixel-accurate preview, and export PDF/DOCX — all
local, all format-preserving.
