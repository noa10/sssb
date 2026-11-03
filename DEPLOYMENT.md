# Plesk setup and operation

This is a Node.js 22 application with MariaDB 10.5. It adds a visitor chat and a protected staff dashboard to the existing website. It does not send email or WhatsApp messages: visitors choose whether to send a message using their own apps. The AI provider is disabled until configured. Never expose API keys or database credentials in files under the public document root.

## Before deploying

- Confirm the database and user are correct and do not overwrite any existing data. The migrations create tables if absent; back up existing data and review the SQL files in `migrations/` before running them.
- Confirm HTTPS for the site. Enter your Plesk database password and AI provider key only in the hosting environment, never in git or browser JavaScript.
- Decide on and publish an appropriate privacy notice, retention period, backup and deletion process, and the staff account identities. Confirm your permissions to use the product documents and that their contents are appropriate for public AI answers.
- Choose an AI provider that permits public customer-facing chat and whose data policies meet your needs. OpenCode Go's suitability for this use remains unconfirmed. This app supports an OpenAI-compatible Chat Completions API through `AI_PROVIDER=openai-compatible`; the actual provider, endpoint, model and credentials must be configured and tested. No provider is enabled by default. Do not set mock mode in production.
- Keep `AI_HOURLY_LIMIT` conservative and set a provider-side budget; these are limits, not a guaranteed spending cap. `WHATSAPP_NUMBER` should only be set once the business number is confirmed.

## File layout

Plesk Application Root is `/test.semenanjungselatan.com`; its Document Root is `/test.semenanjungselatan.com/public`. The Git checkout must be deployed into that application root. Keep Node source, `node_modules`, migration files and uploads **outside** `public`. The parent application folder must not be web-served by another domain. The repository is arranged as follows:

```text
application root/
  app.js
  package.json
  package-lock.json
  server/
  scripts/
  migrations/
  admin/
  uploads/          # private uploads, including products/; or an absolute path outside document root
  public/
    index.html
    ...other website pages...
    assets/
```

The repository already contains the website pages and assets under `public/`, so a Git deployment to the application root does not require manually copying them. Do not put `.git`, `node_modules`, source code, backups, configuration, private uploads or `.env` files into `public/`. Check `public/` has no old private files before going live.

For an existing Plesk Git deployment, verify the repository's deployment path is the **application root**, not `public/`. If Plesk currently deploys the old root-level website into `public/`, change the deployment path before deploying this layout. Check for untracked files in both locations and back them up before removing anything. Keep `uploads/` and hosting configuration outside Git and ensure deployments preserve them. Deploy only the intended branch and commit after they have been pushed.

Plesk Git commonly uses a separate repository and deployment directory; a successful Git pull or deployment only updates files. It does not install npm dependencies, run migrations, create staff accounts or restart the Node app. Those are separate setup steps below.

## Configure in Plesk

1. Select Node.js 22, npm, application root as above, document root `public`, startup file `app.js`, and production mode.
2. Configure environment variables from `.env.example` in Plesk. Set `APP_ORIGIN` to the exact HTTPS origin without a path or trailing slash. Use the Plesk database host, database name, user and password. Set `UPLOAD_DIR` to a writable private absolute path outside every web root. `TRUST_PROXY=1` is appropriate only when direct access to Node is blocked and Plesk is its trusted reverse proxy; verify this with your host.
3. In the Node.js interface, run **NPM Install**. Run `npm run migrate` with the same environment variables. Use a database account permitted to create tables during migration, then restrict runtime privileges where possible. Review any migration error; never delete or reset the existing database as a troubleshooting step.
4. In an interactive server terminal, run `npm run staff` to provision the first staff user. Choose a unique strong password of at least 8 characters; the script prompts without displaying it. If Plesk's command runner is non-interactive, use the host's SSH or terminal feature instead. There are no default staff credentials or public staff sign-ups.
5. Restart the Node app. Visit `/admin` over HTTPS, sign in, add reviewed company/product content and upload approved searchable text PDFs. Items default to draft in the dashboard workflow; publish only content approved for public use. To add the website catalogue, follow the catalogue import and product sync steps below. Test the visitor chat and staff review.
6. Test direct URLs for `.env`, `.git`, server source, migration files and unapproved documents. All must be inaccessible. Test a visitor cannot access another conversation or staff data. Plesk may serve `public/` directly, so protect secrets at the actual document-root boundary, not just through Node routing.

