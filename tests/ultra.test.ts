import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { countUltra, ensureUltra, ULTRAS_PER_QUESTION } from '../scripts/ultra.mjs';

const list = (...tiers: string[]) => tiers.map((tier, i) => [`Answer ${i + 1}`, tier]);

describe('every question has ultra answers', () => {
  it('promotes the least popular answers when a question has none', () => {
    const { answers, promoted } = ensureUltra(list('common', 'rare', 'epic', 'epic', 'epic'));
    expect(promoted).toBe(2);
    expect(answers.map((a) => a[1])).toEqual(['common', 'rare', 'epic', 'ultra', 'ultra']);
  });

  it('only adds what is missing and leaves a complete question alone', () => {
    expect(ensureUltra(list('common', 'epic', 'epic', 'ultra')).answers.map((a) => a[1])).toEqual(['common', 'epic', 'ultra', 'ultra']);
    const complete = list('common', 'epic', 'ultra', 'ultra');
    const result = ensureUltra(complete);
    expect(result.promoted).toBe(0);
    expect(result.answers).toBe(complete);
  });

  it('never changes the list it was given, and keeps aliases', () => {
    const input = [['Alpha', 'common', 'A1'], ['Beta', 'rare'], ['Gamma', 'epic', 'G1', 'G2']];
    const copy = JSON.parse(JSON.stringify(input));
    const { answers } = ensureUltra(input);
    expect(input).toEqual(copy);
    expect(answers[2]).toEqual(['Gamma', 'ultra', 'G1', 'G2']);
    expect(countUltra(answers)).toBe(ULTRAS_PER_QUESTION);
  });

  it('holds for every question in the shipped data/seed.json', () => {
    const seed: { text: string; answers: string[][] }[] = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'seed.json'), 'utf8'));
    const lacking = seed.filter((q) => countUltra(q.answers) < ULTRAS_PER_QUESTION).map((q) => q.text);
    expect(lacking).toEqual([]);
  });
});
