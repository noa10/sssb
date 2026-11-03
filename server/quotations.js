'use strict';

const catalogue = require('./catalogue-meta');
const { customerProfile, validProfile } = require('./customer');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCT_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COMPANIES = new Set(['jfd', 'fxc', 'seacraft', 'zodiac-nautic', 'safe-at-sea']);
const ENQUIRY_TYPES = Object.freeze({
  'commercial-diving': 'Commercial diving and hyperbaric equipment',
  'defence-diving': 'Defence diving',
  'safety-systems': 'Safety critical systems & communications',
  'service-maintenance': 'Service, inspection, maintenance and training',
  'submarine-rescue': 'Submarine escape and rescue',
  'submarine-platforms': 'Submarine platforms',
  'tactical-delivery': 'Tactical delivery vehicles'
});
const PROCUREMENT_ROUTES = Object.freeze({
  unsure: 'Not sure',
  government: 'Government procurement',
  direct: 'Direct purchase',
  support: 'Support request'
});
const CONFIRMATION = 'Thank you. Your quotation request has been sent to our team. We will contact you using your account details.';

function publicError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.publicMessage = message;
  if (code) error.code = code;
  return error;
}

function text(value, label, max, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string') throw publicError(400, `${label} ${required ? 'is required' : 'is invalid'}.`);
  const result = value.trim();
  if (!result && required) throw publicError(400, `${label} is required.`);
  if (result.length > max) throw publicError(400, `${label} must be ${max} characters or fewer.`);
  return result;
}

