'use strict';

const { indexChunks } = require('./knowledge');
const meta = require('./catalogue-meta');
const { sanitizeRichText, richTextToPlain } = require('./rich-text');
const { PRODUCT_IMAGE } = require('./images');

const STATUSES = new Set(['draft', 'published', 'retired']);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_HTML = 20000;
const MAX_KNOWLEDGE = 30000;
const MAX_DESCRIPTION_TEXT = 10000;
const MAX_SPECS = 20;
const MAX_FEATURES = 20;

function bad(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.publicMessage = message;
  return error;
}

function textValue(value, label, max, required = true) {
  if (typeof value !== 'string') {
    if (!required && value == null) return '';
    throw bad(`${label} is required.`);
  }
  const text = value.trim();
  if (!text && required) throw bad(`${label} is required.`);
  if (text.length > max) throw bad(`${label} is too long.`);
  return text;
}

function parseArray(value, label) {
  if (value === undefined) return undefined;
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { throw bad(`${label} is invalid.`); }
  }
  if (!Array.isArray(parsed)) throw bad(`${label} is invalid.`);
  return parsed;
}

function normaliseSpecs(value, label = 'Specifications') {
  const parsed = parseArray(value, label);
  if (parsed === undefined) return undefined;
  if (parsed.length > MAX_SPECS) throw bad(`Add no more than ${MAX_SPECS} specifications.`);
  const specs = [];
  for (const item of parsed) {
    const labelValue = Array.isArray(item) ? item[0] : item && item.label;
    const description = Array.isArray(item) ? item[1] : item && item.value;
    if ((labelValue == null || String(labelValue).trim() === '') && (description == null || String(description).trim() === '')) continue;
    specs.push({
      label: textValue(labelValue, 'Specification label', 300),
      value: textValue(description, 'Specification value', 1000)
    });
  }
  return specs;
}

function normaliseFeatures(value, label = 'Features') {
  const parsed = parseArray(value, label);
  if (parsed === undefined) return undefined;
  if (parsed.length > MAX_FEATURES) throw bad(`Add no more than ${MAX_FEATURES} features.`);
  return parsed
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .map((item) => textValue(item, 'Feature', 1000));
}

