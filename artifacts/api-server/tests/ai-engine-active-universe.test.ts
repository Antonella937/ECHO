import test, { after } from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";
import {
  db,
  pool,
  echoUniversesTable,
} from "@workspace/db";
import {
  PreviewCharacterDecisionBody,
  SaveUniverseBody,
  type SocialState,
} from "@workspace/api-zod";
import { createSeedState } from "../../echo/src/store/seed";
import { defaultCharacterConfig } from "../../echo/src/domain/character-core";
import { previewForOwner } from "../src/ai-engine/service";
import { readUniverse } from "../src/lib/universeRepository";
import { createBrainPreviewRouter } from "../src/routes/brain-preview";
import type { TextProvider } from "../src/ai-engine/contracts";

const repositoryOwners = [
  `brain-universe-repo-test-${crypto.randomUUID()}`,
  `brain-universe-repo-test-${crypto.randomUUID()}`,
];
const previewOwners = [
  `brain-universe-preview-test-${crypto.randomUUID()}`,
  `brain-universe-preview-test-${crypto.randomUUID()}`,
];
const owners = [...repositoryOwners, ...previewOwners];

after(async () => {
  await db.delete(echoUniversesTable).where(inArray(echoUniversesTable.ownerId, owners));
  await pool.end();
});

function stateWithMarker(marker: string): SocialState {
  const state = createSeedState();
  state.currentCharacterId = "noah";
  const mar = state.characters.find((character) => character.id === "mar")!;
  const configuration = defaultCharacterConfig(mar);
  configuration.personality.description = `PERSONALITY_${marker}`;
  configuration.memory.permanent = [{
    id: `memory-${marker}`,
    text: `PERMANENT_MEMORY_${marker}`,
    targetId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    kind: "manual",
    sourceId: null,
    promotedTo: null,
  }];
  configuration.memory.recentSummary = `RECENT_MEMORY_${marker}`;
  mar.configuration = configuration;

  state.posts = state.posts.slice(0, 1);
  state.posts[0]!.id = `post-${marker}`;
  state.posts[0]!.authorId = mar.id;
  state.posts[0]!.caption = `SOCIAL_CONTEXT_${marker}`;
  return SaveUniverseBody.parse({ state, expectedRevision: 1 }).state;
}

async function insertUniverse(ownerId: string, universeId: string, revision: number, state: SocialState) {
  await db.insert(echoUniversesTable).values({
    ownerId,
    universeId,
    revision,
    state: state as unknown as Record<string, unknown>,
    updatedAt: new Date(),
  });
}

const provider: TextProvider = {
  name: "synthetic-only-no-provider-call",
  complete: async ({ context }) => {
    const parsed = JSON.parse(context) as { situation: string };
    return {
      model: "synthetic:test",
      text: JSON.stringify({
        action: "none",
        situation: parsed.situation,
        text: null,
        reason: "Prueba sintética de selección de universo.",
        suggestedDelayMinutes: 0,
        contextSections: ["identity", "personality", "memory", "recentSocial"],
      }),
    };
  },
};

test("el repositorio selecciona owner + universo y usa primary si no se especifica", async () => {
  const primaryA = stateWithMarker("OWNER_A_PRIMARY");
  const studioA = stateWithMarker("OWNER_A_STUDIO");
  const primaryB = stateWithMarker("OWNER_B_PRIMARY");

  await insertUniverse(repositoryOwners[0]!, "primary", 3, primaryA);
  await insertUniverse(repositoryOwners[0]!, "studio", 8, studioA);
  await insertUniverse(repositoryOwners[1]!, "primary", 12, primaryB);

  assert.equal((await readUniverse(repositoryOwners[0]!)).revision, 3);
  assert.equal(
    ((await readUniverse(repositoryOwners[0]!, "primary")).state as unknown as SocialState).characters.find((c) => c.id === "mar")!
      .configuration!.personality.description,
    "PERSONALITY_OWNER_A_PRIMARY",
  );
  assert.equal(
    ((await readUniverse(repositoryOwners[0]!, "studio")).state as unknown as SocialState).characters.find((c) => c.id === "mar")!
      .configuration!.personality.description,
    "PERSONALITY_OWNER_A_STUDIO",
  );
  assert.equal(
    ((await readUniverse(repositoryOwners[1]!, "primary")).state as unknown as SocialState).characters.find((c) => c.id === "mar")!
      .configuration!.personality.description,
    "PERSONALITY_OWNER_B_PRIMARY",
  );
  assert.equal((await readUniverse(repositoryOwners[1]!, "studio")).state, null);
  assert.equal((await readUniverse(repositoryOwners[0]!, "missing-universe")).state, null);
});

