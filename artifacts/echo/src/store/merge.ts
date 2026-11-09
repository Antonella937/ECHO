import type { SocialState } from '../domain/types';
import { deletionBlockReason } from '../domain/character-core';

export interface MergeConflict {
  path: string;
  local: unknown;
  remote: unknown;
}
export type Resolutions = Record<string, 'local' | 'remote'>;
export const same = (a: unknown, b: unknown): boolean => JSON.stringify(a, stable) === JSON.stringify(b, stable);
function stable(_key: string, value: unknown): unknown {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Three-way merge. Independent additions and set membership changes commute.
 * Edit/edit and delete/edit disagreements require an explicit human decision.
 * An absent base is used for legacy imports (union, never a blind replacement).
 */
export function mergeUniverse(
  base: SocialState | null, local: SocialState, remote: SocialState | null,
  resolutions: Resolutions = {},
): { state: SocialState; conflicts: MergeConflict[] } {
  if (!remote) return { state: structuredClone(local), conflicts: [] };
  const conflicts: MergeConflict[] = [];
  function conflict(b: unknown, l: unknown, r: unknown, path: string): unknown {
    if (!resolutions[path]) conflicts.push({ path, local: l, remote: r });
    return resolutions[path] === 'local' ? l : r;
  }
  function merge(b: unknown, l: unknown, r: unknown, path: string): unknown {
    // The active character is a local UI choice, never the authenticated owner.
    if (path === 'currentCharacterId') return l;
    // Older message records omit optional per-user collections. Missing and empty
    // mean the same thing; never interrupt a bookmark/hide action for this.
    if (/^messages\.[^.]+\.(savedByIds|hiddenForIds)$/.test(path)) {
      const left = l === undefined ? [] : l;
      const right = r === undefined ? [] : r;
      const previous = b === undefined ? [] : b;
      if (Array.isArray(left) && Array.isArray(right) && Array.isArray(previous)) {
        if (same(left, right)) return left;
        if (same(left, previous)) return right;
        if (same(right, previous)) return left;
        const old = new Set(previous);
        const ls = new Set(left), rs = new Set(right);
        return [...new Set([...left, ...right])].filter(id => old.has(id) ? ls.has(id) && rs.has(id) : ls.has(id) || rs.has(id));
      }
    }
    // Highlights belong to separate public accounts. A stale snapshot from
    // another active identity must not erase a different account's highlights.
    // Explicit deletion is allowed only while editing that highlight's owner.
    if (/^highlights\\.[^.]+$/.test(path) && object(b) && typeof b.authorId === 'string') {
      const owner = b.authorId;
      if (l === undefined && object(r) && owner !== local.currentCharacterId) return r;
      if (r === undefined && object(l) && owner !== remote.currentCharacterId) return l;
    }
    if (same(l, r)) return l;
    if (base && same(l, b)) return r;
    if (base && same(r, b)) return l;
    if (b === undefined && l === undefined) return r;
    if (b === undefined && r === undefined) return l;
    if (Array.isArray(l) && Array.isArray(r)) {
      // Carousel order is content, not set membership. Never silently reorder
      // conflicting versions of the same post during import/synchronization.
      if (/^posts\.[^.]+\.media$/.test(path)) return conflict(b, l, r, path);
      if ([...l, ...r].every(v => typeof v === 'string')) {
        const bs = new Set(Array.isArray(b) ? b : []);
        const ls = new Set(l), rs = new Set(r);
        return [...new Set([...l, ...r])].filter(id =>
          bs.has(id) ? ls.has(id) && rs.has(id) : ls.has(id) || rs.has(id));
      }
      if ([...l, ...r].every(v => object(v) && typeof v.id === 'string')) {
        const bm = new Map((Array.isArray(b) ? b : []).map(v => [v.id, v]));
        const lm = new Map(l.map(v => [v.id, v]));
        const rm = new Map(r.map(v => [v.id, v]));
        return [...new Set([...lm.keys(), ...rm.keys(), ...bm.keys()])]
          .map(id => merge(bm.get(id), lm.get(id), rm.get(id), path ? `${path}.${id}` : id))
          .filter(v => v !== undefined);
      }
    }
    if (object(l) && object(r) && (b === undefined || object(b))) {
      const result: Record<string, unknown> = {};
      for (const key of new Set([...Object.keys(l), ...Object.keys(r), ...Object.keys(b ?? {})])) {
        const p = path ? `${path}.${key}` : key;
        if (p.endsWith('.configuration.currentState.lastActivityAt') && typeof l[key] === 'string' && typeof r[key] === 'string') {
          result[key] = [l[key] as string, r[key] as string].sort().at(-1); continue;
        }
        // Same stable id denotes the same entity. Keep the earliest creation
        // timestamp and latest metadata update when importing, not a fake clash.
        if (!base && (key === 'createdAt' || key === 'updatedAt') &&
            typeof l[key] === 'string' && typeof r[key] === 'string') {
          const times = [l[key] as string, r[key] as string].sort();
          result[key] = key === 'createdAt' ? times[0] : times[1]; continue;
        }
        if (!base && key === 'read' && typeof l[key] === 'boolean' && typeof r[key] === 'boolean') {
          result[key] = l[key] || r[key]; continue;
        }
        const value = merge(object(b) ? b[key] : undefined, l[key], r[key], p);
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    return conflict(b, l, r, path);
  }
  const state = merge(base ?? undefined, local, remote, '') as SocialState;
  // A deletion must not silently hide a comment created on another device.
  for (const postId of new Set(state.comments.filter(c => !state.posts.some(p => p.id === c.postId)).map(c => c.postId))) {
    const path = `posts.${postId}`;
    const localPost = local.posts.find(p => p.id === postId);
    const remotePost = remote.posts.find(p => p.id === postId);
    if (resolutions[path] === 'local' && localPost) state.posts.push(localPost);
    else if (resolutions[path] === 'remote' && remotePost) state.posts.push(remotePost);
    else if (resolutions[path]) {
      state.comments = state.comments.filter(c => c.postId !== postId);
      state.notifications = state.notifications.filter(n => n.postId !== postId);
    } else if (!conflicts.some(c => c.path === path)) {
      conflicts.push({ path, local: localPost, remote: remotePost });
    }
  }
  // An unused account may be deleted locally just before another device uses it.
  // Preserve the new history and turn that stale deletion into reversible archive.
  const candidates = new Map([...(base?.characters ?? []), ...local.characters, ...remote.characters].map(c => [c.id, c]));
  for (const [id, character] of candidates) {
    if (state.characters.some(c => c.id === id)) continue;
    const probe = { ...state, characters: [...state.characters, character] };
    if (deletionBlockReason(probe, id)) state.characters.push({ ...character, archived: id !== 'nela' });
  }
  if (!state.characters.some(c => c.id === state.currentCharacterId && !c.archived)) state.currentCharacterId = 'nela';
  // Only this explicitly rotating context index is bounded; source social history
  // and permanent/relationship memories are never trimmed.
  state.characters = state.characters.map(character => {
    const config = character.configuration;
    if (!config || config.memory.recent.length <= config.memory.recentLimit) return character;
    return { ...character, configuration: { ...config, memory: { ...config.memory,
      recent: [...config.memory.recent].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).slice(-config.memory.recentLimit) } } };
  });
  return { state, conflicts };
}
