/** ECHO Scenes: privacy-first event projection. No database or UI side effects. */
export type SceneVisibility = 'public' | 'participants' | 'private';
export type SceneCanon = 'main' | 'alternate';
export interface SceneEvent {
  id: string;
  sceneId: string;
  actorId: string;
  createdAt: string;
  visibility: SceneVisibility;
  audienceIds?: string[];
  text: string;
}
export interface SceneContext {
  sceneId: string;
  canon: SceneCanon;
  participantIds: string[];
  events: SceneEvent[];
}
export interface SceneLinkedMessage {
  messageId: string;
  conversationId: string;
  sceneId: string | null;
  sceneEventId?: string | null;
}

/** Project only events a participant is entitled to see. Never inject another DM transcript. */
export function visibleSceneEvents(scene: SceneContext, viewerId: string): SceneEvent[] {
  if (!scene.participantIds.includes(viewerId)) return [];
  return scene.events
    .filter(event => event.sceneId === scene.sceneId)
    .filter(event => {
      if (event.visibility === 'public') return true;
      if (event.visibility === 'participants') return scene.participantIds.includes(viewerId);
      return event.actorId === viewerId || (event.audienceIds ?? []).includes(viewerId);
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Transient context for a private DM while its owner is in an active scene. */
export function privateDmSceneContext(scene: SceneContext | null, dmParticipants: string[]): SceneEvent[] {
  if (!scene || dmParticipants.length !== 2 || !dmParticipants.every(id => scene.participantIds.includes(id))) return [];
  // Only shared/public scene observations; never relay private events from the scene.
  return visibleSceneEvents(scene, dmParticipants[0])
    .filter(event => event.visibility === 'public' || event.visibility === 'participants')
    .slice(-30);
}

/** No scene context after unlinking; the DM's own message history remains unchanged. */
export function unlinkSceneContext(link: SceneLinkedMessage): SceneLinkedMessage {
  return { ...link, sceneId: null, sceneEventId: null };
}
