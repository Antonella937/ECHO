/** Scene presence is a narrative lock, not a restriction on user-initiated private chat. */
export type ScenePresenceStatus = 'active' | 'paused' | 'ended';
export interface CharacterScenePresence {
  sceneId: string;
  characterId: string;
  status: ScenePresenceStatus;
  location: string | null;
  enteredAt: string;
  exitedAt?: string | null;
}
export type OutboundLane = 'scene' | 'dm';
export type OutboundCause = 'user_reply' | 'autonomous';
export interface OutboundIntent {
  characterId: string;
  lane: OutboundLane;
  cause: OutboundCause;
  sceneId?: string | null;
  /** A private message explicitly grounded in the ongoing scene. */
  sceneLinked?: boolean;
  /** True only when a deliberate private communication is requested or initiated. */
  explicitlyPrivate?: boolean;
  /** Event that caused the response, for cross-lane deduplication. */
  sourceEventId?: string | null;
}
export type PresenceDecision = 'allow' | 'suppress' | 'route_to_scene';

/**
 * Gate at dispatch time, not only at scheduling time, to prevent stale queued
 * spontaneous messages from appearing after a character joins a scene.
 */
export function decideOutboundWithPresence(
  intent: OutboundIntent,
  presence: CharacterScenePresence | null,
): PresenceDecision {
  if (!presence || presence.status !== 'active' || presence.characterId !== intent.characterId) return 'allow';
  if (intent.lane === 'scene') return intent.sceneId === presence.sceneId ? 'allow' : 'suppress';
  // Never block a private DM initiated by the human.
  if (intent.cause === 'user_reply') return 'allow';
  // A spontaneous DM may be permitted only when explicitly linked to this same scene.
  if (intent.sceneLinked && intent.explicitlyPrivate && intent.sceneId === presence.sceneId) return 'allow';
  // Autonomous dialogue belongs to the active scene, not an unrelated DM.
  return 'route_to_scene';
}

/** Prompt context for a user-initiated DM while a scene is ongoing. */
export function scenePresenceInstructions(presence: CharacterScenePresence | null): string {
  if (!presence || presence.status !== 'active') return '';
  return [
    'You are currently participating in an active scene.',
    presence.location ? `Current scene location: ${presence.location}.` : '',
    'Maintain continuity with the active scene. Do not claim to be elsewhere or describe conflicting activities.',
    'You may reply privately to the user, but other scene participants cannot read this private conversation.',
  ].filter(Boolean).join('\n');
}

/** A scene event must produce at most one public response per character. */
export function sceneResponseDedupeKey(intent: OutboundIntent, presence: CharacterScenePresence | null): string | null {
  if (!presence || presence.status !== 'active' || !intent.sourceEventId) return null;
  if (intent.cause === 'user_reply' && intent.lane === 'dm') return null;
  return [presence.sceneId, intent.characterId, intent.sourceEventId, intent.explicitlyPrivate ? 'private' : 'public'].join(':');
}

/** A whisper or spoken aside stays in the scene; only an actual private message uses DM. */
export function sceneResponseDestination(intent: OutboundIntent, presence: CharacterScenePresence | null): OutboundLane {
  const decision = decideOutboundWithPresence(intent, presence);
  return decision === 'route_to_scene' ? 'scene' : intent.lane;
}
