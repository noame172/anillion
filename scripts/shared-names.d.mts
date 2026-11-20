export function norm(s: string): string;
export function isCharacterQuestion(text: string): boolean;
export function addSharedNames(answers: string[][]): { answers: string[][]; added: number };
export function isTitleQuestion(q: { category: string }): boolean;
export function addSeriesNames<T extends { text: string; category: string; answers: string[][] }>(questions: T[]): { questions: T[]; added: number };
