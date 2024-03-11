/**
 * WCAG relative-luminance contrast, implemented here rather than pulled from a package
 * so the accessibility test has no dependency that could silently change behaviour.
 *
 * Reference: WCAG 2.2, Understanding SC 1.4.3 (Contrast Minimum).
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function hexToRgb(hex: string): Rgb {
  const normalised = hex.replace('#', '').trim();
  const expanded =
    normalised.length === 3
      ? normalised
          .split('')
          .map((c) => c + c)
          .join('')
      : normalised;

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    throw new Error(`Not a hex colour: ${hex}`);
  }

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function channelLuminance(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: Rgb): number {
  return (
    0.2126 * channelLuminance(color.r) +
    0.7152 * channelLuminance(color.g) +
    0.0722 * channelLuminance(color.b)
  );
}

export function contrastRatio(foreground: string, background: string): number {
  const l1 = relativeLuminance(hexToRgb(foreground));
  const l2 = relativeLuminance(hexToRgb(background));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export const WCAG_AA_NORMAL_TEXT = 4.5;
export const WCAG_AA_LARGE_TEXT = 3;
export const WCAG_AA_NON_TEXT = 3;

export function meetsAaNormalText(foreground: string, background: string): boolean {
  return contrastRatio(foreground, background) >= WCAG_AA_NORMAL_TEXT;
}

export function meetsAaLargeText(foreground: string, background: string): boolean {
  return contrastRatio(foreground, background) >= WCAG_AA_LARGE_TEXT;
}
