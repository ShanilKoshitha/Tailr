/**
 * The structural model of a parsed resume (DOCX → ResumeModel) and the four
 * surgical edit operations — the only mutations the engine ever performs.
 */

export type ParaKind =
  | 'name'
  | 'headerContact'
  | 'heading'
  | 'entryCompany'
  | 'entryHeader'
  | 'bullet'
  | 'body'
  | 'empty';

export type Section =
  | 'header'
  | 'summary'
  | 'strengths'
  | 'skills'
  | 'experience'
  | 'education'
  | 'projects'
  | 'certifications'
  | 'other';

export interface ModelParagraph {
  paraId: string;
  /** Index among all <w:p> elements in document order. */
  idx: number;
  text: string;
  kind: ParaKind;
  section: Section;
  entryId: string | null;
  isBullet: boolean;
  inTable: boolean;
  /** Hyperlink-bearing paragraphs are read-only (editing would strip <w:hyperlink>). */
  hasHyperlink: boolean;
  /** More than one run format — a plain-text replacement would flatten styling. */
  mixedFormatting: boolean;
}

export interface ModelEntry {
  entryId: string;
  headerId: string;
  title: string;
  company: string;
  bulletIds: string[];
}

export interface ResumeModel {
  paragraphs: ModelParagraph[];
  entries: ModelEntry[];
  sections: Partial<Record<Section, string[]>>;
}

export type EditOp =
  | 'replace_text'
  | 'delete_paragraph'
  | 'insert_paragraph_after'
  | 'replace_skills_line';

export interface Edit {
  op: EditOp;
  paraId: string;
  newText?: string;
}

export interface AppliedEdit extends Edit {
  formattingFlattened?: boolean;
  insertedParaId?: string;
}
