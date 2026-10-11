-- Needed to download a tournament back into the client-side editor losslessly: without it,
-- there's no way to tell a Swiss event from an elimination bracket once it's in the database.
-- Existing rows default to 'swiss', which happens to be correct for every tournament uploaded
-- so far (Meetup#1 included).
ALTER TABLE tournaments ADD COLUMN format TEXT NOT NULL DEFAULT 'swiss'
  CHECK (format IN ('swiss', 'elimination'));
