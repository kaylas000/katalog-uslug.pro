-- db/migrations/019_delete_duplicate_durapan.sql
-- Remove duplicate organization 'durapan' (legacy ID).
-- Keep 'penrod' as the original entry with photos (maintained via data/catalog.json).

DELETE FROM organizations WHERE id = 'durapan';