The application requires outbound HTTPS to the chosen AI provider. A database outage stops new requests; provider errors leave the enquiry visible to staff. The email and WhatsApp links use the visitor's own apps; check the destinations before launch. Avoid testing live AI without considering provider charges.

New conversations begin with a saved welcome message. Standalone greetings and common misspellings are handled locally. When a product search has no matches, it can retry an unambiguous one-character typo in published titles; model numbers remain exact. If no source is found, the configured AI may classify the visitor's message as a greeting, thanks, help request or small talk. Only a fixed conversational reply or a request for clarification is shown in that case; this classification may incur provider charges. If the provider is unavailable, the app falls back to the clarification.

Assistant replies support basic formatting and links. Visitors can drag the top-left handle (or focus it and use the arrow keys) to resize the panel, and expand it to fullscreen from the header. Escape leaves fullscreen first, then closes the panel. External links in an assistant response are clickable only while the exact HTTPS destination appears in published knowledge; same-site links remain available. Product cards are built from the current published rows in `catalogue_products` joined to published knowledge, so products added or edited in the Products dashboard appear without re-importing `products.json`. They link to the public product page and manufacturer, using the stored image or the website asset. If a product is retired, unpublished or its linked knowledge is not published, its card is hidden. Removing the manufacturer source from the published record also removes that link. Staff transcripts retain the original message text.

## Customer accounts and message retention

Visitors must sign in or create a customer account to start or continue a chat. To attach a guest chat created before accounts became required, they must create or sign in to an account with the same email address **in the browser that started the chat**. The browser's guest token proves ownership; knowing the email address alone does not grant access. A visitor can also end the old guest chat before signing in with a different email. Signing out does not end an account's chat. A new chat can be started after the previous chat ends or expires.

Apply `003_customer_accounts.sql` to the intended database before starting this version of the application. `npm run migrate` includes it, or on an existing installation run the migration separately with the application's database environment:

```bash
node scripts/migrate.js 003_customer_accounts.sql
```

Registration collects and saves the customer's name, email, phone number and company. Each new chat uses the account's saved details; customers can update them under **Edit account details**. Existing accounts with missing details must complete their account once before starting a new chat. Consent must be accepted for every new chat.

Apply `004_customer_profiles.sql` as well, using `npm run migrate` or on an existing installation:

```bash
node scripts/migrate.js 004_customer_profiles.sql
```

It adds the profile columns and copies details from the most recent linked conversation into existing accounts that do not have them. Review the migration before running it and back up the database first.

Customer email addresses are not verified, and the application cannot send password-reset emails. Someone could register an address they do not control, and customers who forget their password cannot currently recover their account. Arrange a suitable verification and recovery process before relying on these accounts in production.

A conversation expires 30 days after it was started, regardless of later activity. Both customer and staff views stop showing its messages at the cutoff. The application deletes expired user and assistant message rows on startup and then approximately every 15 minutes while the Node process is running. Conversations and their enquiry contact details remain available to staff. Starting this version will also delete messages in existing conversations that are already 30 days old. This cleanup does not remove information retained in database backups, server logs or by an AI provider; manage those retention periods separately.

For cleanup when the web process is stopped or idle, configure a Plesk scheduled task to run `scripts/purge-expired-messages.js` every 15 minutes using Node.js 22 and the same database environment as the app. For example, if the application's private `.env` file contains that environment, the task can run:

```bash
node --env-file=/test.semenanjungselatan.com/.env /test.semenanjungselatan.com/scripts/purge-expired-messages.js
```

Use the Node.js 22 executable path provided by the host if `node` in scheduled tasks resolves to another version. Keep the environment file outside `public/` and do not put credentials in the scheduled command. Check Plesk's task output and alert on failures: neither a stopped process nor a failed scheduled job can delete messages until it runs successfully. Git deployment does not create scheduled tasks.

## Quotation requests

