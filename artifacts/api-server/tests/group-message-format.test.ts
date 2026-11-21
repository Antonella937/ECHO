import test from "node:test";
import assert from "node:assert/strict";
import { cleanGroupSpeakerPrefix } from "../src/autonomy/group-message-format";

test("removes repeated own speaker labels but preserves paragraphs", () => {
  const message = 'If I don\'t finish this sketch...\n\n[Theo Brooks] I need a break.\n\n[Theo Brooks] Nela, nice work.\n\n[Theo Brooks] Luca saw a cat.';
  assert.equal(cleanGroupSpeakerPrefix(message, "Theo Brooks"),
    "If I don't finish this sketch...\n\nI need a break.\n\nNela, nice work.\n\nLuca saw a cat.");
});

test("does not remove another character's name or mid-sentence mentions", () => {
  assert.equal(cleanGroupSpeakerPrefix("[Mar Mulligan] Hello\nTheo Brooks: Hi\nI saw Theo Brooks today", "Theo Brooks"),
    "[Mar Mulligan] Hello\nHi\nI saw Theo Brooks today");
});
