import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { pipeMedia } from '../src/lib/pipeMedia';

test('stream nativo: bytes intactos, backpressure y limpieza al finalizar/cancelar', async () => {
  const bytes = Buffer.alloc(512 * 1024, 0x5a);
  const sources: Readable[] = [];
  const errors: Error[] = [];
  const warnings: Error[] = [];
  const onWarning = (warning: Error) => { if (warning.name === 'MaxListenersExceededWarning') warnings.push(warning); };
  process.on('warning', onWarning);
  const server = createServer((_req, res) => {
    // Produce gradually so cancellation really interrupts an in-flight body.
    const source = Readable.from((async function* () {
      for (let n = 0; n < bytes.length; n += 4096) {
        await new Promise(resolve => setTimeout(resolve, 1));
        yield bytes.subarray(n, n + 4096);
      }
    })());
    sources.push(source);
    res.setHeader('Content-Length', bytes.length);
    pipeMedia(source, res, error => errors.push(error));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  try {
    for (let n = 0; n < 15; n++) {
      const response = await fetch(`http://127.0.0.1:${address.port}/media`);
      if (n % 2) {
        const reader = response.body!.getReader();
        await reader.read();
        await reader.cancel();
      } else {
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(warnings.length, 0);
    assert.equal(errors.length, 0);
    for (const source of sources) {
      assert.equal(source.destroyed, true);
      assert.ok(source.listenerCount('error') <= 1, 'no custom error listeners retained');
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    process.off('warning', onWarning);
  }
});

test('fallo de la fuente destruye la respuesta y se informa una sola vez', async () => {
  let failures = 0;
  const server = createServer((_req, res) => {
    const source = new Readable({ read() { this.destroy(new Error('fixture stream failure')); } });
    pipeMedia(source, res, () => failures++);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  try {
    await assert.rejects(fetch(`http://127.0.0.1:${address.port}/media`));
    assert.equal(failures, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
