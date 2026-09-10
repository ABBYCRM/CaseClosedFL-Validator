-- Nemotron-3-Embed-8B-BF16 emits 4096-dimensional vectors.
-- Existing embeddings were created with the previous 2048-dimensional profile and cannot be compared safely.
-- Idempotent: only rewrite the column when it is not already vector(4096).
DO $$
DECLARE
  dim integer;
BEGIN
  SELECT atttypmod INTO dim
  FROM pg_attribute
  WHERE attrelid = 'public.knowledge_chunks'::regclass
    AND attname = 'embedding'
    AND NOT attisdropped;
  IF dim IS DISTINCT FROM 4096 THEN
    UPDATE knowledge_chunks SET embedding = NULL WHERE embedding IS NOT NULL;
    ALTER TABLE knowledge_chunks ALTER COLUMN embedding TYPE vector(4096);
  END IF;
END $$;
