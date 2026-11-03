import { randomUUID } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import {
  SaveUniverseBody,
  type CharacterDecision,
  type Comment,
  type Message,
  type Notification,
  type Post,
  type SocialState,
  type Story,
} from "@workspace/api-zod";
import {
  db,
  echoAutonomyCharactersTable,
  echoAutonomyOwnersTable,
  echoAutonomyRunsTable,
  echoUniversesTable,
} from "@workspace/db";
import { DEFAULT_CHARACTER_CONTROL, isAutonomyLiveExecutionEnabled } from "./constants";
import type { Opportunity } from "./policy";

const DAY_MS = 24 * 60 * 60_000;
const ALLOWED_REACTIONS = new Set(["❤", "😂", "😮", "😢", "🔥", "👏"]);

export type LiveExecutionOutcome =
  | { status: "executed"; action: string; situation: string; targetId: string | null; revision: number }
  | { status: "no_action" | "disabled" | "duplicate" | "stale_revision" | "blocked" | "rate_limited"; reasonCode: string };

export class SocialExecutionError extends Error {
  constructor(public readonly reasonCode: string) {
    super(reasonCode);
  }
}

function threadIdFor(a: string, b: string) {
  return [a, b].sort().join("__");
}

function timeOf(value: Date | string | null | undefined) {
  if (!value) return NaN;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function recentWithin(value: Date | string | null | undefined, now: Date, durationMs: number) {
  const time = timeOf(value);
  return Number.isFinite(time) && time <= now.getTime() && now.getTime() - time < durationMs;
}

function actionNotification(
  id: string,
  recipientId: string,
  actorId: string,
  kind: string,
  excerpt: string,
  createdAt: Date,
  postId: string | null = null,
  commentId: string | null = null,
  storyId: string | null = null,
): Notification {
  return { id, recipientId, actorId, kind, excerpt: excerpt.slice(0, 180), postId, commentId, storyId, createdAt, read: false };
}

function relevantAuthor(state: SocialState, actorId: string, authorId: string, tagged = false) {
  const actor = state.characters.find((item) => item.id === actorId);
  return authorId !== actorId && (tagged || !!state.follows[actorId]?.includes(authorId) ||
    !!actor?.configuration?.relationships?.some((relationship) => relationship.targetId === authorId));
}

export function applyAutonomyDecision(
  state: SocialState,
  characterId: string,
  opportunity: Opportunity,
  decision: CharacterDecision,
  now = new Date(),
  idFactory: () => string = randomUUID,
): { state: SocialState; changed: boolean; targetId: string | null } {
  if (decision.action === "none") return { state, changed: false, targetId: null };
  const character = state.characters.find((item) => item.id === characterId && !item.archived);
  if (!character) throw new SocialExecutionError("CHARACTER_NOT_ACTIVE");

  const text = decision.text?.trim() ?? "";

  if (decision.action === "draft" && decision.situation === "post") {
    if (!text) throw new SocialExecutionError("EMPTY_POST_TEXT");
    const post: Post = {
      id: idFactory(), authorId: characterId, image: "", caption: text, location: "",
      createdAt: now, likes: [], savedBy: [], origin: "autonomy", illustrative: false, commentsEnabled: true,
    };
    return { state: { ...state, posts: [...state.posts, post] }, changed: true, targetId: post.id };
  }

  if (decision.action === "draft" && decision.situation === "comment") {
    if (!text || !opportunity.postId) throw new SocialExecutionError("INVALID_COMMENT_TARGET");
    const post = state.posts.find((item) => item.id === opportunity.postId && item.commentsEnabled !== false);
    if (!post || !recentWithin(post.createdAt, now, 30 * DAY_MS)) {
      throw new SocialExecutionError("COMMENT_TARGET_UNAVAILABLE");
    }
    const parent = opportunity.commentId
      ? state.comments.find((item) => item.id === opportunity.commentId && item.postId === post.id)
      : undefined;
    if (opportunity.commentId && (!parent || parent.authorId === characterId)) {
      throw new SocialExecutionError("REPLY_TARGET_UNAVAILABLE");
    }
    const postIsRelevant = relevantAuthor(state, characterId, post.authorId, !!post.taggedAccountIds?.includes(characterId));
    const parentIsRelevant = !!parent && relevantAuthor(state, characterId, parent.authorId);
    if ((!parent && !postIsRelevant) || (parent && !postIsRelevant && !parentIsRelevant)) {
      throw new SocialExecutionError("COMMENT_TARGET_NOT_RELEVANT");
    }
    if (parent && state.comments.some((item) => item.parentId === parent.id && item.authorId === characterId)) {
      throw new SocialExecutionError("DUPLICATE_REPLY");
    }
    const comment: Comment = {
      id: idFactory(), postId: post.id, authorId: characterId, text, createdAt: now,
      parentId: parent?.id ?? null, replyToAuthorId: parent?.authorId ?? null, likes: [], origin: "autonomy",
    };
    const recipientId = parent?.authorId ?? post.authorId;
    const notification = actionNotification(
      idFactory(), recipientId, characterId, parent ? "reply" : "comment", text, now, post.id, comment.id,
    );
    return {
      state: { ...state, comments: [...state.comments, comment], notifications: [...state.notifications, notification] },
      changed: true, targetId: comment.id,
    };
  }

  if (decision.action === "draft" && decision.situation === "dm") {
    const recipientId = opportunity.recipientId;
    if (!text || !recipientId || recipientId === characterId ||
      !state.characters.some((item) => item.id === recipientId && !item.archived)) {
      throw new SocialExecutionError("DM_RECIPIENT_UNAVAILABLE");
    }
    const hasRelationship = character.configuration?.relationships?.some((item) => item.targetId === recipientId);
    const hasConversation = state.messages.some((item) =>
      !item.hiddenForIds?.includes(characterId) &&
      ((item.senderId === characterId && item.recipientId === recipientId) ||
        (item.recipientId === characterId && item.senderId === recipientId)));
    if (!hasRelationship && !hasConversation) throw new SocialExecutionError("DM_RECIPIENT_UNAVAILABLE");
    const message: Message = {
      id: idFactory(), threadId: threadIdFor(characterId, recipientId), senderId: characterId, recipientId,
      text, createdAt: now, storyId: null, postId: null, readBy: [characterId], origin: "autonomy",
    };
    const notification = actionNotification(idFactory(), recipientId, characterId, "message", text, now);
    return {
      state: { ...state, messages: [...state.messages, message], notifications: [...state.notifications, notification] },
      changed: true, targetId: recipientId,
    };
  }

  if (decision.action === "like" && decision.situation === "like_post") {
    const target = opportunity.postId ? state.posts.find((item) => item.id === opportunity.postId) : undefined;
    if (!target || !recentWithin(target.createdAt, now, 30 * DAY_MS) || !target.caption.trim() ||
      !relevantAuthor(state, characterId, target.authorId, !!target.taggedAccountIds?.includes(characterId)) ||
      target.likes.includes(characterId)) throw new SocialExecutionError("POST_LIKE_TARGET_UNAVAILABLE");
    const updated = { ...target, likes: [...target.likes, characterId] };
    const notification = actionNotification(idFactory(), target.authorId, characterId, "like", target.caption, now, target.id);
    return {
      state: {
        ...state, posts: state.posts.map((item) => item.id === target.id ? updated : item),
        notifications: [...state.notifications, notification],
      },
      changed: true, targetId: target.id,
    };
  }

  if (decision.action === "like" && decision.situation === "like_comment") {
    const target = opportunity.commentId ? state.comments.find((item) => item.id === opportunity.commentId) : undefined;
    const post = target ? state.posts.find((item) => item.id === target.postId) : undefined;
    if (!target || !post || !recentWithin(target.createdAt, now, 30 * DAY_MS) ||
      !target.text.trim() || target.authorId === characterId ||
      !relevantAuthor(state, characterId, post.authorId, !!post.taggedAccountIds?.includes(characterId)) &&
        !relevantAuthor(state, characterId, target.authorId) || target.likes.includes(characterId)) {
      throw new SocialExecutionError("COMMENT_LIKE_TARGET_UNAVAILABLE");
    }
    const updated = { ...target, likes: [...target.likes, characterId] };
    const notification = actionNotification(
      idFactory(), target.authorId, characterId, "like", target.text, now, post.id, target.id,
    );
    return {
      state: {
        ...state, comments: state.comments.map((item) => item.id === target.id ? updated : item),
        notifications: [...state.notifications, notification],
      },
      changed: true, targetId: target.id,
    };
  }

  if (decision.action === "react" && decision.situation === "story_reaction") {
    const target = opportunity.storyId ? state.stories.find((item) => item.id === opportunity.storyId) : undefined;
    if (!target || !target.caption.trim() || !recentWithin(target.createdAt, now, DAY_MS) ||
      !target.seenBy.includes(characterId) ||
      !relevantAuthor(state, characterId, target.authorId, !!target.mentionedAccountIds?.includes(characterId)) ||
      target.reactions?.some((item) => item.actorId === characterId)) {
      throw new SocialExecutionError("STORY_REACTION_TARGET_UNAVAILABLE");
    }
    const value = decision.reaction;
    if (!value || !ALLOWED_REACTIONS.has(value)) throw new SocialExecutionError("INVALID_REACTION");
    const reaction = { id: idFactory(), actorId: characterId, value };
    const notification = actionNotification(
      idFactory(), target.authorId, characterId, "story_reply", value, now, null, null, target.id,
    );
    return {
      state: {
        ...state,
        stories: state.stories.map((item) => item.id === target.id
          ? { ...item, reactions: [...(item.reactions ?? []), reaction] } : item),
        notifications: [...state.notifications, notification],
      },
      changed: true, targetId: target.id,
    };
  }

  if (decision.action === "react" && decision.situation === "dm_reaction") {
    const target = opportunity.messageId ? state.messages.find((item) => item.id === opportunity.messageId) : undefined;
    if (!target || target.recipientId !== characterId || target.senderId === characterId ||
      target.hiddenForIds?.includes(characterId) || !target.text.trim() ||
      !recentWithin(target.createdAt, now, 30 * DAY_MS) ||
      target.reactions?.some((item) => item.actorId === characterId)) {
      throw new SocialExecutionError("DM_REACTION_TARGET_UNAVAILABLE");
    }
    const value = decision.reaction;
    if (!value || !ALLOWED_REACTIONS.has(value)) throw new SocialExecutionError("INVALID_REACTION");
    const reaction = { id: idFactory(), actorId: characterId, value };
    const notification = actionNotification(
      idFactory(), target.senderId, characterId, "message", value, now,
    );
    return {
      state: {
        ...state,
        messages: state.messages.map((item) => item.id === target.id
          ? { ...item, reactions: [...(item.reactions ?? []), reaction] } : item),
        notifications: [...state.notifications, notification],
      },
      changed: true, targetId: target.id,
    };
  }

  throw new SocialExecutionError("ACTION_SITUATION_MISMATCH");
}

function recentActorActivityCount(state: SocialState, characterId: string, now: Date) {
  return [
    ...state.posts.filter((item) => item.authorId === characterId && item.origin !== "autonomy").map((item) => item.createdAt),
    ...state.comments.filter((item) => item.authorId === characterId && item.origin !== "autonomy").map((item) => item.createdAt),
    ...state.stories.filter((item) => item.authorId === characterId && item.origin !== "autonomy").map((item) => item.createdAt),
    ...state.messages.filter((item) => item.senderId === characterId && item.origin !== "autonomy").map((item) => item.createdAt),
  ].filter((value) => recentWithin(value, now, DAY_MS)).length;
}

export async function executeAutonomyDecision(input: {
  ownerId: string;
  universeId?: string;
  runId: string;
  characterId: string;
  sourceRevision: number;
  opportunity: Opportunity;
  decision: CharacterDecision;
  contextHash?: string | null;
  model?: string | null;
  liveEnabled?: boolean;
  now?: Date;
}): Promise<LiveExecutionOutcome> {
  if (!(input.liveEnabled ?? isAutonomyLiveExecutionEnabled())) return { status: "disabled", reasonCode: "LIVE_EXECUTION_DISABLED" };
  if (!input.ownerId) return { status: "disabled", reasonCode: "OWNER_REQUIRED" };
  const now = input.now ?? new Date();
  const universeId = input.universeId ?? "primary";
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(echoAutonomyRunsTable).where(and(
      eq(echoAutonomyRunsTable.ownerId, input.ownerId),
      eq(echoAutonomyRunsTable.universeId, universeId),
      eq(echoAutonomyRunsTable.id, Number(input.runId)),
    )).for("update").limit(1);
    if (!run || run.characterId !== input.characterId) return { status: "blocked", reasonCode: "RUN_NOT_OWNED" };
    if (run.status === "executed") return { status: "duplicate", reasonCode: "ALREADY_EXECUTED" };
    if (run.status !== "running") return { status: "blocked", reasonCode: "RUN_NOT_RUNNING" };

    const [owner] = await tx.select().from(echoAutonomyOwnersTable).where(
      eq(echoAutonomyOwnersTable.ownerId, input.ownerId),
    ).for("update").limit(1);
    const [characterControl] = await tx.select().from(echoAutonomyCharactersTable).where(and(
      eq(echoAutonomyCharactersTable.ownerId, input.ownerId),
      eq(echoAutonomyCharactersTable.universeId, universeId),
      eq(echoAutonomyCharactersTable.characterId, input.characterId),
    )).for("update").limit(1);
    if ((owner?.killSwitchEngaged ?? true) || !(characterControl?.enabled ?? false)) {
      await tx.update(echoAutonomyRunsTable).set({
        status: "blocked", lastErrorCode: "OPT_IN_OR_KILL_SWITCH", finishedAt: now, updatedAt: now,
      }).where(and(
        eq(echoAutonomyRunsTable.ownerId, input.ownerId),
        eq(echoAutonomyRunsTable.universeId, universeId),
        eq(echoAutonomyRunsTable.id, run.id),
      ));
      return { status: "disabled", reasonCode: "OPT_IN_OR_KILL_SWITCH" };
    }

    const [universe] = await tx.select().from(echoUniversesTable).where(
      and(
        eq(echoUniversesTable.ownerId, input.ownerId),
        eq(echoUniversesTable.universeId, universeId),
      ),
    ).for("update").limit(1);
    if (!universe || universe.revision !== input.sourceRevision) {
      await tx.update(echoAutonomyRunsTable).set({
        status: "stale_revision", lastErrorCode: "UNIVERSE_REVISION_CHANGED", finishedAt: now, updatedAt: now,
      }).where(and(
        eq(echoAutonomyRunsTable.ownerId, input.ownerId),
        eq(echoAutonomyRunsTable.universeId, universeId),
        eq(echoAutonomyRunsTable.id, run.id),
      ));
      return { status: "stale_revision", reasonCode: "UNIVERSE_REVISION_CHANGED" };
    }
    const stored = SaveUniverseBody.safeParse({ state: universe.state, expectedRevision: universe.revision });
    if (!stored.success) {
      await tx.update(echoAutonomyRunsTable).set({
        status: "blocked", lastErrorCode: "INVALID_UNIVERSE", finishedAt: now, updatedAt: now,
      }).where(and(
        eq(echoAutonomyRunsTable.ownerId, input.ownerId),
        eq(echoAutonomyRunsTable.universeId, universeId),
        eq(echoAutonomyRunsTable.id, run.id),
      ));
      return { status: "blocked", reasonCode: "INVALID_UNIVERSE" };
    }

    const state = stored.data.state;
    const character = state.characters.find((item) => item.id === input.characterId && !item.archived);
    if (!character) return { status: "blocked", reasonCode: "CHARACTER_NOT_ACTIVE" };
    const minCooldownMinutes = Math.max(60, Math.min(1440, characterControl?.minCooldownMinutes ?? DEFAULT_CHARACTER_CONTROL.minCooldownMinutes));
    const maxActionsPerDay = Math.max(1, Math.min(4, characterControl?.maxActionsPerDay ?? DEFAULT_CHARACTER_CONTROL.maxActionsPerDay));
    const since = new Date(now.getTime() - DAY_MS);
    const executedRows = await tx.select({
      action: echoAutonomyRunsTable.action,
      situation: echoAutonomyRunsTable.situation,
      targetId: echoAutonomyRunsTable.targetId,
      createdAt: echoAutonomyRunsTable.createdAt,
    }).from(echoAutonomyRunsTable).where(and(
      eq(echoAutonomyRunsTable.ownerId, input.ownerId),
      eq(echoAutonomyRunsTable.universeId, universeId),
      eq(echoAutonomyRunsTable.characterId, input.characterId),
      eq(echoAutonomyRunsTable.status, "executed"),
      gte(echoAutonomyRunsTable.createdAt, since),
    ));
    const [ownerHour] = await tx.select({ value: sql<number>`count(*)::int` }).from(echoAutonomyRunsTable).where(and(
      eq(echoAutonomyRunsTable.ownerId, input.ownerId), eq(echoAutonomyRunsTable.status, "executed"),
      gte(echoAutonomyRunsTable.createdAt, new Date(now.getTime() - 60 * 60_000)),
    ));
    const [ownerDay] = await tx.select({ value: sql<number>`count(*)::int` }).from(echoAutonomyRunsTable).where(and(
      eq(echoAutonomyRunsTable.ownerId, input.ownerId), eq(echoAutonomyRunsTable.status, "executed"),
      gte(echoAutonomyRunsTable.createdAt, since),
    ));
    if ((ownerHour?.value ?? 0) >= 3 || (ownerDay?.value ?? 0) >= 12) {
      await tx.update(echoAutonomyRunsTable).set({
        status: "rate_limited", lastErrorCode: "OWNER_ACTION_CAP", finishedAt: now, updatedAt: now,
      }).where(and(
        eq(echoAutonomyRunsTable.ownerId, input.ownerId),
        eq(echoAutonomyRunsTable.universeId, universeId),
        eq(echoAutonomyRunsTable.id, run.id),
      ));
      return { status: "rate_limited", reasonCode: "OWNER_ACTION_CAP" };
    }

    const history = executedRows.map((item) => ({ ...item, status: "executed" }));
    const recent = recentActorActivityCount(state, input.characterId, now);
    const toTime = timeOf;
    const recentManualTimes = [
      ...state.posts.filter((item) => item.authorId === input.characterId && item.origin !== "autonomy").map((item) => toTime(item.createdAt)),
      ...state.comments.filter((item) => item.authorId === input.characterId && item.origin !== "autonomy").map((item) => toTime(item.createdAt)),
      ...state.stories.filter((item) => item.authorId === input.characterId && item.origin !== "autonomy").map((item) => toTime(item.createdAt)),
      ...state.messages.filter((item) => item.senderId === input.characterId && item.origin !== "autonomy").map((item) => toTime(item.createdAt)),
    ].filter((time) => Number.isFinite(time) && time <= now.getTime() && now.getTime() - time < DAY_MS);
    const currentStateActivity = toTime(character.configuration?.currentState?.lastActivityAt ?? null);
    const latestActivity = Math.max(
      ...recentManualTimes,
      Number.isFinite(currentStateActivity) && currentStateActivity <= now.getTime() &&
        now.getTime() - currentStateActivity < DAY_MS ? currentStateActivity : 0,
      ...history.map((item) => item.createdAt.getTime()),
      0,
    );
    const typeCaps: Record<string, number> = {
      post: 1, comment: 3, dm: 1, like_post: 3, like_comment: 3, story_reaction: 2, dm_reaction: 2,
    };
    const situationCount = history.filter((item) => item.situation === input.opportunity.situation).length;
    const stateTypeCount = input.opportunity.situation === "post"
      ? state.posts.filter((item) => item.authorId === input.characterId && item.origin !== "autonomy" &&
        toTime(item.createdAt) >= since.getTime()).length
      : input.opportunity.situation === "comment"
        ? state.comments.filter((item) => item.authorId === input.characterId && item.origin !== "autonomy" &&
          toTime(item.createdAt) >= since.getTime()).length
        : input.opportunity.situation === "dm"
          ? state.messages.filter((item) => item.senderId === input.characterId && item.origin !== "autonomy" &&
            toTime(item.createdAt) >= since.getTime()).length
          : 0;
    const totalLimitHit = recent + history.length >= maxActionsPerDay ||
      (latestActivity > 0 && now.getTime() - latestActivity < minCooldownMinutes * 60_000);
    if (totalLimitHit || (input.opportunity.situation &&
      situationCount + stateTypeCount >= (typeCaps[input.opportunity.situation] ?? 0))) {
      await tx.update(echoAutonomyRunsTable).set({
        status: "rate_limited", lastErrorCode: totalLimitHit ? "CHARACTER_COOLDOWN_OR_DAILY_CAP" : "ACTION_TYPE_CAP",
        finishedAt: now, updatedAt: now,
      }).where(and(
        eq(echoAutonomyRunsTable.ownerId, input.ownerId),
        eq(echoAutonomyRunsTable.universeId, universeId),
        eq(echoAutonomyRunsTable.id, run.id),
      ));
      return { status: "rate_limited", reasonCode: totalLimitHit ? "CHARACTER_COOLDOWN_OR_DAILY_CAP" : "ACTION_TYPE_CAP" };
    }

    let mutation: ReturnType<typeof applyAutonomyDecision>;
    try {
      mutation = applyAutonomyDecision(state, input.characterId, input.opportunity, input.decision, now);
    } catch (error) {
      const reasonCode = error instanceof SocialExecutionError ? error.reasonCode : "ACTION_REVALIDATION_FAILED";
      await tx.update(echoAutonomyRunsTable).set({
        status: "blocked", lastErrorCode: reasonCode, finishedAt: now, updatedAt: now,
      }).where(and(
        eq(echoAutonomyRunsTable.ownerId, input.ownerId),
        eq(echoAutonomyRunsTable.universeId, universeId),
        eq(echoAutonomyRunsTable.id, run.id),
      ));
      return { status: "blocked", reasonCode };
    }
    if (!mutation.changed) {
      await tx.update(echoAutonomyRunsTable).set({
        status: "no_action", action: "none", situation: input.decision.situation,
        contextHash: input.contextHash ?? null, model: input.model ?? null,
        finishedAt: now, updatedAt: now,
      }).where(and(
        eq(echoAutonomyRunsTable.ownerId, input.ownerId),
        eq(echoAutonomyRunsTable.universeId, universeId),
        eq(echoAutonomyRunsTable.id, run.id),
      ));
      return { status: "no_action", reasonCode: "MODEL_SELECTED_NONE" };
    }

    const [saved] = await tx.update(echoUniversesTable).set({
      state: mutation.state as unknown as Record<string, unknown>,
      revision: sql`${echoUniversesTable.revision} + 1`,
      updatedAt: now,
    }).where(and(
      eq(echoUniversesTable.ownerId, input.ownerId),
      eq(echoUniversesTable.universeId, universeId),
      eq(echoUniversesTable.revision, input.sourceRevision),
    )).returning({ revision: echoUniversesTable.revision });
    if (!saved) throw new SocialExecutionError("UNIVERSE_REVISION_CHANGED");

    await tx.update(echoAutonomyRunsTable).set({
      status: "executed",
      action: input.decision.action,
      situation: input.decision.situation,
      targetId: mutation.targetId,
      sourceRevision: input.sourceRevision,
      contextHash: input.contextHash ?? null,
      model: input.model ?? null,
      lastErrorCode: null,
      finishedAt: now,
      updatedAt: now,
    }).where(and(
      eq(echoAutonomyRunsTable.ownerId, input.ownerId),
      eq(echoAutonomyRunsTable.universeId, universeId),
      eq(echoAutonomyRunsTable.id, run.id),
      eq(echoAutonomyRunsTable.status, "running"),
    ));
    return {
      status: "executed",
      action: input.decision.action,
      situation: input.decision.situation,
      targetId: mutation.targetId,
      revision: saved.revision,
    };
  });
}
