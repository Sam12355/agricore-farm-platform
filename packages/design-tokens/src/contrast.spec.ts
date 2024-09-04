import { describe, expect, it } from 'vitest';

import {
  WCAG_AA_LARGE_TEXT,
  WCAG_AA_NON_TEXT,
  WCAG_AA_NORMAL_TEXT,
  contrastRatio,
  hexToRgb,
} from './contrast';
import { color, type ColorName } from './tokens';

type Mode = 'light' | 'dark';
const modes: Mode[] = ['light', 'dark'];

/**
 * Every foreground and background pairing the product actually uses. If a designer
 * changes a token and breaks one of these, the build fails here rather than shipping an
 * unreadable status badge to someone using the app at night.
 */
const textPairs: Array<{ fg: ColorName; bg: ColorName; label: string }> = [
  { fg: 'text-primary', bg: 'surface-base', label: 'body on page' },
  { fg: 'text-primary', bg: 'surface-raised', label: 'body on card' },
  { fg: 'text-primary', bg: 'surface-overlay', label: 'body in modal' },
  { fg: 'text-secondary', bg: 'surface-base', label: 'supporting on page' },
  { fg: 'text-secondary', bg: 'surface-raised', label: 'supporting on card' },
  { fg: 'brand-primary', bg: 'surface-base', label: 'link on page' },
  { fg: 'brand-primary', bg: 'surface-raised', label: 'link on card' },
  { fg: 'status-safe', bg: 'status-safe-subtle', label: 'safe badge' },
  { fg: 'status-caution', bg: 'status-caution-subtle', label: 'caution badge' },
  { fg: 'status-critical', bg: 'status-critical-subtle', label: 'critical badge' },
  { fg: 'status-neutral', bg: 'surface-base', label: 'neutral status on page' },
  { fg: 'text-inverse', bg: 'brand-primary', label: 'label on filled primary button' },
  { fg: 'text-inverse', bg: 'status-critical', label: 'label on a filled critical button' },
];

const nonTextPairs: Array<{ fg: ColorName; bg: ColorName; label: string }> = [
  { fg: 'border-strong', bg: 'surface-base', label: 'input border on page' },
  { fg: 'focus-ring', bg: 'surface-base', label: 'focus ring on page' },
  { fg: 'focus-ring', bg: 'surface-raised', label: 'focus ring on card' },
];

describe('hexToRgb', () => {
  it('parses a six digit hex', () => {
    expect(hexToRgb('#0b5f8a')).toEqual({ r: 11, g: 95, b: 138 });
  });

  it('expands a three digit hex', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('throws on something that is not a colour', () => {
    expect(() => hexToRgb('teal')).toThrow();
  });
});

describe('contrastRatio', () => {
  it('gives 21 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2);
  });

  it('gives 1 for a colour against itself', () => {
    expect(contrastRatio('#0b5f8a', '#0b5f8a')).toBeCloseTo(1, 5);
  });

  it('is order independent', () => {
    expect(contrastRatio('#12161c', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#12161c'), 5);
  });
});

describe.each(modes)('token contrast in %s mode', (mode) => {
  it.each(textPairs)('$label meets AA for normal text', ({ fg, bg }) => {
    const ratio = contrastRatio(color[fg][mode], color[bg][mode]);
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });

  it.each(nonTextPairs)('$label meets the non-text contrast minimum', ({ fg, bg }) => {
    const ratio = contrastRatio(color[fg][mode], color[bg][mode]);
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NON_TEXT);
  });

  it('keeps disabled text legible enough to read, even though AA exempts it', () => {
    // WCAG does not require contrast on disabled controls. A user still has to be able
    // to read what the disabled thing says, so we hold it to the large-text ratio.
    const ratio = contrastRatio(color['text-disabled'][mode], color['surface-base'][mode]);
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_LARGE_TEXT);
  });
});

describe('palette discipline', () => {
  it('defines every colour in both modes', () => {
    for (const [name, token] of Object.entries(color)) {
      expect(token.light, `${name}.light`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(token.dark, `${name}.dark`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(token.description.length, `${name}.description`).toBeGreaterThan(0);
    }
  });

  it('keeps critical and caution far enough apart in colour to be told apart', () => {
    // These two separate by hue rather than by luminance, so a contrast ratio is the
    // wrong measure here. A plain channel distance is a better proxy for "these do not
    // look like the same badge at a glance".
    for (const mode of modes) {
      const critical = hexToRgb(color['status-critical'][mode]);
      const caution = hexToRgb(color['status-caution'][mode]);
      const distance = Math.hypot(
        critical.r - caution.r,
        critical.g - caution.g,
        critical.b - caution.b,
      );
      expect(distance, `critical vs caution in ${mode}`).toBeGreaterThan(60);
    }
  });
});
