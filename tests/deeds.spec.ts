import { expect, test } from '@playwright/test';
import { DEFAULT_DEEDS, deedWording } from '../src/view/deeds';
import { DEED_TEMPLATES } from '../src/sim/level';

/** Deed templates: every one reads well at one and at many, and the usual set is unchanged. */

test('every template has wording for one and for many', () => {
  for (const template of DEED_TEMPLATES) {
    for (const count of [1, 7]) {
      const { title, flavour } = deedWording({ template, count });
      expect(title.length, `${template} ×${count} title`).toBeGreaterThan(3);
      expect(title).not.toContain('#');
      expect(flavour).not.toContain('#');
      if (count > 1 && !['burn-maypole', 'relaunch-dwarf', 'undo-cottages'].includes(template)) expect(title).toContain('7');
    }
  }
});

test('the author\'s own words win over the template', () => {
  expect(deedWording({ template: 'burn-haystacks', count: 3, title: 'Make hay', flavour: 'While the sun shines.' }))
    .toEqual({ title: 'Make hay', flavour: 'While the sun shines.' });
});

test('the usual deeds read exactly as Little Kindling always has', () => {
  expect(DEFAULT_DEEDS.map(d => deedWording(d).title)).toEqual([
    'Warm a dwarf', 'Teach a dwarf to fly', 'Fold a cottage flat', 'Toast the cheese', 'Frequent flyer',
    'Light the maypole', 'A chain of eight', 'Hay, hay, hay', 'Urban renewal', 'Clear-fell the woods', 'A small haunting'
  ]);
});
