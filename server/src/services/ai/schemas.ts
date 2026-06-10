/** JSON Schemas for each AI task (validated with AJV in aiCall). PRD §7.2, §7.3, §8.4 */

export const jdAnalyzeSchema = {
  type: 'object',
  required: ['titleEssence', 'qualifications', 'responsibilities', 'keywords'],
  additionalProperties: true,
  properties: {
    titleEssence: { type: 'string' },
    qualifications: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'text', 'priority'],
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          priority: { enum: ['required', 'preferred'] },
        },
      },
    },
    responsibilities: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'text', 'priority'],
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          priority: { enum: ['primary', 'secondary'] },
        },
      },
    },
    keywords: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'text', 'type'],
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          type: { enum: ['hard', 'soft', 'domain'] },
        },
      },
    },
  },
} as const;

export const matchScoreSchema = {
  type: 'object',
  required: ['items', 'titleMatch'],
  additionalProperties: true,
  properties: {
    titleMatch: { enum: ['full', 'adjacent', 'distant'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['itemId', 'verdict'],
        properties: {
          itemId: { type: 'string' },
          verdict: { enum: ['covered', 'partial', 'missing'] },
          evidenceParaIds: { type: 'array', items: { type: 'string' } },
          explanation: { type: 'string' },
          suggestionHint: { type: 'string' },
        },
      },
    },
  },
} as const;

export const suggestionItemSchema = {
  type: 'object',
  required: ['id', 'op', 'paraId', 'newText'],
  properties: {
    id: { type: 'string' },
    op: { enum: ['replace_text', 'insert_paragraph_after', 'delete_paragraph', 'replace_skills_line'] },
    paraId: { type: 'string' },
    entryId: { type: ['string', 'null'] },
    newText: { type: 'string' },
    oldText: { type: 'string' },
    itemsCovered: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
    assumptionFlag: { type: 'boolean' },
    lineDelta: { type: 'number' },
  },
} as const;

export const tailorSuggestSchema = {
  type: 'object',
  required: ['suggestions'],
  additionalProperties: true,
  properties: {
    suggestions: { type: 'array', items: suggestionItemSchema },
  },
} as const;

export const rewriteOneSchema = {
  type: 'object',
  required: ['newText'],
  additionalProperties: true,
  properties: {
    newText: { type: 'string' },
    itemsCovered: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
    assumptionFlag: { type: 'boolean' },
  },
} as const;

export const bulletRelevanceSchema = {
  type: 'object',
  required: ['bullets'],
  additionalProperties: true,
  properties: {
    bullets: {
      type: 'array',
      items: {
        type: 'object',
        required: ['paraId', 'relevance'],
        properties: {
          paraId: { type: 'string' },
          relevance: { type: 'number' },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const;
