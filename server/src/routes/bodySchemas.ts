/**
 * Fastify JSON-schema bodies. Invalid payloads are rejected with 400 before
 * a handler runs, so handlers can trust their (typed) input.
 */

const str = { type: 'string' } as const;
const optionalStr = { type: 'string', maxLength: 100_000 } as const;

export const createJobBody = {
  type: 'object',
  required: ['stageId'],
  additionalProperties: false,
  properties: {
    stageId: str,
    title: optionalStr,
    company: optionalStr,
    location: optionalStr,
    url: optionalStr,
    salary: optionalStr,
    postDate: optionalStr,
    jdText: optionalStr,
    color: { type: ['string', 'null'] },
  },
} as const;

export interface CreateJobBody {
  stageId: string;
  title?: string;
  company?: string;
  location?: string;
  url?: string;
  salary?: string;
  postDate?: string;
  jdText?: string;
  color?: string | null;
}

export const patchJobBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stageId: str,
    position: { type: 'integer', minimum: 0 },
    title: optionalStr,
    company: optionalStr,
    location: optionalStr,
    url: optionalStr,
    salary: optionalStr,
    postDate: optionalStr,
    jdText: optionalStr,
    color: { type: ['string', 'null'] },
    isArchived: { type: 'integer', enum: [0, 1] },
  },
} as const;

export interface PatchJobBody {
  stageId?: string;
  position?: number;
  title?: string;
  company?: string;
  location?: string;
  url?: string;
  salary?: string;
  postDate?: string;
  jdText?: string;
  color?: string | null;
  isArchived?: 0 | 1;
}

export const activityBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ['applied', 'interview', 'follow_up', 'note'] },
    title: optionalStr,
    body: optionalStr,
    dueAt: { type: ['integer', 'null'] },
    done: { type: 'boolean' },
  },
} as const;

export interface ActivityBody {
  type?: 'applied' | 'interview' | 'follow_up' | 'note';
  title?: string;
  body?: string;
  dueAt?: number | null;
  done?: boolean;
}

export const contactBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: optionalStr,
    role: optionalStr,
    email: optionalStr,
    linkedin: optionalStr,
    notes: optionalStr,
  },
} as const;

export interface ContactBody {
  name?: string;
  role?: string;
  email?: string;
  linkedin?: string;
  notes?: string;
}

export const stageBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', maxLength: 60 },
    color: { type: 'string', maxLength: 20 },
    position: { type: 'integer', minimum: 0 },
    is_terminal: { type: 'integer', enum: [0, 1] },
  },
} as const;

export interface StageBody {
  name?: string;
  color?: string;
  position?: number;
  is_terminal?: 0 | 1;
}

export const tailoredEditBody = {
  type: 'object',
  required: ['action'],
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['accept', 'reject', 'undo'] },
    suggestionId: str,
    editedText: optionalStr,
    manualEdit: {
      type: 'object',
      required: ['op', 'paraId'],
      additionalProperties: false,
      properties: {
        op: {
          type: 'string',
          enum: ['replace_text', 'delete_paragraph', 'insert_paragraph_after', 'replace_skills_line'],
        },
        paraId: str,
        newText: optionalStr,
      },
    },
  },
} as const;

export interface TailoredEditBody {
  action: 'accept' | 'reject' | 'undo';
  suggestionId?: string;
  editedText?: string;
  manualEdit?: {
    op: 'replace_text' | 'delete_paragraph' | 'insert_paragraph_after' | 'replace_skills_line';
    paraId: string;
    newText?: string;
  };
}

export const settingsBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ai_model: optionalStr,
    ai_reasoning: { type: 'string', enum: ['', 'low', 'medium', 'high'] },
    openai_api_key: optionalStr,
    soffice_path: optionalStr,
    export_pattern: optionalStr,
    allow_new_bullets: { type: 'string', enum: ['0', '1'] },
    max_new_bullets: optionalStr,
    aggressive_trimming: { type: 'string', enum: ['0', '1'] },
  },
} as const;

export type SettingsBody = Partial<
  Record<
    | 'ai_model'
    | 'ai_reasoning'
    | 'openai_api_key'
    | 'soffice_path'
    | 'export_pattern'
    | 'allow_new_bullets'
    | 'max_new_bullets'
    | 'aggressive_trimming',
    string
  >
>;
