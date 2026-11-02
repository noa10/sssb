'use strict';

const sanitizeHtml = require('sanitize-html');

const OPTIONS = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'a', 'code', 'pre'],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    li: ['data-list']
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    b: 'strong',
    i: 'em',
    a: (tagName, attribs) => {
      if (!attribs.href) return { tagName: 'span', attribs: {} };
      const safe = { href: attribs.href };
      if (attribs.title) safe.title = attribs.title;
      if (attribs.target === '_blank') {
        safe.target = '_blank';
        safe.rel = 'noopener noreferrer';
      }
      return { tagName: 'a', attribs: safe };
    }
  }
};

function richTextToPlain(html) {
  const spaced = String(html || '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<\s*\/\s*(?:p|div|h[1-6]|li|blockquote|pre|tr)\s*>/gi, '\n')
    .replace(/<\s*\/\s*(?:ul|ol)\s*>/gi, '\n');
  return sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} })
    .replace(/ /g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function sanitizeRichText(html) {
  if (typeof html !== 'string') return '';
  const clean = sanitizeHtml(html, OPTIONS).trim();
  return richTextToPlain(clean) ? clean : '';
}

module.exports = { sanitizeRichText, richTextToPlain };