test("Brain preview usa el universo solicitado para personalidad, memoria y contexto social", async () => {
  const primary = stateWithMarker("OWNER_A_PRIMARY");
  const studio = stateWithMarker("OWNER_A_STUDIO");
  const otherOwner = stateWithMarker("OWNER_B_PRIMARY");

  await insertUniverse(previewOwners[0]!, "primary", 3, primary);
  await insertUniverse(previewOwners[0]!, "studio", 8, studio);
  await insertUniverse(previewOwners[1]!, "primary", 12, otherOwner);

  const capturedContexts: string[] = [];
  const testProvider: TextProvider = {
    ...provider,
    complete: async (input) => {
      capturedContexts.push(input.context);
      return provider.complete(input);
    },
  };

  const selected = await previewForOwner(previewOwners[0]!, {
    characterId: "mar",
    situation: "post",
    universeId: "studio",
  }, { read: readUniverse, provider: testProvider });
  const selectedContext = JSON.parse(capturedContexts.at(-1)!) as {
    personality: { description: string };
    memory: { permanent: Array<{ text: string }>; recentSummary: string };
    recentSocial: { posts: Array<{ caption: string }> };
  };
  assert.equal(selected.sourceRevision, 8);
  assert.equal(selectedContext.personality.description, "PERSONALITY_OWNER_A_STUDIO");
  assert.equal(selectedContext.memory.permanent[0]?.text, "PERMANENT_MEMORY_OWNER_A_STUDIO");
  assert.equal(selectedContext.memory.recentSummary, "RECENT_MEMORY_OWNER_A_STUDIO");
  assert.equal(selectedContext.recentSocial.posts[0]?.caption, "SOCIAL_CONTEXT_OWNER_A_STUDIO");
  assert.equal(capturedContexts.at(-1)!.includes("OWNER_A_PRIMARY"), false);
  assert.equal(capturedContexts.at(-1)!.includes("OWNER_B_PRIMARY"), false);

  const otherOwnerPreview = await previewForOwner(previewOwners[1]!, {
    characterId: "mar",
    situation: "post",
    universeId: "primary",
  }, { read: readUniverse, provider: testProvider });
  const otherOwnerContext = JSON.parse(capturedContexts.at(-1)!) as {
    memory: { permanent: Array<{ text: string }> };
    recentSocial: { posts: Array<{ caption: string }> };
  };
  assert.equal(otherOwnerPreview.sourceRevision, 12);
  assert.equal(otherOwnerContext.memory.permanent[0]?.text, "PERMANENT_MEMORY_OWNER_B_PRIMARY");
  assert.equal(otherOwnerContext.recentSocial.posts[0]?.caption, "SOCIAL_CONTEXT_OWNER_B_PRIMARY");
  assert.equal(capturedContexts.at(-1)!.includes("OWNER_A_STUDIO"), false);

  const fallback = await previewForOwner(previewOwners[0]!, {
    characterId: "mar",
    situation: "post",
  }, { read: readUniverse, provider: testProvider });
  const fallbackContext = JSON.parse(capturedContexts.at(-1)!) as {
    memory: { permanent: Array<{ text: string }> };
  };
  assert.equal(fallback.sourceRevision, 3);
  assert.equal(fallbackContext.memory.permanent[0]?.text, "PERMANENT_MEMORY_OWNER_A_PRIMARY");

  let providerCalls = 0;
  const noCallProvider: TextProvider = {
    ...provider,
    complete: async (input) => {
      providerCalls += 1;
      return provider.complete(input);
    },
  };
  await assert.rejects(previewForOwner(previewOwners[1]!, {
    characterId: "mar",
    situation: "post",
    universeId: "studio",
  }, { read: readUniverse, provider: noCallProvider }), /UNIVERSE_NOT_FOUND/);
  assert.equal(providerCalls, 0, "an absent universe under this owner must fail before provider use");
});

