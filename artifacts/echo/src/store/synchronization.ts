import { SCHEMA_VERSION, type SocialState } from '../domain/types';
import { upgradeAccounts } from '../domain/accounts';
import { mergeUniverse, same, type MergeConflict, type Resolutions } from './merge';
import {
  loadUniverse, saveUniverse, RevisionConflict, loadRecovery, saveRecovery,
  loadLegacyState, fingerprint, importedBy, markImported, cacheMigration,
  cachedMigration, moveLocalImagesToPrivateStorage, verifySavedUniverse,
  claimLegacy, legacyOwner,
} from './persistence';

const defaultIO = {
  loadUniverse, saveUniverse, loadRecovery, saveRecovery, loadLegacyState,
  fingerprint, importedBy, markImported, cacheMigration, cachedMigration,
  moveLocalImagesToPrivateStorage, verifySavedUniverse,
  claimLegacy, legacyOwner,
};

export interface SyncView {
  state: SocialState | null;
  error: string | null;
  busy: boolean;
  lastSavedAt: number | null;
  conflicts: MergeConflict[];
  legacyAvailable: boolean;
  importVerified: boolean;
  importing: boolean;
}

/** One coordinator per authenticated owner/session. All writes are serialized. */
export class UniverseSync {
  view: SyncView = {
    state: null, error: null, busy: false, lastSavedAt: null,
    conflicts: [], legacyAvailable: false, importVerified: false, importing: false,
  };
  private base: SocialState | null = null;
  private generation = 0;
  private running: Promise<void> | null = null;
  private disk: Promise<void> = Promise.resolve();
  private stopped = false;
  private importHash: string | null = null;
  private decisions: Resolutions = {};
  private conflictRemote: SocialState | null = null;
  private preparingImport = false;

  constructor(
    private owner: string, private seed: () => SocialState,
    private publish: (view: SyncView) => void,
    private io = defaultIO,
  ) {}

