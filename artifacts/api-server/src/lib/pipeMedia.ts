import type { ServerResponse } from 'node:http';
import type { Readable } from 'node:stream';

/** One native stream per request. Remove only our listeners, including on abort. */
export function pipeMedia(source: NodeJS.ReadableStream, destination: ServerResponse, onError: (error: Error) => void) {
  const stream = source as Readable;
  const cleanup = () => {
    stream.off('error', fail);
    destination.off('close', close);
    destination.off('finish', finish);
    destination.off('error', fail);
  };
  const close = () => {
    // Keep the error handler through destruction; never leave an unhandled
    // late SDK error after a player cancels a range request.
    stream.unpipe(destination);
    stream.once('close', cleanup);
    stream.destroy();
    if (stream.closed) cleanup();
  };
  const finish = () => { cleanup(); };
  const fail = (error: Error) => {
    onError(error);
    stream.unpipe(destination);
    stream.once('close', cleanup);
    stream.destroy();
    destination.destroy();
    if (stream.closed) cleanup();
  };
  stream.once('error', fail);
  destination.once('close', close);
  destination.once('finish', finish);
  destination.once('error', fail);
  stream.pipe(destination);
}
