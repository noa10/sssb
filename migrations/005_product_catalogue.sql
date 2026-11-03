-- MariaDB 10.5; run using scripts/migrate.js, never against an unverified database.
-- Live catalogue records for the staff Products CMS. Knowledge text remains in
-- knowledge_items and is linked one-to-one for AI retrieval.
CREATE TABLE IF NOT EXISTS catalogue_products (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  knowledge_id BIGINT UNSIGNED NULL,
  company_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slug VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(160) NOT NULL,
  product_type VARCHAR(200) NOT NULL,
  summary TEXT NOT NULL,
  description_html MEDIUMTEXT NOT NULL,
  specs JSON NOT NULL,
  spec_note VARCHAR(1000) NOT NULL DEFAULT '',
  features JSON NOT NULL,
  image_name VARCHAR(255) NOT NULL DEFAULT '',
  image_source ENUM('asset','upload') NOT NULL DEFAULT 'asset',
  photo TINYINT(1) NOT NULL DEFAULT 0,
  manufacturer_source VARCHAR(2048) NOT NULL DEFAULT '',
  status ENUM('draft','published','retired') NOT NULL DEFAULT 'draft',
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_catalogue_company_slug (company_id, slug),
  UNIQUE KEY uq_catalogue_knowledge (knowledge_id),
  INDEX idx_catalogue_public (status, company_id, sort_order),
  CONSTRAINT fk_catalogue_knowledge FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
