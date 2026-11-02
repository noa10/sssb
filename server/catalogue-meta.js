'use strict';

// Developer-managed company and category registry. Product content lives in
// catalogue_products; products.json remains the seed and fallback metadata.
const catalogue = require('../public/assets/data/products.json');

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PAGE = /^[a-z0-9-]+\.html$/;
const IMAGE = /^[a-z0-9][a-z0-9._-]*\.(?:jpe?g|png|webp)$/i;

function fail(message) {
  throw new Error(message);
}

if (!catalogue || !Array.isArray(catalogue.categories) || !catalogue.company_profiles || !catalogue.companies) {
  fail('Invalid catalogue metadata');
}

const categories = catalogue.categories.map((category) => {
  if (!ID.test(category.id || '') || !PAGE.test(category.url || '') || typeof category.name !== 'string' || !category.name.trim()) {
    fail('Invalid catalogue category metadata');
  }
  if (!Array.isArray(category.companies) || category.companies.length === 0) fail(`Category has no companies: ${category.id}`);
  return {
    id: category.id,
    name: category.name.trim(),
    page: category.url,
    summary: typeof category.summary === 'string' ? category.summary.trim() : '',
    image: IMAGE.test(category.image || '') ? category.image : '',
    tags: Array.isArray(category.tags) ? category.tags.filter((tag) => typeof tag === 'string' && tag.trim()).map((tag) => tag.trim()) : [],
    companyIds: category.companies.slice()
  };
});
const categoryById = new Map(categories.map((category) => [category.id, category]));

const companies = Object.entries(catalogue.company_profiles).map(([id, profile]) => {
  if (!ID.test(id) || !profile || !PAGE.test(profile.url || '') || typeof profile.name !== 'string' || !profile.name.trim()) {
    fail('Invalid catalogue company metadata');
  }
  const category = categoryById.get(profile.category);
  if (!category) fail(`Unknown category for company: ${id}`);
  if (!category.companyIds.includes(id)) fail(`Company is missing from its category: ${id}`);
  if (!Array.isArray(catalogue.companies[id]) || !catalogue.companies[id].length) fail(`Company has no seed products: ${id}`);
  return {
    id,
    name: profile.name.trim(),
    page: profile.url,
    logo: IMAGE.test(profile.logo || '') ? profile.logo : '',
    summary: typeof profile.summary === 'string' ? profile.summary.trim() : '',
    categoryId: category.id,
    categoryName: category.name,
    categoryPage: category.page
  };
});
const companyById = new Map(companies.map((company) => [company.id, company]));

for (const category of categories) {
  for (const companyId of category.companyIds) {
    if (!companyById.has(companyId)) fail(`Category references an unknown company: ${companyId}`);
  }
}

function company(id) {
  return companyById.get(String(id || '')) || null;
}

function category(id) {
  return categoryById.get(String(id || '')) || null;
}

function assetImage(filename) {
  return IMAGE.test(filename || '') ? `/assets/img/products/${filename}` : null;
}

function companyLogo(filename) {
  return IMAGE.test(filename || '') ? `/assets/img/companies/${filename}` : null;
}

function pageUrl(companyId, slug) {
  const entry = company(companyId);
  if (!entry || !ID.test(slug || '')) return null;
  return `/${entry.page}#${slug}`;
}

module.exports = {
  categories,
  companies,
  company,
  category,
  assetImage,
  companyLogo,
  pageUrl,
  COMPANY_IDS: companies.map((item) => item.id),
  CATEGORY_IDS: categories.map((item) => item.id)
};
