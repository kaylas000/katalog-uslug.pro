-- db/migrations/019_cleanup_penrod_duplicate.sql
-- Remove duplicate organization 'penrod' (new ID without data).
-- Keep 'durapan' as the original entry with photos and history.

DELETE FROM organizations WHERE id = 'penrod';
