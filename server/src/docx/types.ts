export type ParaKind =
  | 'name' | 'headerContact' | 'heading' | 'entryCompany' | 'entryHeader'
  | 'bullet' | 'body' | 'empty';

export type Section =
  | 'header' | 'summary' | 'strengths' | 'skills' | 'experience'
  | 'education' | 'projects' | 'certifications' | 'other';

export interface ModelParagraph {
  paraId: string;
  idx: number;            // index among all <w:p> in document order
  text: string;
  kind: ParaKind;
  section: Section;
  entryId: string | null;
  isBullet: boolean;
  inTable: boolean;
  hasHyperlink: boolean;
  mixedFormatting: boolean;  // >1 distinct run formats → flattening warning on edit
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
  sections: Record<string, string[]>;
}

export type EditOp = 'replace_text' | 'delete_paragraph' | 'insert_paragraph_after' | 'replace_skills_line';

export interface Edit {
  op: EditOp;
  paraId: string;
  newText?: string;
}

export interface AppliedEdit extends Edit {
  formattingFlattened?: boolean;
  insertedParaId?: string;
}
