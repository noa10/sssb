# Semenanjung Selatan website

The Semenanjung Selatan Sdn Bhd (SSSB) website combines a public product catalogue with customer chat and a staff workspace for managing products, knowledge and enquiries. It is a Node.js application backed by MariaDB.

## Features

- Public company and product pages, with product information supplied by the staff-managed catalogue.
- Customer accounts and chat, including structured quotation requests linked to enquiries.
- A staff workspace for managing products, company knowledge and enquiries, with transcript pagination and quotation indicators.
- Product updates shared between the website and the assistant's knowledge base. Commercial details such as prices, availability and delivery are referred to staff.
- A configurable OpenAI-compatible AI provider, plus a local mock for development. The AI provider is disabled by default.

Quotation requests are saved for staff review; the application does not automatically email them to staff or manufacturers.

## Requirements

- Node.js 22.13.0 or newer and npm.
- MariaDB 10.5 or newer, with a database and user for this application. Use a separate, empty database for a new local installation.

## Local setup

Run the following commands from the repository root.

1. Install dependencies:

   ```bash
   npm ci
   ```

2. If you do not already have a local `.env` file, create one from [`.env.example`](.env.example). Edit it privately and set at least the following values for your own local database:

   ```dotenv
   NODE_ENV=development
   APP_ORIGIN=http://localhost:3000
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_NAME=your_local_database
   DB_USER=your_local_database_user
   DB_PASSWORD=your_local_database_password
   TRUST_PROXY=0
   AI_PROVIDER=disabled
   ```

   `APP_ORIGIN` must match the URL used in the browser, without a trailing slash. `DB_PASSWORD` must be present; leave its value empty only if the database user actually has an empty password. Keep `.env` and real credentials out of Git. For a local-only mock assistant, set `AI_PROVIDER=mock` while `NODE_ENV=development`.

3. Verify that the database is the intended empty local database, then create its tables:

   ```bash
   node --env-file=.env scripts/migrate.js
   ```

   This runs migrations 001 through 006 in order. The migration script does not record migration history or wrap the whole run in a transaction. For an existing database or a failed partial run, inspect the schema and [deployment guide](DEPLOYMENT.md) before applying migrations; do not blindly rerun them.

4. Create the first staff account in an interactive terminal:

   ```bash
   node --env-file=.env scripts/create-staff.js
   ```

   Enter the staff email and a password of at least 8 characters when prompted. Password entry is hidden. There are no default staff credentials.

5. Optionally populate the initial catalogue and company knowledge as described below, then start the application:

   ```bash
   node --env-file=.env app.js
   ```

   Open [http://localhost:3000](http://localhost:3000) for the website and [http://localhost:3000/admin](http://localhost:3000/admin) for staff. If you choose another port, set `PORT` and update `APP_ORIGIN` to match.

Node does not automatically load `.env` for this project. The commands above use `--env-file=.env`; alternatively, provide the same variables through the environment before running an npm script.

## Initial catalogue and knowledge

The source catalogue is [`public/assets/data/products.json`](public/assets/data/products.json). Products managed in the staff workspace subsequently drive the public catalogue and product knowledge. Review the source and the database target before publishing seed data.

First preview the catalogue import against the configured database:

```bash
node --env-file=.env scripts/import-catalogue.js --check
```

After reviewing the preview, import the catalogue's product knowledge and manufacturer profiles:

```bash
node --env-file=.env scripts/import-catalogue.js --apply
```

Then preview the product records and their knowledge links:

```bash
node --env-file=.env scripts/backfill-product-catalogue.js --check
```

After reviewing the results, create the product records:

```bash
node --env-file=.env scripts/backfill-product-catalogue.js --apply
```

To add SSSB's own company information, preview the four company entries:

```bash
node --env-file=.env scripts/seed-company-knowledge.js
```

After reviewing the entries in [`scripts/seed-company-knowledge.js`](scripts/seed-company-knowledge.js), publish them:

```bash
node --env-file=.env scripts/seed-company-knowledge.js --apply
```

These `--apply` commands write published records. See [DEPLOYMENT.md](DEPLOYMENT.md) for conflict handling, existing-data considerations and the complete deployment procedure.

## Tests

```bash
npm test
```

The test suite uses Node's built-in test runner. Many database and provider interactions are simulated; a passing suite does not verify a real MariaDB server, an AI provider or Plesk configuration.

## Deployment and data retention

[Plesk setup and operation](DEPLOYMENT.md) covers the application and document roots, private uploads, environment variables, migrations, staff setup and catalogue import. Configure an appropriate AI provider and HTTPS before relying on live AI responses.

Chat messages expire 30 days after the conversation starts and are deleted on application startup and periodically thereafter. Enquiry contact information and quotation requests remain until their enquiry is deleted. Review the deployment guide for retention, backups and customer-account limitations.

## Project structure

| Path | Purpose |
| --- | --- |
| `public/` | Website pages, assets and initial product catalogue data |
| `admin/` | Staff workspace interface |
| `server/` | Express application, catalogue, customer, knowledge and AI services |
| `migrations/` | MariaDB schema migrations |
| `scripts/` | Migration, catalogue, knowledge and staff setup scripts |
| `tests/` | Automated application tests |
| `app.js` | Application entry point |
| `DEPLOYMENT.md` | Plesk setup and operational guidance |
