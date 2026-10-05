import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator } from '@playwright/test';

const globalsPath = path.resolve(
  __dirname,
  '..',
  '..',
  'src',
  'app',
  'globals.css',
);

/** The roles are the only variables holding a colour literal. */
const roleDeclaration = /^\s*(--[a-z-]+):\s*(#[0-9a-f]{6});/gim;

const darkBlock = /@media \(prefers-color-scheme: dark\)([\s\S]*?)\n}\n/;

export type Roles = Record<string, string>;

function declarations(css: string): Roles {
  const roles: Roles = {};
  for (const [, name, hex] of css.matchAll(roleDeclaration)) {
    roles[name.slice(2)] = hex;
  }
  return roles;
}

/**
 * The roles as the browser resolves them: the dark theme overrides some of the
 * light values and inherits the rest — the sheet keeps its own.
 */
export function roles(): { light: Roles; dark: Roles } {
  const css = readFileSync(globalsPath, 'utf8');
  const dark = darkBlock.exec(css);
  if (!dark) throw new Error('globals.css: no dark theme block');
  const light = declarations(css.replace(dark[0], ''));
  return { light, dark: { ...light, ...declarations(dark[1]) } };
}

const channels = (hex: string) =>
  [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));

/** A role hex as `getComputedStyle` reports a colour painted with it. */
export const toRgb = (hex: string) => `rgb(${channels(hex).join(', ')})`;

/** Относительная яркость sRGB — WCAG 2.x, определение relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Контраст пары цветов по WCAG 2.x, от 1 до 21. */
export function contrastRatio(a: string, b: string): number {
  const [dark, light] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (light + 0.05) / (dark + 0.05);
}

/** The colours a control is painted with: every background from the
 * root down composited onto one canvas pixel, since `bg-input/30` and the
 * like are translucent and only mean something over what lies beneath. */
export const paintedColours = (control: Locator) =>
  control.evaluate((element) => {
    const context = document.createElement('canvas').getContext('2d')!;
    const pixel = () =>
      '#' +
      Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3))
        .map((channel) => channel.toString(16).padStart(2, '0'))
        .join('');
    const chain: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      chain.unshift(node);
    }
    for (const node of chain) {
      context.fillStyle = getComputedStyle(node).backgroundColor;
      context.fillRect(0, 0, 1, 1);
    }
    const background = pixel();
    context.fillStyle = getComputedStyle(element).color;
    context.fillRect(0, 0, 1, 1);
    return { background, text: pixel() };
  });
