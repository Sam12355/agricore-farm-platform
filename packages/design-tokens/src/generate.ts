import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  breakpoint,
  color,
  duration,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  MIN_TOUCH_TARGET_PX,
  radius,
  shadow,
  space,
} from './tokens';

/**
 * Emits the token files the three clients consume.
 *
 * This runs as part of `pnpm build` in this package. The generated files are committed
 * so that the iOS and Android projects, which have no idea Node exists, can be opened
 * and built without running anything from the JavaScript toolchain first.
 */

const BANNER_LINES = [
  'GuardianLink design tokens.',
  '',
  'Generated from packages/design-tokens/src/tokens.ts.',
  'Do not edit by hand: run `pnpm --filter @guardianlink/design-tokens build` instead.',
];

function comment(lines: string[], prefix: string): string {
  return lines.map((line) => (line ? `${prefix} ${line}` : prefix)).join('\n');
}

function write(relativePath: string, contents: string): void {
  const target = resolve(__dirname, '..', relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents.endsWith('\n') ? contents : `${contents}\n`, 'utf8');
  console.log(`wrote ${relativePath}`);
}

function cssBlock(mode: 'light' | 'dark'): string {
  return Object.entries(color)
    .map(([name, token]) => `  --gl-color-${name}: ${token[mode]};`)
    .join('\n');
}

function generateCss(): string {
  const scalars = [
    ...Object.entries(space).map(([k, v]) => `  --gl-space-${k}: ${v};`),
    ...Object.entries(fontSize).map(([k, v]) => `  --gl-font-size-${k}: ${v};`),
    ...Object.entries(lineHeight).map(([k, v]) => `  --gl-line-height-${k}: ${v};`),
    ...Object.entries(fontWeight).map(([k, v]) => `  --gl-font-weight-${k}: ${v};`),
    ...Object.entries(fontFamily).map(([k, v]) => `  --gl-font-family-${k}: ${v};`),
    ...Object.entries(radius).map(([k, v]) => `  --gl-radius-${k}: ${v};`),
    ...Object.entries(shadow).map(([k, v]) => `  --gl-shadow-${k}: ${v};`),
    ...Object.entries(duration).map(([k, v]) => `  --gl-duration-${k}: ${v};`),
    `  --gl-min-touch-target: ${MIN_TOUCH_TARGET_PX}px;`,
  ].join('\n');

  const breakpoints = Object.entries(breakpoint)
    .map(([k, v]) => `  --gl-breakpoint-${k}: ${v};`)
    .join('\n');

  const banner = ['/*', ...BANNER_LINES.map((line) => (line ? ` * ${line}` : ' *')), ' */'].join(
    '\n',
  );

  return `${banner}

:root {
${cssBlock('light')}
${scalars}
${breakpoints}
}

/* Follows the operating system unless the user has picked a theme explicitly. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
${cssBlock('dark')}
  }
}

:root[data-theme='dark'] {
${cssBlock('dark')}
}

:root[data-theme='light'] {
${cssBlock('light')}
}

/*
 * Honour the operating-system reduced-motion setting. The console animates incident
 * rows as they arrive; for someone who has asked for less motion that is not a nice
 * touch, it is a problem.
 */
@media (prefers-reduced-motion: reduce) {
  :root {
    --gl-duration-instant: 0ms;
    --gl-duration-fast: 0ms;
    --gl-duration-normal: 0ms;
  }
}
`;
}

function swiftColorLiteral(hex: string): string {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16) / 255;
  const g = Number.parseInt(value.slice(2, 4), 16) / 255;
  const b = Number.parseInt(value.slice(4, 6), 16) / 255;
  return `UIColor(red: ${r.toFixed(4)}, green: ${g.toFixed(4)}, blue: ${b.toFixed(4)}, alpha: 1)`;
}

function toCamelCase(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_match, character: string) => character.toUpperCase());
}

function generateSwift(): string {
  const entries = Object.entries(color)
    .map(([name, token]) => {
      const identifier = toCamelCase(name);
      return `    /// ${token.description}
    static let ${identifier} = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? ${swiftColorLiteral(token.dark)}
            : ${swiftColorLiteral(token.light)}
    }`;
    })
    .join('\n\n');

  const spacing = Object.entries(space)
    .map(([k, v]) => `    static let space${k}: CGFloat = ${remToPoints(v)}`)
    .join('\n');

  return `${comment(BANNER_LINES, '//')}

import UIKit

public enum GLColor {
${entries}
}

public enum GLSpacing {
${spacing}
}

public enum GLLayout {
    /// Minimum hit area, from the WCAG 2.2 target-size guidance.
    public static let minTouchTarget: CGFloat = ${MIN_TOUCH_TARGET_PX}
}
`;
}

function remToPoints(value: string): string {
  if (value === '0') return '0';
  const rem = Number.parseFloat(value.replace('rem', ''));
  return (rem * 16).toFixed(1);
}

function generateKotlin(): string {
  const light = Object.entries(color)
    .map(([name, token]) => `    val ${toCamelCase(name)} = Color(0xFF${token.light.slice(1).toUpperCase()})`)
    .join('\n');
  const dark = Object.entries(color)
    .map(([name, token]) => `    val ${toCamelCase(name)} = Color(0xFF${token.dark.slice(1).toUpperCase()})`)
    .join('\n');
  const spacing = Object.entries(space)
    .map(([k, v]) => `    val space${k} = ${remToPoints(v)}.dp`)
    .join('\n');

  return `${comment(BANNER_LINES, '//')}

package com.guardianlink.designtokens

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

object GLColorLight {
${light}
}

object GLColorDark {
${dark}
}

object GLSpacing {
${spacing}
}

object GLLayout {
    /** Minimum hit area, from the WCAG 2.2 target-size guidance. */
    val minTouchTarget = ${MIN_TOUCH_TARGET_PX}.dp
}
`;
}

function generateJson(): string {
  return `${JSON.stringify(
    {
      $comment: BANNER_LINES.join(' '),
      color,
      space,
      fontSize,
      lineHeight,
      fontWeight,
      radius,
      shadow,
      duration,
      breakpoint,
      minTouchTargetPx: MIN_TOUCH_TARGET_PX,
    },
    null,
    2,
  )}`;
}

function main(): void {
  write('generated/tokens.css', generateCss());
  write('generated/GLTokens.swift', generateSwift());
  write('generated/GLTokens.kt', generateKotlin());
  write('generated/tokens.json', generateJson());
}

main();
