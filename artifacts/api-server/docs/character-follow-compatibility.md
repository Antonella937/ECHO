# Character follow storage compatibility

New cross-owner character follows and follow requests are stored in the
owner/universe/character-scoped relational tables
`echo_character_follows` and `echo_character_follow_requests`. These routes do
not copy, clear, or rewrite the legacy `SocialState.follows` JSON stored in
`echo_universes.state`.

Until a later integration explicitly migrates or adapts legacy relationships,
the new follow APIs treat the relational tables as authoritative only for
relationships created through these APIs. Callers must not blindly add legacy
and relational counts together: that could double-count a relationship present
in both sources. A future profile/feed reader should either (1) migrate legacy
edges idempotently into the relational tables with owner and universe identity
resolved, then retire legacy reads, or (2) use a deduplicating adapter keyed by
the full source and target owner/universe/character tuple.

Deleting a character through the owner-scoped universe save removes only that
character's relational follow/request/privacy rows in the same transaction.
Archiving a character does not delete its relationships. Deleting a universe
cascades its relational social rows.
