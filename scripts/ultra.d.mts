export const ULTRAS_PER_QUESTION: number;
export function countUltra(answers: string[][]): number;
export function ensureUltra(answers: string[][], want?: number): { answers: string[][]; promoted: number };
