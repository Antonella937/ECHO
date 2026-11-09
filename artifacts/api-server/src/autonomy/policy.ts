import type {
  CharacterDecisionInput,
  Character,
  Comment,
  Message,
  Post,
  RoutineEntry,
  Story,
  SocialState,
} from "@workspace/api-zod";
import { canCharacterViewCloseFriendsStory } from "../lib/storySharePolicy";

export type AutonomySituation = CharacterDecisionInput["situation"];
export type ExecutedAutonomyAction = {
  status: string;
  action: string | null;
  situation: string | null;
  targetId?: string | null;
  createdAt: Date;
};

export type Opportunity = {
  situation: AutonomySituation | null;
  postId?: string;
  commentId?: string;
  recipientId?: string;
  storyId?: string;
  /** A text-only story uses the existing post draft schema without expanding model actions. */
  publishStory?: boolean;
  messageId?: string;
  reasonCode:
    | "OPPORTUNITY_SELECTED"
    | "SILENCE_SELECTED"
    | "SLEEP_ROUTINE"
    | "COOLDOWN"
    | "DAILY_CAP"
    | "NO_SOCIAL_TARGET";
  reason: string;
  localHour: number;
  timezone: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const frequencyWeight = (value: unknown) =>
  value === "frequent" ? 1.55 : value === "rare" ? 0.55 : 1;

function clockParts(now: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const get = (key: string) => parts.find((part) => part.type === key)?.value ?? "";
    const weekdays: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    return {
      hour: Number(get("hour")),
      minute: Number(get("minute")),
      weekday: weekdays[get("weekday")] ?? 1,
      date: (() => {
        const dateParts = new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
        }).formatToParts(now);
        const part = (type: string) => dateParts.find((item) => item.type === type)?.value ?? "00";
        return `${part("year")}-${part("month")}-${part("day")}`;
      })(),
    };
  } catch {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now);
    const get = (key: string) => parts.find((part) => part.type === key)?.value ?? "";
    const weekdays: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    return { hour: Number(get("hour")), minute: Number(get("minute")), weekday: weekdays[get("weekday")] ?? 1, date: now.toISOString().slice(0, 10) };
  }
}

function minutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function activeRoutineEntry(entries: RoutineEntry[], now: Date, timezone: string) {
  const local = clockParts(now, timezone);
  const minuteOfDay = local.hour * 60 + local.minute;
  return entries.find((entry) => {
    if (entry.recurrence === "once" && entry.date !== local.date) return false;
    if (entry.recurrence !== "once" && !entry.weekdays.includes(local.weekday)) return false;
    const start = minutes(entry.start), end = minutes(entry.end);
    if (start === null || end === null) return false;
    return start <= end
      ? minuteOfDay >= start && minuteOfDay < end
      : minuteOfDay >= start || minuteOfDay < end;
  });
}

