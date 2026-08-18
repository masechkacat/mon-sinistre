import { XmlElement } from '@rgrove/parse-xml';

function childElements(el: XmlElement): XmlElement[] {
  return el.children.filter(
    (child): child is XmlElement => child instanceof XmlElement,
  );
}

/** First direct child element named `name`, or `undefined`. */
export function findChild(
  el: XmlElement,
  name: string,
): XmlElement | undefined {
  return childElements(el).find((child) => child.name === name);
}

/** Direct child elements named `name`, in document order. */
export function findChildren(el: XmlElement, name: string): XmlElement[] {
  return childElements(el).filter((child) => child.name === name);
}

/** Depth-first descendants named `name`, anywhere under `el`. */
export function findDescendants(el: XmlElement, name: string): XmlElement[] {
  const result: XmlElement[] = [];
  for (const child of childElements(el)) {
    if (child.name === name) {
      result.push(child);
    }
    result.push(...findDescendants(child, name));
  }
  return result;
}

/**
 * Text of a direct child element named `name`, trimmed; `undefined` if the
 * child is absent, self-closed or blank.
 */
export function findChildText(
  el: XmlElement,
  name: string,
): string | undefined {
  const text = findChild(el, name)?.text.trim();
  return text === '' ? undefined : text;
}

/**
 * Text of `el` with each `<br/>` becoming a line break: JORF annexe cells
 * pack distinct sentences behind `<br/>`, not whitespace
 * (docs/research/jorf-monitor.md, "Отбор текстов и структура annexe") — a
 * plain `.text` concatenation would run them together. Blank lines left by
 * the source file's indentation are dropped.
 */
export function textWithLineBreaks(el: XmlElement): string {
  return collectText(el)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n');
}

/** Descends into child elements instead of taking their flattened `.text`, which would drop the `<br/>` nested inside them. */
function collectText(el: XmlElement): string {
  let text = '';
  for (const child of el.children) {
    if (child instanceof XmlElement) {
      text += child.name === 'br' ? '\n' : collectText(child);
    } else if ('text' in child) {
      text += child.text;
    }
  }
  return text;
}
