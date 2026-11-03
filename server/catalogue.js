'use strict';

const crypto = require('node:crypto');

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PAGE = /^[a-z0-9-]+\.html$/;

function requiredText(value, label, max = 30000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${label}`);
  return value.trim();
}

function catalogueEntry(key, title, kind, content, sourceName) {
  if (key.length > 160 || title.length > 200 || content.length > 30000 || sourceName.length > 255) {
    throw new Error(`Catalogue entry exceeds a database limit: ${key}`);
  }
  const hash = crypto.createHash('sha256').update(JSON.stringify({ title, kind, content, sourceName })).digest('hex');
  return { key, title, kind, content, sourceName, hash };
}

function buildCatalogue(catalogue) {
  if (!catalogue || typeof catalogue !== 'object' || !catalogue.companies || !catalogue.company_profiles || !Array.isArray(catalogue.categories)) {
    throw new Error('Invalid catalogue structure');
  }
  const verifiedOn = requiredText(catalogue.verified_on, 'catalogue verification date', 10);
  const parsedDate = new Date(`${verifiedOn}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(verifiedOn) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== verifiedOn) {
    throw new Error('Invalid catalogue verification date');
  }
  const categories = new Map();
  for (const category of catalogue.categories) {
    if (!SLUG.test(category.id || '') || categories.has(category.id)) throw new Error('Invalid or duplicate category ID');
    categories.set(category.id, requiredText(category.name, 'category name', 200));
  }
  const companyKeys = Object.keys(catalogue.companies);
  if (!companyKeys.length || companyKeys.length !== Object.keys(catalogue.company_profiles).length) throw new Error('Catalogue company profiles do not match');
  const entries = [];
  const seen = new Set();
  for (const companyId of companyKeys) {
    if (!SLUG.test(companyId)) throw new Error('Invalid company ID');
    const profile = catalogue.company_profiles[companyId];
    const products = catalogue.companies[companyId];
    if (!profile || !Array.isArray(products) || !products.length) throw new Error(`Missing company profile or products: ${companyId}`);
    const company = requiredText(profile.name, 'company name', 120);
    const summary = requiredText(profile.summary, 'company summary');
    const category = categories.get(profile.category);
    if (!category || !PAGE.test(profile.url || '')) throw new Error(`Invalid category or website page: ${companyId}`);
    const page = `/${profile.url}`;
    const sourceName = `SSSB website catalogue: ${company}`;
    const names = [];
    for (const product of products) {
      if (!product || !SLUG.test(product.id || '')) throw new Error(`Invalid product ID: ${companyId}`);
      const key = `product:${companyId}/${product.id}`;
      if (seen.has(key)) throw new Error(`Duplicate product ID: ${key}`);
      seen.add(key);
      const name = requiredText(product.name, 'product name', 160);
      const type = requiredText(product.type, 'product type', 200);
      const description = requiredText(product.summary, 'product summary');
      const source = requiredText(product.source, 'manufacturer source', 2048);
      let url;
      try { url = new URL(source); } catch { throw new Error(`Invalid manufacturer source: ${key}`); }
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`Invalid manufacturer source: ${key}`);
      if (!Array.isArray(product.specs) || !product.specs.length || !Array.isArray(product.features) || !product.features.length) {
        throw new Error(`Missing specifications or features: ${key}`);
      }
      const specs = product.specs.map((pair) => {
        if (!Array.isArray(pair) || pair.length !== 2) throw new Error(`Invalid specification: ${key}`);
        return `- ${requiredText(pair[0], 'specification label', 300)}: ${requiredText(pair[1], 'specification value', 1000)}`;
      });
      const features = product.features.map((feature) => `- ${requiredText(feature, 'feature', 1000)}`);
      const note = product.spec_note === undefined ? '' : `\nSpecification note: ${requiredText(product.spec_note, 'specification note')}`;
      const title = `${company} ${name}`;
      const content = [
        `Manufacturer: ${company}`,
        `Product: ${name}`,
        `Product type: ${type}`,
        `Catalogue category: ${category}`,
        `Description: ${description}`,
        `Specifications:\n${specs.join('\n')}${note}`,
        `Features:\n${features.join('\n')}`,
        `SSSB product page: ${page}#${product.id}`,
        `Manufacturer source: ${url.href}`,
        `Website catalogue verification date: ${verifiedOn}`,
        'Confirm current specifications, configuration and availability with the SSSB team.'
      ].join('\n\n');
      entries.push(catalogueEntry(key, title, 'product', content, sourceName));
      names.push(name);
    }
    const key = `company:${companyId}`;
    seen.add(key);
    entries.push(catalogueEntry(key, `${company} company profile`, 'company', [
      `Manufacturer: ${company}`,
      `Catalogue category: ${category}`,
      `Overview: ${summary}`,
      `Products in the SSSB website catalogue: ${names.join(', ')}.`,
      `SSSB company page: ${page}`,
      `Website catalogue verification date: ${verifiedOn}`,
      'Confirm current specifications, configuration and availability with the SSSB team.'
    ].join('\n\n'), sourceName));
  }
  return entries;
}

module.exports = { buildCatalogue };
