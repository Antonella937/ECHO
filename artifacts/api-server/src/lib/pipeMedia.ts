import type { ServerResponse } from 'node:http';
import type { Readable } from 'node:stream';

/** Never let a late upstream timeout crash the process after a client disconnects. */
export function pipeMedia(source: NodeJS.ReadableStream, destination: ServerResponse, onError: (error: Error) => void) {
  const stream = source as Readable;
  let settled = false;
  const upstreamError = (error: Error) => {
    // Keep this listener until the upstream stream actually closes. Some SDKs
    // emit an AbortSignal timeout after the HTTP response has already closed.
    if (settled) return;
    settled = true;
    onError(error);
    stream.unpipe(destination);
    if (!destination.destroyed) destination.destroy();
    stream.destroy();
  };
  const upstreamClose = () => {
    stream.off('error', upstreamError);
    destination.off('close', clientClose);
    destination.off('finish', finished);
    destination.off('error', destinationError);
  };
  const clientClose = () => {
    settled = true;
    stream.unpipe(destination);
    if (!stream.destroyed) stream.destroy();
  };
  const finished = () => {
    settled = true;
    // Do not detach the upstream error handler yet: a delayed abort can fire
    // before the upstream's own close event.
    if (!stream.destroyed) stream.destroy();
  };
  const destinationError = (error: Error) => {
    if (!settled) onError(error);
    clientClose();
  };
  stream.on('error', upstreamError);
  stream.once('close', upstreamClose);
  destination.once('close', clientClose);
  destination.once('finish', finished);
  destination.once('error', destinationError);
  stream.pipe(destination);
}
