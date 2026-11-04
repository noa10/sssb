'use strict';

// Publishes approved company information from the public website pages.
// Run without --apply to preview; existing entries with the same title are left unchanged.
// For the staff-reviewed update to existing quotation wording, see DEPLOYMENT.md.
const { createPool, databaseConfig } = require('../server/db');
const { indexChunks } = require('../server/knowledge');

const SOURCE = 'SSSB website company pages';
const ENTRIES = [
  {
    title: 'Semenanjung Selatan (SSSB) company profile',
    content: [
      'Company profile: Semenanjung Selatan Sdn Bhd (SSSB)',
      'Country: Malaysia',
      'Founded: 1983. SSSB has operated for more than four decades.',
      'Business: A Malaysian supplier of military equipment, specialising in airborne, army, naval and special forces requirements. It also serves government agencies and specialist marine operators.',
      'Product categories: Diving Equipment (JFD and Seacraft), Parachute Systems (FXC), and Inflatable Systems (Zodiac Nautic and Safe at Sea).',
      'Role: SSSB is the exclusive Malaysian importer and company representative for the specific brands it promotes, operating under commercial agreements with original equipment manufacturers (OEMs). Agency-level government procurement is handled directly by SSSB as the supplier.',
      'Capabilities: OEM representation, sole-source supply and accredited government procurement, an integrated supply chain and global logistics, specialist advice and training, and after-sales support in the air, on land and at sea.',
      'History: Founded in 1983 as a Malaysian supply partner. Long-standing OEM relationships and an integrated supply chain extended its reach from a local trader to a global logistics partner.',
      'Vision: To contribute to the world\'s progress and safety through meaningful, innovative technological solutions, supported by an accountable supply chain and a high standard of customer service.',
      'Mission: To continually improve the effectiveness of its quality management system and provide products and services that comply with, and aim to exceed, client expectations.',
      'Commitment: Professional, passionate service, dependable after-sales support, and a focus on product excellence, functionality and delivery requirements.',
      'Team: Supported by advisors with experience across naval, army, police, oil and gas, aerial delivery and OEM environments.',
      'Website: /about.html'
    ].join('\n\n')
  },
  {
    title: 'Semenanjung Selatan (SSSB) quality policy',
    content: [
      'Quality policy: Semenanjung Selatan treats quality as the standard across the business, not a separate department.',
      'Objective: Enhance client satisfaction by continually improving product excellence and services across quality, functionality, delivery and support.',
      'Commitments:',
      '- Meet and exceed expectations: provide goods and services that comply with, and aim to exceed, client requirements for performance, quality and delivery.',
      '- Improve the service: continually improve the quality of services through disciplined review, supplier management and operational learning.',
      '- Strengthen the system: continually improve the effectiveness of the quality management system, making accountability part of everyday work.',
      'Quality management certification: SSSB\'s quality management system complies with NATO design, development and production requirements. The certificate is issued by the Defence Standardization, Codification and Government Quality Assurance Authority and is based on the ISO 9001:2008 standard, with a number of additions and specifications.',
      'Continual improvement: A fundamental part of SSSB\'s business operating standard is continual improvement, year on year, in the products sourced, the partners it works with and the support provided after delivery.',
      'Operating standard:',
      '- Product excellence: review listed model specifications and key features, then confirm the exact configuration with the manufacturer and SSSB against the operating requirement.',
      '- Supply discipline: use accredited procurement routes and an integrated supply chain to protect accountability.',
      '- Delivery confidence: plan logistics and communication around the client\'s schedule and operational need.',
      '- After-sales continuity: remain available for spares, repair and technical support after the equipment enters service.',
      'Website: /our-policy.html'
    ].join('\n\n')
  },
  {
    title: 'Semenanjung Selatan (SSSB) offices and contact',
    content: [
      'Offices and contact: Semenanjung Selatan Sdn Bhd (SSSB) is located in Malaysia.',
      'Head office - SSSB Southern Zone (HQ): No 1 Jalan Lurah Utama, Kempas Baru, 81200 Johor Bahru, Johor, Malaysia. Office telephone: +60 7-235 2330.',
      'Northern Zone - Manjung branch: No. 4, Jalan SM1A/15, Fasa 1C4, 32040 Seri Manjung, Perak, Malaysia.',
      'Email: info@semenanjungselatan.com',
      'Opening hours: Monday-Friday, 09:00-17:00. Saturday, Sunday and public holidays are closed.',
      'Enquiries: Product enquiries, procurement requirements and after-sales support can be directed to the head office or the northern branch. To request a quotation, visitors can submit a request through the website chat or contact the SSSB team directly. The team confirms pricing, availability and delivery.',
      'A useful first enquiry includes: the product category, company and model or the outcome required; where and how the equipment will be used; whether this is government procurement, direct purchase or a support request; and any delivery window, exercise date or operational deadline.',
      'Website: /contact.html'
    ].join('\n\n')
  },
  {
    title: 'Semenanjung Selatan (SSSB) leadership, directors and advisors',
    content: [
      'Leadership and team: Semenanjung Selatan Sdn Bhd (SSSB)',
      'Managing Director: Hj Shuhaimi Bin Hj Ramli. He is the most senior executive listed on the company website. The website does not list a separate CEO; the Managing Director is the senior leadership role shown.',
      'Advisors and specialists:',
      '- Kept. Hj Abd Malek B. Md Daud - Operation & Training Consultant (RMN, retired).',
      '- Hj Yusuf Bin Hj Ramli - Oil & Gas Advisor.',
      '- John Limbach - Aerial Delivery & OEM Advisor.',
      '- DCP Datuk Azizan B. Abd Aziz - Homeland Security Advisor (Police, retired).',
      '- Laksdya. Dato Abdul Ghani B. Othman - Maritime Operation Advisor (Navy, retired).',
      '- Mej. Jen. Datuk Zolkopli B. Hashim - Air & Land Operation Advisor (Army, retired).',
      'The team is supported by advisors with experience across naval, army, police, oil and gas, aerial delivery and OEM environments.',
      'Contact: Leadership and team enquiries can be directed to the head office using the general company contact details.',
      'Website: /about.html'
    ].join('\n\n')
  }
];