test("la ruta HTTP autenticada propaga universo, memoria y aislamiento de propietario", async () => {
  const routeContexts: string[] = [];
  let providerCalls = 0;
  const routeProvider: TextProvider = {
    ...provider,
    complete: async (input) => {
      providerCalls += 1;
      routeContexts.push(input.context);
      return provider.complete(input);
    },
  };

  async function postPreview(ownerId: string, body: Record<string, unknown>) {
    const app = express();
    app.use(express.json());
    const authenticate: RequestHandler = (req, _res, next) => {
      req.userId = ownerId;
      next();
    };
    app.use(createBrainPreviewRouter({
      authenticate,
      read: readUniverse,
      providerForOwner: () => routeProvider,
      visionForOwner: async () => ({ analyses: {}, postSummaries: {} }),
    }));
    const server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/ai-engine/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  }

  const selected = await postPreview(previewOwners[0]!, {
    characterId: "mar",
    situation: "post",
    universeId: "studio",
  });
  assert.equal(selected.status, 200);
  assert.equal(selected.body.sourceRevision, 8);
  const selectedContext = JSON.parse(routeContexts.at(-1)!) as {
    memory: { permanent: Array<{ text: string }> };
    recentSocial: { posts: Array<{ caption: string }> };
  };
  assert.equal(selectedContext.memory.permanent[0]?.text, "PERMANENT_MEMORY_OWNER_A_STUDIO");
  assert.equal(selectedContext.recentSocial.posts[0]?.caption, "SOCIAL_CONTEXT_OWNER_A_STUDIO");

  const fallback = await postPreview(previewOwners[0]!, {
    characterId: "mar",
    situation: "post",
  });
  assert.equal(fallback.status, 200);
  assert.equal(fallback.body.sourceRevision, 3);
  const fallbackContext = JSON.parse(routeContexts.at(-1)!) as {
    memory: { permanent: Array<{ text: string }> };
  };
  assert.equal(fallbackContext.memory.permanent[0]?.text, "PERMANENT_MEMORY_OWNER_A_PRIMARY");

  const otherOwner = await postPreview(previewOwners[1]!, {
    characterId: "mar",
    situation: "post",
    universeId: "primary",
  });
  assert.equal(otherOwner.status, 200);
  const otherOwnerContext = JSON.parse(routeContexts.at(-1)!) as {
    memory: { permanent: Array<{ text: string }> };
  };
  assert.equal(otherOwnerContext.memory.permanent[0]?.text, "PERMANENT_MEMORY_OWNER_B_PRIMARY");
  assert.equal(routeContexts.at(-1)!.includes("OWNER_A_STUDIO"), false);

  const callsBeforeForeignUniverse = providerCalls;
  const foreignUniverse = await postPreview(previewOwners[1]!, {
    characterId: "mar",
    situation: "post",
    universeId: "studio",
  });
  assert.equal(foreignUniverse.status, 404);
  assert.equal(foreignUniverse.body.error, "UNIVERSE_NOT_FOUND");
  assert.equal(providerCalls, callsBeforeForeignUniverse);
});

test("el contrato de Brain permite universeId opcional sin aceptar campos no relacionados", () => {
  assert.equal(PreviewCharacterDecisionBody.strict().safeParse({
    characterId: "mar",
    situation: "post",
    universeId: "studio",
  }).success, true);
  assert.equal(PreviewCharacterDecisionBody.strict().safeParse({
    characterId: "mar",
    situation: "post",
    universeId: "studio",
    ownerId: "must-not-be-client-controlled",
  }).success, false);
});
