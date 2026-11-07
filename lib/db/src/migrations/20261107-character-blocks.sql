CREATE TABLE IF NOT EXISTS echo_character_blocks (
  blocker_owner_id text NOT NULL,
  blocker_universe_id text NOT NULL,
  blocker_character_id text NOT NULL,
  blocked_owner_id text NOT NULL,
  blocked_universe_id text NOT NULL,
  blocked_character_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT echo_character_blocks_pk PRIMARY KEY (
    blocker_owner_id, blocker_universe_id, blocker_character_id,
    blocked_owner_id, blocked_universe_id, blocked_character_id
  ),
  CONSTRAINT echo_character_blocks_blocker_universe_fk FOREIGN KEY
    (blocker_owner_id, blocker_universe_id)
    REFERENCES echo_universes(owner_id, universe_id) ON DELETE CASCADE,
  CONSTRAINT echo_character_blocks_blocked_universe_fk FOREIGN KEY
    (blocked_owner_id, blocked_universe_id)
    REFERENCES echo_universes(owner_id, universe_id) ON DELETE CASCADE,
  CONSTRAINT echo_character_blocks_not_self_check CHECK (NOT (
    blocker_owner_id = blocked_owner_id AND
    blocker_universe_id = blocked_universe_id AND
    blocker_character_id = blocked_character_id
  ))
);
CREATE INDEX IF NOT EXISTS echo_character_blocks_blocked_idx
  ON echo_character_blocks(blocked_owner_id, blocked_universe_id, blocked_character_id);
