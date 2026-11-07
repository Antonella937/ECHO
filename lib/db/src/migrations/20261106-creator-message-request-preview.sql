-- Store the first message privately with the pending request, not as a delivered DM.
ALTER TABLE echo_creator_message_requests ADD COLUMN IF NOT EXISTS preview_body text;
ALTER TABLE echo_creator_message_requests ADD CONSTRAINT echo_creator_request_preview_length CHECK (preview_body IS NULL OR char_length(preview_body) BETWEEN 1 AND 2000);
