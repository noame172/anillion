export const FORMS = ['base', 'ascended', 'azure', 'ultra'] as const;
export type Form = (typeof FORMS)[number];

/** Minimum total score for each hero form. */
export const FORM_MIN: Record<Form, number> = { base: 0, ascended: 200, azure: 350, ultra: 500 };

export const FORM_LABELS: Record<Form, string> = {
  base: 'Base Form',
  ascended: 'Ascended',
  azure: 'Azure Ascended',
  ultra: 'Ultra Form',
};

export function formForScore(score: number): Form {
  if (score >= FORM_MIN.ultra) return 'ultra';
  if (score >= FORM_MIN.azure) return 'azure';
  if (score >= FORM_MIN.ascended) return 'ascended';
  return 'base';
}

export type Progress = {
  form: Form;
  next: Form | null;
  pointsToNext: number;
  /** 0-100: how far through the current form's score band. */
  pct: number;
};

export function progressToNext(score: number): Progress {
  const form = formForScore(score);
  const idx = FORMS.indexOf(form);
  const next = idx < FORMS.length - 1 ? FORMS[idx + 1] : null;
  if (!next) return { form, next: null, pointsToNext: 0, pct: 100 };
  const floor = FORM_MIN[form];
  const ceil = FORM_MIN[next];
  return {
    form,
    next,
    pointsToNext: ceil - score,
    pct: Math.max(0, Math.min(100, Math.round(((score - floor) / (ceil - floor)) * 100))),
  };
}
