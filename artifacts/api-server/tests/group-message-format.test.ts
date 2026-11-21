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

test("removes Kindroid message boundary markers but preserves the actual message", () => {
  const message = "START MESSAGE\n[Theo Brooks] Going out tonight.\nEND MESSAGE";
  assert.equal(cleanGroupSpeakerPrefix(message, "Theo Brooks"), "Going out tonight.");
  assert.equal(cleanGroupSpeakerPrefix("<<START MESSAGE>>\nHello\n<<END MESSAGE>>", "Theo Brooks"), "Hello");
  assert.equal(cleanGroupSpeakerPrefix("I wrote START MESSAGE in my notebook.", "Theo Brooks"),
    "I wrote START MESSAGE in my notebook.");
});