async function main() {
  const apply = process.argv.includes('--apply');
  const unknown = process.argv.slice(2).filter((value) => value !== '--apply');
  if (unknown.length) throw new Error('Usage: node scripts/seed-company-knowledge.js [--apply]');

  const db = databaseConfig();
  console.log(`Database target: ${db.host}:${db.port}/${db.database}`);
  const pool = createPool();
  try {
    let added = 0;
    for (const entry of ENTRIES) {
      const [existing] = await pool.execute('SELECT id,status FROM knowledge_items WHERE title=? LIMIT 1', [entry.title]);
      if (existing.length) {
        console.log(`Skip (already exists, left unchanged): ${entry.title}`);
        continue;
      }
      if (!apply) {
        console.log(`Would add: ${entry.title}`);
        continue;
      }
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [result] = await conn.execute(
          "INSERT INTO knowledge_items (title,kind,content,source_name,status) VALUES (?,'company',?,?,'published')",
          [entry.title, entry.content, SOURCE]
        );
        await indexChunks(conn, result.insertId, entry.content);
        await conn.commit();
        added += 1;
        console.log(`Added: ${entry.title}`);
      } catch (error) {
        await conn.rollback();
        throw error;
      } finally {
        conn.release();
      }
    }
    if (!apply) console.log('Preview only; no records were changed. Re-run with --apply to add the entries.');
    else console.log(`Published ${added} company knowledge ${added === 1 ? 'entry' : 'entries'}.`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Company knowledge seed failed:', error.code || error.message);
    process.exitCode = 1;
  });
}

module.exports = { ENTRIES, SOURCE };