function storedSpecs(value) {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { parsed = []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((item) => Array.isArray(item)
    ? { label: String(item[0] || ''), value: String(item[1] || '') }
    : { label: String(item?.label || ''), value: String(item?.value || '') })
    .filter((item) => item.label && item.value);
}

function storedFeatures(value) {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { parsed = []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
}

function httpsUrl(value, label, required = false) {
  const text = textValue(value, label, 2048, required);
  if (!text) return '';
  let url;
  try { url = new URL(text); } catch { throw bad(`${label} must be a valid HTTPS address.`); }
  if (url.protocol !== 'https:' || url.username || url.password) throw bad(`${label} must be a valid HTTPS address.`);
  return url.href;
}

function safeHttpsUrl(value) {
  try { return httpsUrl(value, 'Manufacturer source'); } catch { return ''; }
}

function slugify(value) {
  const base = String(value || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return base || 'product';
}

function normaliseProduct(body, existing = null) {
  const source = body && typeof body === 'object' ? body : {};
  const companyId = existing ? existing.company_id : textValue(source.companyId, 'Company', 80);
  const company = meta.company(companyId);
  if (!company) throw bad('Choose one of the catalogue companies.');

  const name = source.name === undefined && existing ? existing.name : textValue(source.name, 'Product name', 160);
  const productType = source.productType === undefined && existing
    ? existing.product_type
    : textValue(source.productType, 'Product type', 200);
  const summary = source.summary === undefined && existing
    ? existing.summary
    : textValue(source.summary, 'Summary', 2000);
  const rawHtml = source.descriptionHtml === undefined && existing
    ? existing.description_html
    : (typeof source.descriptionHtml === 'string' ? source.descriptionHtml : '');
  if (rawHtml.length > MAX_HTML) throw bad('The description is too long.');
  const descriptionHtml = sanitizeRichText(rawHtml);
  const descriptionText = richTextToPlain(descriptionHtml);
  if (descriptionText.length > MAX_DESCRIPTION_TEXT) throw bad('The description is too long.');

  const specs = (source.specs === undefined && existing ? storedSpecs(existing.specs) : normaliseSpecs(source.specs)) || [];
  const features = (source.features === undefined && existing ? storedFeatures(existing.features) : normaliseFeatures(source.features)) || [];
  const specNote = source.specNote === undefined && existing
    ? String(existing.spec_note || '')
    : textValue(source.specNote, 'Specification note', 1000, false);
  const manufacturerSource = source.manufacturerSource === undefined && existing
    ? String(existing.manufacturer_source || '')
    : httpsUrl(source.manufacturerSource, 'Manufacturer source');

  const status = source.status === undefined && existing ? existing.status : String(source.status || 'draft');
  if (!STATUSES.has(status)) throw bad('Choose a valid publication status.');

  let sortOrder = existing ? Number(existing.sort_order) : undefined;
  if (source.sortOrder !== undefined && source.sortOrder !== '') {
    sortOrder = Number(source.sortOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) throw bad('Display order must be between 0 and 9999.');
  }

  let photo = existing ? Boolean(Number(existing.photo)) : false;
  if (source.photo !== undefined) photo = source.photo === true || source.photo === 'true' || source.photo === '1' || source.photo === 1;

  const slug = existing ? existing.slug : (source.slug === undefined || source.slug === ''
    ? slugify(name)
    : textValue(source.slug, 'URL key', 80));
  if (!SLUG.test(slug)) throw bad('The URL key may use lowercase letters, numbers and hyphens.');

  const title = `${company.name} ${name}`;
  if (title.length > 200) throw bad('The company and product name are too long.');

  return {
    company,
    companyId,
    name,
    productType,
    summary,
    descriptionHtml,
    descriptionText,
    specs,
    specNote,
    features,
    manufacturerSource,
    status,
    sortOrder,
    photo,
    slug,
    title
  };
}

function knowledgeContent(product) {
  const page = meta.pageUrl(product.companyId, product.slug);
  const parts = [
    `Manufacturer: ${product.company.name}`,
    `Product: ${product.name}`,
    `Product type: ${product.productType}`,
    `Catalogue category: ${product.company.categoryName}`,
    `Description: ${product.summary}`
  ];
  if (product.descriptionText) parts.push(product.descriptionText);
  if (product.specs.length) {
    const specs = product.specs.map((spec) => `- ${spec.label}: ${spec.value}`).join('\n');
    parts.push(`Specifications:\n${specs}${product.specNote ? `\nSpecification note: ${product.specNote}` : ''}`);
  }
  if (product.features.length) parts.push(`Features:\n${product.features.map((feature) => `- ${feature}`).join('\n')}`);
  if (page) parts.push(`SSSB product page: ${page}`);
  if (product.manufacturerSource) parts.push(`Manufacturer source: ${product.manufacturerSource}`);
  parts.push(`Product information last updated: ${new Date().toISOString().slice(0, 10)}`);
  parts.push('Confirm current specifications, configuration and availability with the SSSB team.');
  const content = parts.join('\n\n');
  if (content.length > MAX_KNOWLEDGE) throw bad('The product information is too long for the knowledge base.');
  return content;
}

async function uniqueSlug(conn, companyId, base) {
  for (let index = 1; index <= 50; index += 1) {
    const slug = index === 1 ? base : `${base.slice(0, 80 - String(index).length - 1)}-${index}`;
    const [rows] = await conn.execute('SELECT id FROM catalogue_products WHERE company_id=? AND slug=? LIMIT 1', [companyId, slug]);
    if (!rows.length) return slug;
  }
  throw bad('Could not create a unique product URL. Try another name.');
}

async function nextSortOrder(conn, companyId) {
  const [rows] = await conn.execute('SELECT COALESCE(MAX(sort_order),0)+1 AS next_order FROM catalogue_products WHERE company_id=?', [companyId]);
  return Number(rows[0]?.next_order || 1);
}

function imageUrl(row, company) {
  if (row.image_source === 'upload' && PRODUCT_IMAGE.test(row.image_name || '')) return `/media/products/${row.image_name}`;
  return meta.assetImage(row.image_name) || (company ? meta.companyLogo(company.logo) : null);
}

function adminProduct(row) {
  const company = meta.company(row.company_id);
  return {
    id: String(row.id),
    knowledgeId: row.knowledge_id == null ? null : String(row.knowledge_id),
    companyId: row.company_id,
    companyName: company ? company.name : row.company_id,
    slug: row.slug,
    name: row.name,
    productType: row.product_type,
    summary: row.summary,
    descriptionHtml: row.description_html || '',
    specs: storedSpecs(row.specs),
    specNote: row.spec_note || '',
    features: storedFeatures(row.features),
    imageName: row.image_name || '',
    imageSource: row.image_source,
    imageUrl: imageUrl(row, company),
    photo: Boolean(Number(row.photo)),
    manufacturerSource: row.manufacturer_source || '',
    status: row.status,
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function publicProduct(row, company) {
  return {
    key: row.slug,
    name: row.name,
    type: row.product_type,
    summary: row.summary,
    descriptionHtml: sanitizeRichText(row.description_html || ''),
    specs: storedSpecs(row.specs),
    specNote: row.spec_note || '',
    features: storedFeatures(row.features),
    imageUrl: imageUrl(row, company),
    photo: Boolean(Number(row.photo)),
    sourceUrl: safeHttpsUrl(row.manufacturer_source) || null,
    pageUrl: meta.pageUrl(row.company_id, row.slug),
    enquiryUrl: `/contact.html?company=${encodeURIComponent(row.company_id)}&product=${encodeURIComponent(row.slug)}#enquiry`
  };
}

async function listAdminProducts(pool) {
  const [rows] = await pool.execute(
    `SELECT p.*,k.status AS knowledge_status FROM catalogue_products p
     LEFT JOIN knowledge_items k ON k.id=p.knowledge_id
     ORDER BY p.company_id,p.sort_order,p.name LIMIT 500`
  );
  return rows.map(adminProduct);
}

async function getAdminProduct(pool, id) {
  const [rows] = await pool.execute(
    `SELECT p.*,k.status AS knowledge_status FROM catalogue_products p
     LEFT JOIN knowledge_items k ON k.id=p.knowledge_id WHERE p.id=?`,
    [id]
  );
  return rows.length ? adminProduct(rows[0]) : null;
}

async function createProduct(pool, body, options = {}) {
  const product = normaliseProduct(body);
  const content = knowledgeContent(product);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    product.slug = await uniqueSlug(conn, product.companyId, product.slug);
    product.sortOrder = product.sortOrder === undefined ? await nextSortOrder(conn, product.companyId) : product.sortOrder;
    const imageName = options.imageName || '';
    const imageSource = options.imageSource || 'asset';
    const [knowledge] = await conn.execute(
      "INSERT INTO knowledge_items (title,kind,content,source_name,status) VALUES (?,'product',?,?,?)",
      [product.title, content, `SSSB website catalogue: ${product.company.name}`, product.status]
    );
    await indexChunks(conn, knowledge.insertId, `${product.title}\n${content}`);
    const [saved] = await conn.execute(
      `INSERT INTO catalogue_products
       (knowledge_id,company_id,slug,name,product_type,summary,description_html,specs,spec_note,features,image_name,image_source,photo,manufacturer_source,status,sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [knowledge.insertId, product.companyId, product.slug, product.name, product.productType, product.summary,
        product.descriptionHtml, JSON.stringify(product.specs), product.specNote, JSON.stringify(product.features),
        imageName, imageSource, product.photo ? 1 : 0, product.manufacturerSource, product.status, product.sortOrder]
    );
    await conn.commit();
    return { id: String(saved.insertId), knowledgeId: String(knowledge.insertId), slug: product.slug };
  } catch (error) {
    await conn.rollback();
    if (error.code === 'ER_DUP_ENTRY') throw bad('A product with this URL already exists.', 409);
    throw error;
  } finally {
    conn.release();
  }
}

async function updateProduct(pool, id, body, options = {}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT * FROM catalogue_products WHERE id=? FOR UPDATE', [id]);
    if (!rows.length) { await conn.rollback(); return null; }
    const existing = rows[0];
    const product = normaliseProduct(body, existing);
    product.slug = existing.slug;
    if (product.sortOrder === undefined) product.sortOrder = Number(existing.sort_order || 0);
    const content = knowledgeContent(product);
    const imageName = options.imageName === undefined ? existing.image_name : options.imageName;
    const imageSource = options.imageSource === undefined ? existing.image_source : options.imageSource;

    let knowledgeId = existing.knowledge_id;
    let [knowledge] = knowledgeId == null ? [[]] : await conn.execute('SELECT id FROM knowledge_items WHERE id=? FOR UPDATE', [knowledgeId]);
    if (!knowledge.length) knowledgeId = null;
    if (knowledgeId == null) {
      const [created] = await conn.execute(
        "INSERT INTO knowledge_items (title,kind,content,source_name,status) VALUES (?,'product',?,?,?)",
        [product.title, content, `SSSB website catalogue: ${product.company.name}`, product.status]
      );
      knowledgeId = created.insertId;
    } else {
      await conn.execute(
        "UPDATE knowledge_items SET title=?,kind='product',content=?,source_name=?,status=? WHERE id=?",
        [product.title, content, `SSSB website catalogue: ${product.company.name}`, product.status, knowledgeId]
      );
    }
    await indexChunks(conn, knowledgeId, `${product.title}\n${content}`);
    await conn.execute(
      `UPDATE catalogue_products SET knowledge_id=?,name=?,product_type=?,summary=?,description_html=?,specs=?,spec_note=?,
       features=?,image_name=?,image_source=?,photo=?,manufacturer_source=?,status=?,sort_order=? WHERE id=?`,
      [knowledgeId, product.name, product.productType, product.summary, product.descriptionHtml,
        JSON.stringify(product.specs), product.specNote, JSON.stringify(product.features),
        imageName, imageSource, product.photo ? 1 : 0, product.manufacturerSource, product.status, product.sortOrder, id]
    );
    await conn.commit();
    return { id: String(existing.id), knowledgeId: String(knowledgeId), slug: product.slug, previousImage: existing.image_name, previousImageSource: existing.image_source };
  } catch (error) {
    await conn.rollback();
    if (error.code === 'ER_DUP_ENTRY') throw bad('A product with this URL already exists.', 409);
    throw error;
  } finally {
    conn.release();
  }
}

async function deleteProduct(pool, id) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT * FROM catalogue_products WHERE id=? FOR UPDATE', [id]);
    if (!rows.length) { await conn.rollback(); return null; }
    const existing = rows[0];
    await conn.execute('DELETE FROM catalogue_products WHERE id=?', [id]);
    if (existing.knowledge_id != null) {
      // Remove only knowledge created for this product. A manually linked
      // non-product item is left in place when the product row is deleted.
      const [knowledge] = await conn.execute('SELECT kind FROM knowledge_items WHERE id=? FOR UPDATE', [existing.knowledge_id]);
      if (knowledge.length && knowledge[0].kind === 'product') {
        await conn.execute('DELETE FROM knowledge_chunks WHERE knowledge_id=?', [existing.knowledge_id]);
        await conn.execute("DELETE FROM knowledge_items WHERE id=? AND kind='product'", [existing.knowledge_id]);
      }
    }
    await conn.commit();
    return { previousImage: existing.image_name || '', previousImageSource: existing.image_source || 'asset' };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function publicCatalogue(pool) {
  const [rows] = await pool.execute(
    `SELECT p.* FROM catalogue_products p
     JOIN knowledge_items k ON k.id=p.knowledge_id
     WHERE p.status='published' AND k.status='published'
     ORDER BY p.company_id,p.sort_order,p.name`
  );
  const grouped = new Map(meta.companies.map((company) => [company.id, {
    key: company.id,
    name: company.name,
    url: company.page,
    logo: meta.companyLogo(company.logo),
    summary: company.summary,
    category: company.categoryId,
    categoryName: company.categoryName,
    products: []
  }]));
  for (const row of rows) {
    const group = grouped.get(row.company_id);
    if (!group) continue;
    group.products.push(publicProduct(row, meta.company(row.company_id)));
  }
  const companies = [...grouped.values()].map((company) => ({ ...company, productCount: company.products.length }));
  const categories = meta.categories.map((category) => {
    const products = companies.filter((company) => company.category === category.id).reduce((total, company) => total + company.productCount, 0);
    return {
      id: category.id,
      name: category.name,
      url: category.page,
      summary: category.summary,
      image: meta.assetImage(category.image),
      tags: category.tags,
      companyKeys: category.companyIds,
      companyCount: category.companyIds.length,
      productCount: products
    };
  });
  return {
    updatedAt: new Date().toISOString(),
    companies,
    categories,
    totals: { companies: companies.length, categories: categories.length, products: companies.reduce((total, company) => total + company.productCount, 0) }
  };
}

module.exports = {
  normaliseProduct,
  knowledgeContent,
  slugify,
  listAdminProducts,
  getAdminProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  publicCatalogue,
  adminProduct,
  publicProduct,
  imageUrl,
  STATUSES
};