function asTime(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function recentActorActivity(state: SocialState, characterId: string, now: Date): number[] {
  return [
    ...state.posts.filter((item: Post) => item.authorId === characterId && item.origin !== "autonomy").map((item) => asTime(item.createdAt)),
    ...state.comments.filter((item: Comment) => item.authorId === characterId && item.origin !== "autonomy").map((item) => asTime(item.createdAt)),
    ...state.stories.filter((item: Story) => item.authorId === characterId && item.origin !== "autonomy").map((item) => asTime(item.createdAt)),
    ...state.messages.filter((item: Message) => item.senderId === characterId && item.origin !== "autonomy").map((item) => asTime(item.createdAt)),
  ].filter((time): time is number => time !== null && time <= now.getTime() && now.getTime() - time < DAY_MS);
}

// Autonomous social outreach is limited to followed accounts. An existing DM
// thread is an additional valid DM connection, even without a follow.
function hasDmThread(state: SocialState, a: string, b: string) {
  return state.messages.some(message =>
    !message.hiddenForIds?.includes(a) &&
    ((message.senderId === a && message.recipientId === b) ||
      (message.senderId === b && message.recipientId === a)));
}

function availableTargets(state: SocialState, character: Character) {
  const following = new Set(state.follows[character.id] ?? []);
  return state.characters.filter(candidate =>
    candidate.id !== character.id && !candidate.archived &&
    (following.has(candidate.id) || hasDmThread(state, character.id, candidate.id)));
}

function commentTarget(state: SocialState, character: Character, now: Date) {
  const following = new Set(state.follows[character.id] ?? []);
  const posts = [...state.posts]
    .filter(post => post.authorId !== character.id &&
      following.has(post.authorId) && post.commentsEnabled !== false &&
      (asTime(post.createdAt) ?? 0) <= now.getTime() &&
      now.getTime() - (asTime(post.createdAt) ?? 0) < 30 * DAY_MS)
    .sort((a, b) => (asTime(b.createdAt) ?? 0) - (asTime(a.createdAt) ?? 0));
  for (const post of posts) {
    const reply = [...state.comments]
      .filter(item => item.postId === post.id && item.authorId !== character.id && item.parentId === null &&
        !state.comments.some(child => child.parentId === item.id && child.authorId === character.id))
      .sort((a, b) => (asTime(b.createdAt) ?? 0) - (asTime(a.createdAt) ?? 0))[0];
    if (reply) return { post, comment: reply };
    if (!state.comments.some(item => item.postId === post.id && item.authorId === character.id)) {
      return { post, comment: undefined };
    }
  }
  return undefined;
}

function countRecentHistory(history: ExecutedAutonomyAction[], now: Date) {
  return history.filter((event) =>
    event.status === "executed" &&
    event.createdAt.getTime() <= now.getTime() &&
    now.getTime() - event.createdAt.getTime() < DAY_MS,
  );
}

/**
 * Chooses at most one present-time text scenario. It never queues missed checks,
 * never writes social data, and receives an injectable random source for tests.
 */
export function chooseAutonomyOpportunity(input: {
  state: SocialState;
  character: Character;
  history: ExecutedAutonomyAction[];
  now?: Date;
  random?: () => number;
  minCooldownMinutes?: number;
  maxActionsPerDay?: number;
  lane?: "dm" | "social";
}): Opportunity {
  const { state, character } = input;
  const now = input.now ?? new Date();
  const random = input.random ?? Math.random;
  const config = character.configuration;
  const timezone = config?.routine?.timezone?.trim() || "UTC";
  const local = clockParts(now, timezone);
  // Social posting and conversational DM replies have independent budgets.
  // Otherwise frequent DMs permanently suppress posts, likes and comments.
  const history = countRecentHistory(input.history, now).filter(event =>
    input.lane === "social" ? event.situation !== "dm" : event.situation === "dm");
  // Only autonomous executions determine autonomous cooldown and daily caps.
  // Manual account management never postpones the character's own activity.
  const recentSocial: number[] = [];
  const latestActivity = Math.max(
    ...recentSocial,
    ...history.map((event) => event.createdAt.getTime()),
    0,
  );
  // Reply to the latest unanswered incoming DM before considering unsolicited social activity.
  // All identities in a universe, including owner-controlled identities, can receive replies.
  const incoming = [...state.messages]
    .filter((message) => message.recipientId === character.id &&
      message.senderId !== character.id &&
      !message.hiddenForIds?.includes(character.id) &&
      !!message.text.trim() &&
      (asTime(message.createdAt) ?? 0) <= now.getTime() &&
      now.getTime() - (asTime(message.createdAt) ?? 0) < 30 * DAY_MS)
    .sort((a, b) => (asTime(b.createdAt) ?? 0) - (asTime(a.createdAt) ?? 0));
  const unanswered = incoming.slice(0, 1).find((message) => {
    const sentAt = asTime(message.createdAt) ?? 0;
    const latestOwnReply = state.messages
      .filter((item) => item.senderId === character.id && item.recipientId === message.senderId)
      .reduce((latest, item) => Math.max(latest, asTime(item.createdAt) ?? 0), 0);
    return latestOwnReply < sentAt;
  });
  // Incoming replies use a short independent delay, not the 6-hour posting cooldown.
  // A per-character daily ceiling still prevents unbounded conversations.
  // An incoming DM is a reply obligation, not spontaneous outreach. Do not
  // impose a blanket two-minute delay or cooldown between conversational turns.
  // Idempotency and the unanswered-message check prevent duplicate replies.
  if (input.lane !== "social" && unanswered) {
    return { situation: "dm", recipientId: unanswered.senderId,
      reasonCode: "OPPORTUNITY_SELECTED",
      reason: "A recent incoming direct message is awaiting a reply.",
      localHour: local.hour, timezone };
  }

  // A story reply is a private DM, not a public story reaction. Keep it in the
  // existing DM lane so bilateral permissions and delivery limits still apply.
  if (input.lane === "dm" && !unanswered &&
      history.length < (input.maxActionsPerDay ?? 2) &&
      (latestActivity === 0 || now.getTime() - latestActivity >= (input.minCooldownMinutes ?? 360) * 60_000) &&
      random() < 0.18) {
    const following = new Set(state.follows[character.id] ?? []);
    const candidate = [...state.stories].reverse().find(story =>
      story.authorId !== character.id && following.has(story.authorId) &&
      canCharacterViewCloseFriendsStory(state, story, character.id) &&
      (asTime(story.createdAt) ?? 0) > now.getTime() - DAY_MS &&
      (asTime(story.createdAt) ?? 0) <= now.getTime() &&
      !state.messages.some(message => message.senderId === character.id && message.storyId === story.id) &&
      !history.some(item => item.situation === "dm" && item.targetId === story.authorId));
    if (candidate) {
      return { situation: "dm", recipientId: candidate.authorId, storyId: candidate.id,
        reasonCode: "OPPORTUNITY_SELECTED",
        reason: "A visible story from a followed account invites an occasional private reply.",
        localHour: local.hour, timezone };
    }
  }
  // Social activity should have its own cadence, independent of DMs and
  // manually authored content. Never silently extend the configured interval.
  const cooldownMs = (input.minCooldownMinutes ?? 360) * 60_000;
  if (latestActivity > 0 && now.getTime() - latestActivity < cooldownMs) {
    return { situation: null, reasonCode: "COOLDOWN", reason: "Minimum cooldown has not elapsed.", localHour: local.hour, timezone };
  }
  // Executed autonomous actions are already in history; do not count them twice
  // merely because their resulting posts/messages also exist in the state.
  if (history.length >= (input.maxActionsPerDay ?? 2)) {
    return { situation: null, reasonCode: "DAILY_CAP", reason: "Character daily action cap reached.", localHour: local.hour, timezone };
  }

  const activeRoutine = config?.routine?.entries?.length
    ? activeRoutineEntry(config.routine.entries, now, timezone)
    : undefined;
  const currentActivity = `${activeRoutine?.activity ?? ""} ${config?.currentState?.activity ?? ""}`.toLowerCase();
  if (/\b(sleep|sleeping|dormir|durmiendo|descansando)\b/.test(currentActivity)) {
    return { situation: null, reasonCode: "SLEEP_ROUTINE", reason: "Current routine or state indicates sleep/rest.", localHour: local.hour, timezone };
  }

  const social = config?.social;
  const base = social?.activity === "high" ? 0.48 : social?.activity === "low" ? 0.18 : 0.32;
  let opportunityChance = base;
  if (social?.sociability === "high") opportunityChance += 0.07;
  if (social?.sociability === "low") opportunityChance -= 0.05;
  if (social?.spontaneity === "high") opportunityChance += 0.06;
  if (social?.allowSilence) opportunityChance *= 0.82;
  if (local.hour < 6 || local.hour >= 23) opportunityChance *= 0.28;
  if (activeRoutine && !/free|leisure|social|salir|tiempo libre/i.test(String(activeRoutine.activity))) opportunityChance *= 0.6;
  opportunityChance = Math.max(0.04, Math.min(0.65, opportunityChance));

  if (random() >= opportunityChance) {
    return { situation: null, reasonCode: "SILENCE_SELECTED", reason: "Current activity and configured social pace favor doing nothing.", localHour: local.hour, timezone };
  }

  const comment = commentTarget(state, character, now);
  const recipients = availableTargets(state, character);
  const following = new Set(state.follows[character.id] ?? []);
  const relevantAuthor = (authorId: string) => authorId !== character.id && following.has(authorId);
  const recentTargetUsed = (situation: AutonomySituation, targetId: string) =>
    history.some(event => event.situation === situation && event.targetId === targetId);
  const recent30d = (value: Date | string) => {
    const time = asTime(value);
    return time !== null && time <= now.getTime() && now.getTime() - time < 30 * DAY_MS;
  };
  const targetPost = [...state.posts].sort((a, b) => (asTime(b.createdAt) ?? 0) - (asTime(a.createdAt) ?? 0))
    .find(post => recent30d(post.createdAt) && relevantAuthor(post.authorId) &&
      !post.likes.includes(character.id) && !recentTargetUsed("like_post", post.id));
  const targetComment = [...state.comments].sort((a, b) => (asTime(b.createdAt) ?? 0) - (asTime(a.createdAt) ?? 0))
    .find(item => {
      const parent = state.posts.find(post => post.id === item.postId);
      return !!parent && item.authorId !== character.id && !!item.text?.trim() && recent30d(item.createdAt) &&
        relevantAuthor(parent.authorId) &&
        !item.likes.includes(character.id) && !recentTargetUsed("like_comment", item.id);
    });
  const targetStory = [...state.stories].sort((a, b) => Number(a.seenBy.includes(character.id)) - Number(b.seenBy.includes(character.id)) || (asTime(b.createdAt) ?? 0) - (asTime(a.createdAt) ?? 0))
    .find(item => recent24h(item.createdAt) && item.authorId !== character.id &&
      following.has(item.authorId) &&
      canCharacterViewCloseFriendsStory(state, item, character.id) &&
      !item.reactions?.some(reaction => reaction.actorId === character.id) && !recentTargetUsed("story_reaction", item.id));
  const targetMessage = [...state.messages].sort((a, b) => (asTime(b.createdAt) ?? 0) - (asTime(a.createdAt) ?? 0))
    .find(item => item.recipientId === character.id && item.senderId !== character.id &&
      !item.hiddenForIds?.includes(character.id) && !!item.text?.trim() && recent30d(item.createdAt) &&
      !item.reactions?.some(reaction => reaction.actorId === character.id) && !recentTargetUsed("dm_reaction", item.id));
  function recent24h(value: Date | string) {
    const time = asTime(value);
    return time !== null && time <= now.getTime() && now.getTime() - time < DAY_MS;
  }
  const recentDate = (value: Date | string) => {
    const time = asTime(value);
    return time !== null && time <= now.getTime() && now.getTime() - time < DAY_MS;
  };
  const postCount = state.posts.filter((item) => item.authorId === character.id && item.origin === "autonomy" && recentDate(item.createdAt)).length;
  const storyCount = state.stories.filter((item) => item.authorId === character.id && item.origin === "autonomy" && recentDate(item.createdAt)).length;
  // A manually posted story does not consume the autonomous story allowance.
  const anyStoryToday = state.stories.some((item) => item.authorId === character.id && recentDate(item.createdAt));
  const commentCount = state.comments.filter((item) => item.authorId === character.id && item.origin === "autonomy" && recentDate(item.createdAt)).length;
  const dmCount = state.messages.filter((item) => item.senderId === character.id && item.origin === "autonomy" && recentDate(item.createdAt)).length;
  const actionCount = (situation: AutonomySituation) => history.filter(item => item.situation === situation).length;
  const weights = [
    ...(postCount < 1 ? [{ situation: "post" as const, weight: frequencyWeight(social?.postsFrequency), publishStory: false }] : []),
    ...(storyCount < 1 && !anyStoryToday ? [{ situation: "post" as const, weight: frequencyWeight(social?.storiesFrequency), publishStory: true }] : []),
    ...(comment && commentCount < 3 ? [{ situation: "comment" as const, weight: frequencyWeight(social?.commentsFrequency) }] : []),
    ...(input.lane === "dm" && recipients.length && dmCount < 1
      ? [{ situation: "dm" as const, weight: frequencyWeight(social?.initiatesDMs) }]
      : []),
    ...(targetPost && actionCount("like_post") < 3
      ? [{ situation: "like_post" as const, weight: frequencyWeight(social?.likesFrequency) }] : []),
    ...(targetComment && actionCount("like_comment") < 3
      ? [{ situation: "like_comment" as const, weight: frequencyWeight(social?.likesFrequency) }] : []),
    ...(targetStory && actionCount("story_reaction") < 2
      ? [{ situation: "story_reaction" as const, weight: frequencyWeight(social?.storiesFrequency) }] : []),
    ...(targetMessage && actionCount("dm_reaction") < 2
      ? [{ situation: "dm_reaction" as const, weight: frequencyWeight(social?.likesFrequency) }] : []),
  ].filter((item) => input.lane === "dm" ? item.situation === "dm" : item.situation !== "dm");
  if (weights.length === 0) {
    return { situation: null, reasonCode: "NO_SOCIAL_TARGET", reason: "No text action is currently eligible under the anti-repetition caps.", localHour: local.hour, timezone };
  }
  const total = weights.reduce((sum, item) => sum + item.weight, 0);
  let cursor = random() * total;
  const selected = weights.find((item) => (cursor -= item.weight) < 0) ?? weights[0];
  if (selected.situation === "comment" && comment) {
    return {
      situation: "comment",
      postId: comment.post.id,
      ...(comment.comment ? { commentId: comment.comment.id } : {}),
      reasonCode: "OPPORTUNITY_SELECTED",
      reason: comment.comment
        ? "A relevant conversation has a comment that can be replied to once."
        : "A recent relevant post can be commented on without repeating a prior comment.",
      localHour: local.hour,
      timezone,
    };
  }
  if (selected.situation === "dm" && recipients.length) {
    const recipient = recipients.sort((a, b) => {
      const relation = (id: string) => config?.relationships.find((item) => item.targetId === id)?.closeness ?? 0;
      return relation(b.id) - relation(a.id);
    })[0];
    return { situation: "dm", recipientId: recipient.id, reasonCode: "OPPORTUNITY_SELECTED", reason: "A followed account or existing direct conversation provides a valid recipient.", localHour: local.hour, timezone };
  }
  if (selected.situation === "like_post" && targetPost) {
    return { situation: "like_post", postId: targetPost.id, reasonCode: "OPPORTUNITY_SELECTED",
      reason: "A recent post from a relevant account has text context and has not been liked by this character.", localHour: local.hour, timezone };
  }
  if (selected.situation === "like_comment" && targetComment) {
    return { situation: "like_comment", postId: targetComment.postId, commentId: targetComment.id,
      reasonCode: "OPPORTUNITY_SELECTED", reason: "A relevant comment is available for a non-repeating like.", localHour: local.hour, timezone };
  }
  if (selected.situation === "story_reaction" && targetStory) {
    return { situation: "story_reaction", storyId: targetStory.id, reasonCode: "OPPORTUNITY_SELECTED",
      reason: "An accessible story from a followed account can be viewed without reacting or optionally receive a reaction.", localHour: local.hour, timezone };
  }
  if (selected.situation === "dm_reaction" && targetMessage) {
    return { situation: "dm_reaction", messageId: targetMessage.id, reasonCode: "OPPORTUNITY_SELECTED",
      reason: "A recent, visible message has text context and has not been reacted to by this character.", localHour: local.hour, timezone };
  }
  if (selected.situation === "post") {
    return { situation: "post", ...(selected.publishStory ? { publishStory: true } : {}), reasonCode: "OPPORTUNITY_SELECTED", reason: selected.publishStory ? "The character may publish a short text story." : "The character may publish a feed post.", localHour: local.hour, timezone };
  }
  return { situation: null, reasonCode: "NO_SOCIAL_TARGET", reason: "The selected opportunity no longer has a valid target.", localHour: local.hour, timezone };
}

export function liveEligibility(input: {
  globalKillSwitchEngaged: boolean;
  characterEnabled: boolean;
  opportunity: Opportunity;
}) {
  return !input.globalKillSwitchEngaged && input.characterEnabled && input.opportunity.situation !== null;
}