Apply `006_quotation_requests.sql` to the intended database before deploying the quotation feature. It depends on the earlier conversation and customer-account migrations. Run it with the application's database environment or include it with `npm run migrate`:

```bash
node scripts/migrate.js 006_quotation_requests.sql
```

Signed-in customers can use **Request quotation** during an active chat. The form uses their account contact details, the published product catalogue and relevant manufacturer-specific details. It refreshes the catalogue when opened; if the catalogue cannot load, customers can retry or enter an Other request. A selected catalogue product is checked again when the request is sent, and customers are asked to review the list if it has changed or is no longer published. Existing requests retain their saved product and contact details. The team reviews each structured request in the linked **Enquiries** detail; the existing enquiry status remains the staff workflow. A confirmation is added to the transcript and the enquiry's update time changes. No email or manufacturer notification is sent automatically.

The request stores a snapshot of the account contact details and survives the 30-day chat-message purge. Deleting its enquiry permanently removes the associated requests. If the migration is missing, existing enquiry details continue to load but new quotation requests cannot be submitted. Update the published privacy notice and retention procedures to cover these records.

## Import the website catalogue

The importer converts `public/assets/data/products.json` into individual published product entries and company profiles, with source attribution. It does not import brochure PDFs, prices, stock, or unverified company certifications. Review the catalogue and manufacturer sources before exposing the assistant publicly; specifications may change and the catalogue's verification date applies to the entire catalogue.

The default command is an offline preview; it does not connect to a database:

```bash
npm run catalogue
```

Before importing, point the environment at the intended database and apply `002_catalogue_imports.sql` through `npm run migrate`, or apply just that migration to an existing installation:

```bash
node scripts/migrate.js 002_catalogue_imports.sql
```

With the same environment, inspect the target and existing records without changing them:

```bash
npm run catalogue -- --check
```

If the printed database target is correct and any conflicts are resolved, import the entries:

```bash
npm run catalogue -- --apply
```

When using a local `.env` file, prefix the corresponding Node script with `node --env-file=.env` (for example, `node --env-file=.env scripts/import-catalogue.js --check`). Shell environment values override `.env` values; make sure the local port is the MariaDB port. Plesk needs the same commands run with its own environment after the code has been deployed; Git deployment does not import database records.

Each catalogue record has a permanent key based on its company/product ID. Re-running the importer skips it without changing staff edits, chunks or publication status. Changed source data is reported for staff review rather than automatically replacing an existing entry. If a key disappears or an untracked staff item has the same title, reconcile it before importing. If there are other untracked company or product entries, review them for duplicates; `--acknowledge-unmapped` permits an import only after that review and still refuses exact title conflicts. Do not rename catalogue IDs casually; a missing old key blocks a subsequent import to prevent duplicates. Keep independent staff creation paused during reconciliation.

## Product records and the public product pages

Products are now stored in the database and drive the staff Products dashboard, the public company/category pages, the catalogue counts and the AI knowledge base. `public/assets/data/products.json` remains the seed file and the source of fixed company/category metadata; it is not the live product source.

Apply the product table before starting this version:

```bash
node scripts/migrate.js 005_product_catalogue.sql
```

`npm run migrate` includes it. On an existing installation, run the catalogue importer above first so each product has a knowledge item, then create the product rows that link the website and the assistant. Preview first, then apply:

```bash
npm run catalogue:products -- --check
npm run catalogue:products -- --apply
```

The sync script matches each of the 20 existing `products.json` products to its imported knowledge item, inserts a published `catalogue_products` row with the existing image asset, and links the two records. It is idempotent: existing rows and staff edits are skipped, and unlinked products are reported instead of guessed. When using a local `.env` file, prefix the command with `node --env-file=.env`, for example `node --env-file=.env scripts/backfill-product-catalogue.js --check`.

In **Products**, staff can create and edit a product with a company, name, product type, summary, rich-text description, specification rows, specification note, feature rows, manufacturer HTTPS source, image, display order and status. The company and public URL key are fixed after creation so existing anchors and enquiry links do not break. Use **Retired** to hide a product while keeping its record. **Delete product** permanently removes the catalogue row, its linked product knowledge and chunks, and its uploaded image after confirmation; this cannot be undone. Draft and retired products are hidden from the public pages and from AI retrieval; published products are available in both immediately after saving.

