'use strict';

const meta = require('./catalogue-meta');
const { PRODUCT_IMAGE } = require('./images');

function normalise(value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/([a-z0-9])[.\-_](?=[a-z0-9])/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

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

function imagePath(row, company) {
  if (row.image_source === 'upload' && PRODUCT_IMAGE.test(row.image_name || '')) return `/media/products/${row.image_name}`;
  return meta.assetImage(row.image_name) || meta.assetImage(company.logo);
}

function manufacturerUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

async function publishedProducts(pool) {
  const [rows] = await pool.execute(
    `SELECT p.company_id,p.slug,p.name,p.product_type,p.image_name,p.image_source,p.manufacturer_source
     FROM catalogue_products p JOIN knowledge_items k ON k.id=p.knowledge_id
     WHERE p.status='published' AND k.status='published'`
  );
  return rows.flatMap((row) => {
    const company = meta.company(row.company_id);
    if (!company) return [];
    return [{
      names: [...new Set([normalise(row.name), normalise(row.slug)])].filter(Boolean),
      company: normalise(company.name),
      reference: {
        name: `${company.name} ${row.name}`,
        type: row.product_type,
        url: meta.pageUrl(company.id, row.slug),
        image: imagePath(row, company),
        manufacturerUrl: manufacturerUrl(row.manufacturer_source)
      }
    }];
  });
}

async function addProductReferences(pool, messages) {
  const candidates = messages.map((message) => {
    if (message.role !== 'assistant' || message.status !== 'answered') return [];
    const text = normalise(message.content);
    return { text };
  });
  if (!candidates.some((candidate) => candidate.text)) return messages;

  let products;
  try {
    products = await publishedProducts(pool);
  } catch (error) {
    // A site that has not run the product migration can still show chat text.
    if (error.code === 'ER_NO_SUCH_TABLE') return messages;
    throw error;
  }
  if (!products.length) return messages;

  return messages.map((message, index) => {
    const candidate = candidates[index];
    if (!candidate.text) return message;
    const references = products
      .filter((product) => matchesProduct(candidate.text, product))
      .map((product) => product.reference);
    return references.length ? { ...message, products: references } : message;
  });
}

module.exports = { addProductReferences };
