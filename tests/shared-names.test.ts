import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addSharedNames, isCharacterQuestion } from '../scripts/shared-names.mjs';

const horimiya = [
  ['Kyouko Hori', 'common', 'Kyouko'],
  ['Kyousuke Hori', 'common'],
  ['Souta Hori', 'rare'],
  ['Yuriko Hori', 'rare'],
  ['Izumi Miyamura', 'common'],
  ['Iori Miyamura', 'rare'],
];

describe('names several characters share', () => {
  it('counts a shared surname as the character worth the fewest points', () => {
    const { answers } = addSharedNames(horimiya);
    expect(answers[0]).toEqual(['Kyouko Hori', 'common', 'Kyouko', 'Hori']);
    expect(answers[4]).toEqual(['Izumi Miyamura', 'common', 'Miyamura']);
    // Nobody else gets it, so the shared name is never worth more than the cheapest owner.
    expect(answers[1]).toEqual(['Kyousuke Hori', 'common']);
  });

  it('gives the name to the cheapest owner even when a pricier character is listed first', () => {
    const { answers } = addSharedNames([
      ['Aki Tanaka', 'rare'],
      ['Ben Tanaka', 'common'],
    ]);
    expect(answers[1]).toEqual(['Ben Tanaka', 'common', 'Tanaka']);
    expect(answers[0]).toEqual(['Aki Tanaka', 'rare']);
  });

  it('breaks a tie with the most popular character, which is listed first', () => {
    const { answers } = addSharedNames([['Aki Tanaka', 'common'], ['Ben Tanaka', 'common']]);
    expect(answers[0].includes('Tanaka')).toBe(true);
    expect(answers[1].includes('Tanaka')).toBe(false);
  });

  it('leaves names alone that are already answers or are plain descriptions', () => {
    const list = [
      ['Ace', 'common'],
      ['Ace Smith', 'rare'],
      ['Ace Jones', 'rare'],
      ['Tall Haha', 'common'],
      ['Short Haha', 'common'],
    ];
    const { answers, added } = addSharedNames(list);
    expect(added).toBe(0);
    expect(answers).toEqual(list);
  });

  it('can run twice and never changes the list it was given', () => {
    const copy = JSON.parse(JSON.stringify(horimiya));
    const once = addSharedNames(horimiya);
    expect(horimiya).toEqual(copy);
    expect(addSharedNames(once.answers).added).toBe(0);
  });

  it('applies to character questions only', () => {
    expect(isCharacterQuestion('Name a Horimiya character.')).toBe(true);
    expect(isCharacterQuestion('Name an anime made by MAPPA.')).toBe(false);
  });

  it('"Hori" is accepted as Kyouko Hori in the shipped data/seed.json', () => {
    const seed: { text: string; answers: string[][] }[] = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'seed.json'), 'utf8'));
    const q = seed.find((x) => x.text === 'Name a Horimiya character.')!;
    const owner = q.answers.find((a) => a.slice(2).includes('Hori'));
    expect(owner?.[0]).toBe('Kyouko Hori');
    expect(owner?.[1]).toBe('common');
  });
});

describe('series names for title questions', () => {
  const q = (text: string, category: string, answers: string[][]) => ({ text, category, answers });
  it('accepts the series name for a season, and an optional leading "The"', async () => {
    const { addSeriesNames } = await import('../scripts/shared-names.mjs');
    const { questions, added } = addSeriesNames([
      q('Name a manga series.', 'Manga', [['Dr. STONE', 'common'], ['The Seven Deadly Sins', 'common']]),
      q('Name a winter 2025 anime.', 'Era', [['Dr. STONE SCIENCE FUTURE', 'rare'], ['Summer Time Rendering', 'rare'], ['Summer', 'common']]),
    ]);
    expect(added).toBeGreaterThan(0);
    expect(questions[1].answers[0]).toEqual(['Dr. STONE SCIENCE FUTURE', 'rare', 'Dr. STONE']);
    // "Summer" is already an answer there, so it is never taken from it.
    expect(questions[1].answers[1]).toEqual(['Summer Time Rendering', 'rare']);
    expect(questions[0].answers[1]).toEqual(['The Seven Deadly Sins', 'common', 'Seven Deadly Sins']);
  });
  it('leaves character and studio questions alone', async () => {
    const { addSeriesNames } = await import('../scripts/shared-names.mjs');
    const list = [q('Name a Naruto character.', 'Naruto', [['Naruto Uzumaki', 'common']])];
    expect(addSeriesNames(list).added).toBe(0);
  });
});