  private emit() { if (!this.stopped) this.publish({ ...this.view }); }
  stop() { this.stopped = true; }
  private backup() {
    if (!this.view.state) return this.disk;
    const recovery = structuredClone({ base: this.base, state: this.view.state });
    this.disk = this.disk.catch(() => undefined).then(() => this.io.saveRecovery(this.owner, recovery));
    return this.disk;
  }
  async initialize() {
    this.view.busy = true; this.view.error = null; this.emit();
    try {
      const [remote, recovery, legacy] = await Promise.all([
        this.io.loadUniverse(), this.io.loadRecovery(this.owner), this.io.loadLegacyState(),
      ]);
      if (this.stopped) return;
      if (legacy) {
        const hash = await this.io.fingerprint(legacy);
        const claimedBy = await this.io.legacyOwner(hash);
        this.view.legacyAvailable = (!claimedBy || claimedBy === this.owner) && !await this.io.importedBy(this.owner, hash);
      }
      this.base = recovery && !same(recovery.base, recovery.state) ? recovery.base : remote.state;
      this.view.state = recovery && !same(recovery.base, recovery.state)
        ? recovery.state : remote.state ?? this.seed();
      this.view.state = upgradeAccounts(this.view.state);
      await this.backup();
    } catch (e) { this.view.error = (e as Error).message; }
    finally { this.view.busy = false; this.emit(); }
    if (this.view.state) await this.sync();
  }
  edit(update: (state: SocialState) => SocialState) {
    if (!this.view.state || this.view.conflicts.length || this.importHash || this.preparingImport) return;
    this.view.state = update(this.view.state);
    this.generation++;
    // Persist the pending change even when network requests fail.
    void this.backup().catch(e => {
      this.view.error = `No se pudo conservar la copia de recuperación: ${e.message}`; this.emit();
    });
    this.emit();
  }
  async importLegacy() {
    if (this.preparingImport || this.importHash) return;
    await this.sync();
    if (this.view.conflicts.length || this.view.error) return;
    if (this.running) await this.running;
    const legacy = await this.io.loadLegacyState();
    if (!legacy) return;
    if (legacy.version !== SCHEMA_VERSION) {
      this.view.error = 'La versión de los datos locales no es compatible. El original sigue intacto.'; this.emit(); return;
    }
    const hash = await this.io.fingerprint(legacy);
    if (await this.io.importedBy(this.owner, hash)) {
      this.view.legacyAvailable = false; this.view.importVerified = true; this.emit(); return;
    }
    this.view.busy = true; this.view.error = null; this.emit();
    this.preparingImport = true; this.view.importing = true; this.emit();
    try {
      await this.io.claimLegacy(this.owner, hash);
      // Cache converted refs so retries reuse uploads, including after reload.
      const converted = await this.io.cachedMigration(this.owner, hash) ??
        await this.io.moveLocalImagesToPrivateStorage(legacy);
      await this.io.cacheMigration(this.owner, hash, converted);
      this.importHash = hash;
      this.base = null; // explicit union of old and remote content by stable id
      this.view.state = converted;
      this.generation++;
      await this.backup();
    } catch (e) { this.view.error = (e as Error).message; }
    finally { this.preparingImport = false; this.view.busy = false; this.view.importing = false; this.emit(); }
    if (this.importHash) await this.sync();
  }
  resolve(decisions: Resolutions) {
    this.decisions = decisions;
    this.view.conflicts = [];
    void this.sync();
  }
  async sync() {
    if (this.stopped || !this.view.state || this.preparingImport) return;
    if (this.running) return this.running;
    this.running = this.perform().finally(() => { this.running = null; });
    return this.running;
  }
  private async perform() {
    this.view.busy = true; this.view.error = null; this.emit();
    try {
      await this.disk;
      for (let attempt = 0; attempt < 5; attempt++) {
        const remote = await this.io.loadUniverse();
        if (this.stopped) return;
        // Resolutions apply only to the exact remote version the user reviewed.
        if (Object.keys(this.decisions).length && !same(remote.state, this.conflictRemote)) {
          this.decisions = {};
        }
        const draft = this.view.state!;
        const generation = this.generation;
        const merged = mergeUniverse(this.base, draft, remote.state, this.decisions);
        if (merged.conflicts.length) {
          this.view.conflicts = merged.conflicts;
          this.conflictRemote = remote.state;
          await this.backup();
          return;
        }
        const privateState = await this.io.moveLocalImagesToPrivateStorage(merged.state);
        if (this.stopped) return;
        let saved = remote;
        try {
          // An idle device must not fight another device's active-character UI
          // choice. A real local switch is still saved as part of a local edit.
          const contentOnly = (s: SocialState | null) => s && { ...s, currentCharacterId: 'nela' };
          const identityChangedLocally = this.base?.currentCharacterId !== draft.currentCharacterId;
          if (!same(contentOnly(privateState), contentOnly(remote.state)) || identityChangedLocally)
            saved = await this.io.saveUniverse(privateState, remote.revision);
        } catch (e) {
          if (e instanceof RevisionConflict) { this.decisions = {}; continue; }
          throw e;
        }
        if (this.stopped || !saved.state) return;
        // Do not drop edits made while the network request was in flight.
        const next = this.generation === generation
          ? { state: saved.state, conflicts: [] }
          : mergeUniverse(draft, this.view.state!, saved.state);
        const activeId = this.view.state!.currentCharacterId;
        const active = next.state.characters.some(c => c.id === activeId && !c.archived) ? activeId : 'nela';
        this.base = structuredClone(saved.state);
        this.base.currentCharacterId = active;
        next.state = structuredClone(next.state);
        next.state.currentCharacterId = active;
        this.view.state = same(this.view.state, next.state) ? this.view.state : next.state;
        this.view.conflicts = next.conflicts;
        this.conflictRemote = saved.state;
        this.decisions = {};
        await this.backup();
        if (this.importHash) {
          await this.io.verifySavedUniverse(saved.state);
          await this.io.markImported(this.owner, this.importHash);
          this.importHash = null;
          this.view.legacyAvailable = false;
          this.view.importVerified = true;
        }
        this.view.lastSavedAt = Date.now();
        return;
      }
      throw new Error('Hay cambios simultáneos continuos. Tus cambios están conservados en este dispositivo; reintenta.');
    } catch (e) {
      this.view.error = (e as Error).message;
      // Verification can be retried from the retained legacy copy; don't leave
      // the UI accepting clicks that would be silently blocked.
      this.importHash = null;
    }
    finally { this.view.busy = false; this.emit(); }
  }
}
