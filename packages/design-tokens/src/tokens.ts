/**
 * The AgriCore design tokens.
 *
 * This file is the only place a colour, a spacing step or a type size is decided. The
 * generator turns it into CSS custom properties for the web, a Swift enum for iOS and a
 * Kotlin object for Android, so the three clients cannot drift apart by hand-picking a
 * hex value that is nearly but not quite the brand colour.
 *
 * Every foreground and background pair used for text is checked against WCAG AA in
 * contrast.spec.ts. That test fails the build if a palette change breaks contrast, which
 * is the only way I have found to keep accessibility from rotting over time.
 */

export interface ColorToken {
  readonly light: string;
  readonly dark: string;
  readonly description: string;
}

/**
 * The palette is deliberately calm. A safety product that shouts in red at every screen
 * trains people to ignore red, which is exactly the wrong outcome when it matters.
 * Red is reserved for the active-alert state and nothing else.
 */
export const color = {
  // Surfaces
  'surface-base': {
    light: '#ffffff',
    dark: '#0d1117',
    description: 'Page background',
  },
  'surface-raised': {
    light: '#f5f7fa',
    dark: '#161b22',
    description: 'Cards, panels, sheets',
  },
  'surface-sunken': {
    light: '#e9edf3',
    dark: '#010409',
    description: 'Wells, code blocks, map chrome',
  },
  'surface-overlay': {
    light: '#ffffff',
    dark: '#1c2128',
    description: 'Modals and popovers',
  },

  // Text
  'text-primary': {
    light: '#12161c',
    dark: '#e6edf3',
    description: 'Body copy and headings',
  },
  'text-secondary': {
    light: '#4a5462',
    dark: '#9198a1',
    description: 'Supporting copy and labels',
  },
  'text-inverse': {
    light: '#ffffff',
    dark: '#0d1117',
    description: 'Text on a filled brand or danger surface',
  },
  'text-disabled': {
    light: '#767f8c',
    dark: '#6e7681',
    description: 'Disabled control labels',
  },

  // Brand
  'brand-primary': {
    light: '#0b5f8a',
    dark: '#3fa2d6',
    description: 'Primary actions and links',
  },
  'brand-primary-hover': {
    light: '#084a6c',
    dark: '#63b6e0',
    description: 'Primary action hover state',
  },
  'brand-subtle': {
    light: '#e2f0f8',
    dark: '#0d2c3d',
    description: 'Tinted brand background',
  },

  // Status
  'status-safe': {
    light: '#1a6b4a',
    dark: '#4bbf8a',
    description: 'Safe, resolved, arrived',
  },
  'status-safe-subtle': {
    light: '#e3f4ec',
    dark: '#0e2a1f',
    description: 'Safe state background',
  },
  'status-caution': {
    light: '#8a5a00',
    dark: '#e0aa42',
    description: 'Session overdue, degraded, pending',
  },
  'status-caution-subtle': {
    light: '#fdf1dc',
    dark: '#33260a',
    description: 'Caution state background',
  },
  'status-critical': {
    light: '#a51f2b',
    dark: '#f0616d',
    description: 'Active alert. Used nowhere else',
  },
  'status-critical-subtle': {
    light: '#fdeaec',
    dark: '#3d1116',
    description: 'Active alert background',
  },
  'status-neutral': {
    light: '#4a5462',
    dark: '#9198a1',
    description: 'Cancelled, archived, inactive',
  },

  // Lines and focus
  'border-default': {
    light: '#d3dae3',
    dark: '#30363d',
    description: 'Dividers and input borders',
  },
  'border-strong': {
    // Darker than a typical mid-grey border on purpose. The first version of this
    // palette used #9aa5b4, which scores 2.5 against white and fails the 3:1 non-text
    // contrast minimum. The contrast test caught it.
    light: '#6b7684',
    dark: '#6e7681',
    description: 'Emphasised borders and input outlines',
  },
  'focus-ring': {
    light: '#0b5f8a',
    dark: '#63b6e0',
    description: 'Keyboard focus indicator. Never removed, only restyled',
  },
} as const satisfies Record<string, ColorToken>;

export type ColorName = keyof typeof color;

/** A 4px base step. Every margin and padding in the product is a multiple of this. */
export const space = {
  '0': '0',
  '1': '0.25rem',
  '2': '0.5rem',
  '3': '0.75rem',
  '4': '1rem',
  '5': '1.5rem',
  '6': '2rem',
  '7': '3rem',
  '8': '4rem',
} as const;

export type SpaceName = keyof typeof space;

/**
 * A major-third-ish scale, capped at the top because a safety product does not need
 * display type. Line heights are unitless so they survive Dynamic Type on iOS and
 * font-size scaling on Android.
 */
export const fontSize = {
  xs: '0.75rem',
  sm: '0.875rem',
  base: '1rem',
  lg: '1.125rem',
  xl: '1.375rem',
  '2xl': '1.75rem',
  '3xl': '2.25rem',
} as const;

export const lineHeight = {
  tight: '1.25',
  normal: '1.5',
  relaxed: '1.7',
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export const fontFamily = {
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  mono: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
} as const;

export const radius = {
  none: '0',
  sm: '0.25rem',
  md: '0.5rem',
  lg: '0.75rem',
  pill: '999px',
} as const;

export const shadow = {
  sm: '0 1px 2px rgba(9, 17, 26, 0.08)',
  md: '0 4px 12px rgba(9, 17, 26, 0.10)',
  lg: '0 12px 32px rgba(9, 17, 26, 0.14)',
} as const;

/** Motion is short and respects prefers-reduced-motion at the consumer end. */
export const duration = {
  instant: '80ms',
  fast: '150ms',
  normal: '240ms',
} as const;

export const breakpoint = {
  sm: '480px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
} as const;

/** Minimum interactive target, from the WCAG 2.2 target-size guidance. */
export const MIN_TOUCH_TARGET_PX = 44;
