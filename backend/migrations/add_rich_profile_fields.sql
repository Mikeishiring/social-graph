-- Migration: Add rich profile fields from TwitterAPI.io
-- Run this on your existing database to add the new columns

-- Add new columns to accounts table
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS cover_url TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS location VARCHAR(255);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS media_count INTEGER;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS favourites_count INTEGER;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_automated BOOLEAN;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS possibly_sensitive BOOLEAN;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS can_dm BOOLEAN;

-- Add follow_position to snapshot_followers for tracking follow order
ALTER TABLE snapshot_followers ADD COLUMN IF NOT EXISTS follow_position INTEGER;

-- Create index on follow_position for efficient queries
CREATE INDEX IF NOT EXISTS ix_snapshot_followers_position ON snapshot_followers(snapshot_id, follow_position);
