-- A hash for the 'claim' provider's own code+PIN login. OAuth providers (line/google) never
-- need this — the provider itself holds the credential — so it stays NULL for those rows.
ALTER TABLE auth_identities ADD COLUMN secret_hash TEXT;
