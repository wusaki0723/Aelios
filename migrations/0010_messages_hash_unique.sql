-- Message idempotency: make client_message_hash unique (partial index for non-NULL).
-- Retries of the same user message must not create duplicate rows that pollute digests.
--
-- Null out existing hashes rather than deleting rows. Old hashes used a content-only
-- format (conversationId:role:content) with no time bucket. Under eternal conversations
-- (one `${namespace}:default` forever) that format collides for every legitimate repeat
-- of the same text across time, so the old values are incompatible with the bucketed
-- format and may contain legitimate duplicates. Nulling preserves every row while
-- freeing the unique index; new inserts will write bucketed hashes.

UPDATE messages SET client_message_hash = NULL WHERE client_message_hash IS NOT NULL;

DROP INDEX IF EXISTS idx_messages_hash;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_hash_unique
ON messages(client_message_hash)
WHERE client_message_hash IS NOT NULL;