function calendarDate(value) {
  const result = text(value, 'Required-by date', 10);
  if (!result) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number(result.slice(0, 4)) < 1000) {
    throw publicError(400, 'Enter a valid required-by date.');
  }
  const date = new Date(`${result}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== result) {
    throw publicError(400, 'Enter a valid required-by date.');
  }
  return result;
}

function normaliseQuotation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw publicError(400, 'Enter your quotation request details.');
  const requestId = text(input.requestId, 'Request ID', 36, true).toLowerCase();
  if (!UUID.test(requestId)) throw publicError(400, 'The request ID is invalid.');

  const companyId = text(input.companyId, 'Manufacturer', 80) || null;
  if (companyId && !COMPANIES.has(companyId)) throw publicError(400, 'Choose a valid manufacturer.');
  const productKey = text(input.productKey, 'Product key', 100) || null;
  if (productKey && (!companyId || !PRODUCT_KEY.test(productKey))) throw publicError(400, 'The product key is invalid.');
  const productName = text(input.productName, 'Product or enquiry', 200, true);

  let quantity = null;
  if (input.quantity != null && input.quantity !== '') {
    if (typeof input.quantity !== 'number' || !Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100000) {
      throw publicError(400, 'Quantity must be a whole number between 1 and 100,000.');
    }
    quantity = input.quantity;
  }
  const requiredBy = calendarDate(input.requiredBy);
  const deliveryLocation = text(input.deliveryLocation, 'Delivery location', 200);
  const procurementRoute = text(input.procurementRoute, 'Procurement route', 20) || 'unsure';
  if (!Object.hasOwn(PROCUREMENT_ROUTES, procurementRoute)) throw publicError(400, 'Choose a valid procurement route.');
  const message = text(input.message, 'Message', 4000, ['jfd', 'fxc', 'safe-at-sea'].includes(companyId));

  // Only the fields for the selected manufacturer are retained or validated.
  const enquiryType = companyId === 'jfd' ? text(input.enquiryType, 'Enquiry type', 40, true) : '';
  if (companyId === 'jfd' && !Object.hasOwn(ENQUIRY_TYPES, enquiryType)) throw publicError(400, 'Choose a valid enquiry type.');
  const country = ['safe-at-sea', 'zodiac-nautic'].includes(companyId) ? text(input.country, 'Country', 120, true) : '';
  const city = companyId === 'zodiac-nautic' ? text(input.city, 'City', 120, true) : '';
  const postalCode = companyId === 'zodiac-nautic' ? text(input.postalCode, 'Postal code', 30, true) : '';
  const navigationArea = companyId === 'zodiac-nautic' ? text(input.navigationArea, 'Navigation area', 120, true) : '';
  const region = companyId === 'zodiac-nautic' ? text(input.region, 'State, region or department', 120) : '';

  return { requestId, companyId, productKey, productName, quantity, requiredBy, deliveryLocation, procurementRoute,
    message, enquiryType, country, city, postalCode, navigationArea, region };
}

function dateString(value) {
  if (value == null || value === '') return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function quotation(row) {
  return {
    id: String(row.id),
    companyId: row.company_id || null,
    companyName: row.company_name,
    productKey: row.product_key || null,
    productUrl: row.company_id && row.product_key ? catalogue.pageUrl(row.company_id, row.product_key) : null,
    productName: row.product_name,
    quantity: row.quantity == null ? null : Number(row.quantity),
    requiredBy: dateString(row.required_by),
    deliveryLocation: row.delivery_location || '',
    procurementRoute: row.procurement_route,
    procurementRouteLabel: PROCUREMENT_ROUTES[row.procurement_route] || '',
    message: row.message || '',
    enquiryType: row.enquiry_type || '',
    enquiryTypeLabel: ENQUIRY_TYPES[row.enquiry_type] || '',
    country: row.country || '',
    city: row.city || '',
    postalCode: row.postal_code || '',
    navigationArea: row.navigation_area || '',
    region: row.region || '',
    contact: { name: row.contact_name, email: row.contact_email, phone: row.contact_phone, company: row.contact_company },
    createdAt: row.created_at
  };
}

function samePayload(row, payload) {
  const saved = quotation(row);
  return ['companyId', 'productKey', 'productName', 'quantity', 'requiredBy', 'deliveryLocation', 'procurementRoute',
    'message', 'enquiryType', 'country', 'city', 'postalCode', 'navigationArea', 'region']
    .every((key) => saved[key] === payload[key]);
}

async function findRequest(conn, conversationId, requestId) {
  const [rows] = await conn.execute(
    'SELECT * FROM quotation_requests WHERE conversation_id=? AND request_id=? FOR UPDATE', [conversationId, requestId]
  );
  return rows[0] || null;
}

async function checkSelectedProduct(conn, payload, companyName) {
  if (!payload.productKey) return;
  const changed = () => publicError(409, 'This product has changed or is no longer available. Please review the product list and choose again.', 'PRODUCT_CHANGED');
  const [matches] = await conn.execute(
    'SELECT id FROM catalogue_products WHERE company_id=? AND slug=?', [payload.companyId, payload.productKey]
  );
  if (!matches.length) throw changed();
  // Product editors lock the product by primary key before its knowledge item.
  const [products] = await conn.execute(
    'SELECT id,company_id,slug,name,status,knowledge_id FROM catalogue_products WHERE id=? FOR UPDATE', [matches[0].id]
  );
  const product = products[0];
  if (!product || product.company_id !== payload.companyId || product.slug !== payload.productKey ||
      product.status !== 'published' || product.knowledge_id == null || payload.productName !== `${companyName} ${product.name}`) {
    throw changed();
  }
  const [knowledge] = await conn.execute('SELECT status FROM knowledge_items WHERE id=? FOR UPDATE', [product.knowledge_id]);
  if (!knowledge.length || knowledge[0].status !== 'published') throw changed();
}

async function submitQuotation(pool, customerId, conversationId, payload) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Profile changes and conversation creation use this same account lock.
    const [accounts] = await conn.execute(
      'SELECT id,email,name,phone,company FROM customer_accounts WHERE id=? AND disabled=0 FOR UPDATE', [customerId]
    );
    if (!accounts.length) throw publicError(401, 'Sign in again.');
    const [active] = await conn.execute(
      `SELECT c.id FROM conversations c JOIN customer_conversations cc ON cc.conversation_id=c.id
       WHERE c.id=? AND cc.customer_id=? AND c.visitor_closed_at IS NULL
       AND c.created_at>DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY) FOR UPDATE`, [conversationId, customerId]
    );
    if (!active.length) throw publicError(410, 'This conversation has expired or ended.');

    let existing = await findRequest(conn, conversationId, payload.requestId);
    if (existing) {
      if (!samePayload(existing, payload)) throw publicError(409, 'This request ID belongs to a different quotation request.');
      await conn.commit();
      return { quotation: quotation(existing), duplicate: true };
    }
    const profile = customerProfile(accounts[0]);
    if (!validProfile(profile)) throw publicError(409, 'Complete your account details before requesting a quotation.', 'PROFILE_INCOMPLETE');
    const companyName = payload.companyId ? catalogue.company(payload.companyId).name : 'Other';
    await checkSelectedProduct(conn, payload, companyName);
    try {
      await conn.execute(
        `INSERT INTO quotation_requests
         (conversation_id,customer_id,request_id,company_id,company_name,product_key,product_name,quantity,required_by,
          delivery_location,procurement_route,message,enquiry_type,country,city,postal_code,navigation_area,region,
          contact_name,contact_email,contact_phone,contact_company)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [conversationId, customerId, payload.requestId, payload.companyId, companyName, payload.productKey, payload.productName,
          payload.quantity, payload.requiredBy, payload.deliveryLocation, payload.procurementRoute, payload.message,
          payload.enquiryType, payload.country, payload.city, payload.postalCode, payload.navigationArea, payload.region,
          profile.name, accounts[0].email, profile.phone, profile.company]
      );
    } catch (error) {
      // A current locking read sees a competing committed insert under REPEATABLE READ.
      if (error.code !== 'ER_DUP_ENTRY') throw error;
      existing = await findRequest(conn, conversationId, payload.requestId);
      if (!existing) throw error;
      if (!samePayload(existing, payload)) throw publicError(409, 'This request ID belongs to a different quotation request.');
      await conn.commit();
      return { quotation: quotation(existing), duplicate: true };
    }
    const saved = await findRequest(conn, conversationId, payload.requestId);
    await conn.execute("INSERT INTO messages (conversation_id,role,content,status) VALUES (?,'assistant',?,'answered')", [conversationId, CONFIRMATION]);
    // A new request needs staff attention even when the enquiry had been closed.
    await conn.execute("UPDATE conversations SET status=? WHERE id=? AND status='closed'", ['new', conversationId]);
    await conn.execute('UPDATE conversations SET updated_at=UTC_TIMESTAMP(3) WHERE id=?', [conversationId]);
    await conn.commit();
    return { quotation: quotation(saved), duplicate: false };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function listQuotations(pool, conversationId) {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM quotation_requests WHERE conversation_id=? ORDER BY created_at DESC,id DESC', [conversationId]
    );
    return rows.map(quotation);
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') return [];
    throw error;
  }
}

async function quotationConversationIds(pool, conversationIds) {
  if (!conversationIds.length) return new Set();
  const placeholders = conversationIds.map(() => '?').join(',');
  try {
    const [rows] = await pool.execute(
      `SELECT DISTINCT conversation_id FROM quotation_requests WHERE conversation_id IN (${placeholders})`, conversationIds
    );
    return new Set(rows.map((row) => String(row.conversation_id).toLowerCase()));
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') return new Set();
    throw error;
  }
}

module.exports = { ENQUIRY_TYPES, PROCUREMENT_ROUTES, CONFIRMATION, normaliseQuotation, quotation, submitQuotation, listQuotations, quotationConversationIds };
