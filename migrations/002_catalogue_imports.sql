-- Tracks website catalogue entries without changing staff-managed knowledge.
CREATE TABLE IF NOT EXISTS knowledge_catalogue_imports (
  source_key VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  knowledge_id BIGINT UNSIGNED NOT NULL UNIQUE,
  source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  imported_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_catalogue_import_knowledge FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
