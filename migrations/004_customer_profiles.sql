-- Contact details entered at registration are reused to prefill future chats.
ALTER TABLE customer_accounts
  ADD COLUMN IF NOT EXISTS name VARCHAR(120) NOT NULL DEFAULT '' AFTER email,
  ADD COLUMN IF NOT EXISTS phone VARCHAR(50) NOT NULL DEFAULT '' AFTER name,
  ADD COLUMN IF NOT EXISTS company VARCHAR(160) NOT NULL DEFAULT '' AFTER phone;

-- Existing accounts inherit details from their most recent linked conversation.
UPDATE customer_accounts u
LEFT JOIN (
  SELECT cc.customer_id, c.name, c.phone, c.company
  FROM customer_conversations cc
  JOIN conversations c ON c.id = cc.conversation_id
  JOIN (
    SELECT customer_id, MAX(created_at) AS latest
    FROM customer_conversations
    GROUP BY customer_id
  ) recent ON recent.customer_id = cc.customer_id AND recent.latest = cc.created_at
) latest ON latest.customer_id = u.id
SET u.name = CASE WHEN u.name = '' THEN latest.name ELSE u.name END,
    u.phone = CASE WHEN u.phone = '' THEN latest.phone ELSE u.phone END,
    u.company = CASE WHEN u.company = '' THEN latest.company ELSE u.company END
WHERE latest.customer_id IS NOT NULL
  AND (u.name = '' OR u.phone = '' OR u.company = '');