Each save runs in one database transaction: it updates the product row, writes the linked `knowledge_items` record with the same publication status and composed plain-text facts, and rebuilds `knowledge_chunks`. Product-linked knowledge is omitted from the Knowledge library; staff edit those records only in Products. Do not add new items with the product kind in Knowledge. The catalogue importer and product sync do not overwrite staff edits.

The description uses Quill in the dashboard. The server sanitizes the HTML again on save and once more when serving the public API; only paragraphs, line breaks, bold, italic, underline, strike, headings, lists, blockquote, links, inline code and preformatted text are retained. Styles, classes, images, scripts and unsafe link schemes are removed. The assistant receives plain text, not HTML.

Product images must be JPG, PNG or WebP, no larger than 5 MB, and are validated by file signature rather than filename. They are stored with random names under `UPLOAD_DIR/products`, outside the public document root, and served at `/media/products/<name>` with immutable caching and `nosniff`. A replaced upload is deleted only after the saved transaction succeeds, and deleting a product removes its uploaded image after the database transaction commits. Existing catalogue images stay under `public/assets/img/products/`; a product without an image uses its company logo.

Public pages fetch `GET /api/catalogue`, which returns only published products whose linked knowledge is also published. `public/assets/js/catalogue.js` then updates company cards and rich product details, the product index, header/menu counts, category counts and homepage statistics. If JavaScript is disabled, the API is unavailable or no product is published, the existing static HTML remains as the fallback. This is intentional because Plesk may serve the `.html` files directly. Staff changes appear on the next page load; there is no separate publish or cache purge step.

After deployment, check `/api/catalogue` over HTTPS, one company page and the product counts, create and publish a test product in **Products**, confirm its image and rich text, and confirm a chat answer can produce its product card. Also confirm the Knowledge section refuses to edit the linked item, that an uploaded file is stored outside `public/`, and that deleting a test product removes it from the catalogue, AI knowledge and upload directory.

## Add company knowledge

The catalogue importer covers products and manufacturer profiles, not SSSB's own company profile. The approved content from the About, Our Policy and Contact pages can be published as four company entries (profile, quality policy, offices/contact, and leadership/team) with:

```bash
node scripts/seed-company-knowledge.js --apply
```

Without `--apply` the command only previews the entries. It inserts each entry as published and skips any title that already exists, so it does not overwrite staff edits. Review the content and publication status in the dashboard afterwards. The entries deliberately exclude personal mobile numbers and direct staff email addresses; use the general office contact details. Re-running the command only adds missing titles.

The Knowledge editor can permanently delete non-product content, including its search chunks and, for a PDF, the stored file. Product-linked knowledge cannot be deleted there; delete the product in **Products** instead. The Enquiries detail panel can permanently delete an enquiry, which removes the conversation, transcript, quotation requests, contact details and the customer's link to it. Both actions ask for confirmation and cannot be undone.

## Local development

Configure the same environment variables for a local disposable MariaDB database; `NODE_ENV=development` and `AI_PROVIDER=mock` avoid a paid AI service. When using an OpenAI-compatible service on the same computer, development mode also permits `AI_BASE_URL` over HTTP for `localhost`, `127.0.0.1` or `[::1]`. Remote AI services and all production connections require HTTPS. Node does not load `.env` automatically: when using that file locally, start the app with `node --env-file=.env app.js`, and use the same `--env-file=.env` option when running the migration or staff scripts. Set `APP_ORIGIN` to the exact local URL including `http://` and the listening port. The website pages and assets are served from `public/` in both development and production. Apply `005_product_catalogue.sql` and run `npm run catalogue:products -- --apply` to populate the local product pages, or create products in the dashboard instead.

`npm test` runs local automated checks, including visitor and staff HTTP journeys against a simulated database, product validation and knowledge sync, media serving, and a sample PDF extraction. These checks do not verify MariaDB SQL, HTTPS proxy configuration, a real AI provider or Plesk deployment; those require separate environment-specific checks.
