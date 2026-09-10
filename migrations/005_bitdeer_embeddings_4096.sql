-- Nemotron-3-Embed-8B-BF16 emits 4096-dimensional vectors.
-- Existing embeddings were created with the previous 2048-dimensional profile and cannot be compared safely.
UPDATE knowledge_chunks SET embedding = NULL WHERE embedding IS NOT NULL;
ALTER TABLE knowledge_chunks ALTER COLUMN embedding TYPE vector(4096);
