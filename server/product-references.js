'use strict';

const catalogue = require('../public/assets/data/products.json');
const { buildCatalogue } = require('./catalogue');

// Only refer to public catalogue assets that correspond to an imported source.
const entries = new Map(buildCatalogue(catalogue).map((entry) => [entry.key, entry]));
const IMAGE = /^[a-z0-9][a-z0-9._-]*\.(?:jpe?g|png|webp)$/i;

function normalise(value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/([a-z0-9])[.\-_](?=[a-z0-9])/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

const products = Object.entries(catalogue.companies).flatMap(([companyId, items]) => {
  const profile = catalogue.company_profiles[companyId];
  return items.map((item) => {
    const key = `product:${companyId}/${item.id}`;
    const entry = entries.get(key);
    const company = normalise(profile.name);
    const names = [...new Set([normalise(item.name), normalise(item.id)])];
    return {
      key,
      hash: entry.hash,
      names,
      company,
      reference: {
        name: `${profile.name} ${item.name}`,
        type: item.type,
        url: `/${profile.url}#${item.id}`,
        image: IMAGE.test(item.image || '') ? `/assets/img/products/${item.image}` : null,
        manufacturerUrl: new URL(item.source).href
      }
    };
  });
});

function containsPhrase(text, phrase) {
  return phrase && ` ${text} `.includes(` ${phrase} `);
}

function matchesProduct(text, product) {
  return product.names.some((name) => {
    // Common short names such as "GO!" require the manufacturer's name.
    if (name.replace(/\s/g, '').length < 4 && !/\d/.test(name)) {
      return containsPhrase(text, `${product.company} ${name}`);
    }
    return containsPhrase(text, name);
  });
}

async function addProductReferences(pool, messages) {
  const candidates = messages.map((message) => {
    if (message.role !== 'assistant' || message.status !== 'answered') return [];
    const text = normalise(message.content);
    return products.filter((product) => matchesProduct(text, product));
  });
  if (!candidates.some((matches) => matches.length)) return messages;

  let mappings;
  try {
    [mappings] = await pool.execute(
      `SELECT i.source_key,i.source_hash,k.content FROM knowledge_catalogue_imports i
       JOIN knowledge_items k ON k.id=i.knowledge_id
       WHERE k.status='published' AND k.kind='product'`
    );
  } catch (error) {
    // A site that has not imported the optional catalogue can still show chat text.
    if (error.code === 'ER_NO_SUCH_TABLE') return messages;
    throw error;
  }
  const approved = new Map(mappings.map((row) => [row.source_key, row]));
  return messages.map((message, index) => {
    const references = candidates[index]
      .filter((product) => {
        const source = approved.get(product.key);
        return source && source.source_hash === product.hash && typeof source.content === 'string' &&
          source.content.split(/\r?\n/).some((line) => line.trim() === `SSSB product page: ${product.reference.url}`);
      })
      .slice(0, 3)
      .map((product) => {
        const reference = { ...product.reference };
        const lines = approved.get(product.key).content.split(/\r?\n/);
        if (!lines.some((line) => line.trim() === `Manufacturer source: ${reference.manufacturerUrl}`)) reference.manufacturerUrl = null;
        return reference;
      });
    return references.length ? { ...message, products: references } : message;
  });
}

module.exports = { addProductReferences };
