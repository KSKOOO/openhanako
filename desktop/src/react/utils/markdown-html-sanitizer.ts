const ALLOWED_TAGS = new Set([
  'p', 'div', 'span', 'center',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'mark', 'small', 'sub', 'sup',
  'br', 'hr',
  'blockquote', 'pre', 'code',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'details', 'summary',
  'a',
]);

const REMOVE_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button',
  'textarea', 'select', 'link', 'meta', 'base',
]);

const GLOBAL_ATTRS = new Set(['title', 'style']);

const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const EXPLICIT_PROTOCOL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

const ALLOWED_CSS_PROPERTIES = new Set([
  'color',
  'background',
  'background-color',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-color',
  'border-style',
  'border-width',
  'border-radius',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'text-align',
  'font-weight',
  'font-style',
  'font-size',
  'line-height',
  'letter-spacing',
  'white-space',
  'display',
  'width',
  'max-width',
  'min-width',
  'height',
  'max-height',
  'min-height',
]);

const ALLOWED_DISPLAY_VALUES = new Set([
  'block',
  'inline',
  'inline-block',
  'flex',
  'inline-flex',
  'grid',
  'none',
]);

const UNSAFE_CSS_VALUE_RE = /url\s*\(|expression\s*\(|@import|javascript:|vbscript:|data:|file:|behavior\s*:/i;

function sanitizeHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;
  if (href.startsWith('#')) return href;
  if (!EXPLICIT_PROTOCOL_RE.test(href)) return null;

  try {
    const parsed = new URL(href);
    return SAFE_URL_PROTOCOLS.has(parsed.protocol) ? href : null;
  } catch {
    return null;
  }
}

function isSafeCssValue(value: string): boolean {
  if (UNSAFE_CSS_VALUE_RE.test(value)) return false;

  const lower = value.toLowerCase();
  if (/\bfixed\b/.test(lower)) return false;
  if (/\bsticky\b/.test(lower)) return false;
  return true;
}

function sanitizeStyle(raw: string): string {
  const kept: string[] = [];

  for (const declaration of raw.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator < 0) continue;

    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (!property || !value) continue;
    if (!ALLOWED_CSS_PROPERTIES.has(property)) continue;
    if (!isSafeCssValue(value)) continue;

    if (property === 'display' && !ALLOWED_DISPLAY_VALUES.has(value.toLowerCase())) {
      continue;
    }

    kept.push(`${property}: ${value}`);
  }

  return kept.join('; ');
}

function sanitizeAttributes(element: Element, tagName: string): void {
  for (const attr of Array.from(element.attributes)) {
    const name = attr.name.toLowerCase();

    if (name.startsWith('on')) {
      element.removeAttribute(attr.name);
      continue;
    }

    if (tagName === 'a' && name === 'href') {
      const href = sanitizeHref(attr.value);
      if (href) {
        element.setAttribute('href', href);
        element.setAttribute('rel', 'noopener noreferrer');
      } else {
        element.removeAttribute(attr.name);
      }
      continue;
    }

    if (GLOBAL_ATTRS.has(name)) {
      if (name === 'style') {
        const style = sanitizeStyle(attr.value);
        if (style) element.setAttribute('style', style);
        else element.removeAttribute(attr.name);
      }
      continue;
    }

    element.removeAttribute(attr.name);
  }
}

function unwrapElement(element: Element): void {
  const parent = element.parentNode;
  if (!parent) return;

  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }
  parent.removeChild(element);
}

function sanitizeChildren(parent: ParentNode): void {
  for (const child of Array.from(parent.childNodes)) {
    sanitizeNode(child);
  }
}

function sanitizeNode(node: ChildNode): void {
  if (node.nodeType === 3) return;

  if (node.nodeType !== 1) {
    node.parentNode?.removeChild(node);
    return;
  }

  const element = node as Element;
  const tagName = element.tagName.toLowerCase();

  if (REMOVE_WITH_CONTENT.has(tagName)) {
    element.remove();
    return;
  }

  if (!ALLOWED_TAGS.has(tagName)) {
    sanitizeChildren(element);
    unwrapElement(element);
    return;
  }

  sanitizeAttributes(element, tagName);
  sanitizeChildren(element);
}

export function sanitizeMarkdownPreviewHtml(html: string): string {
  if (typeof document === 'undefined') {
    throw new Error('Markdown preview sanitizer requires a DOM environment');
  }

  const template = document.createElement('template');
  template.innerHTML = html;
  sanitizeChildren(template.content);
  return template.innerHTML;
}
