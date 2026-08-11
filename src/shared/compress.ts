export async function gzipCompress(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") return data;
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gzipDecompress(data: Uint8Array): Promise<Uint8Array> {
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return data;
}

export async function maybeCompress(data: Uint8Array): Promise<{ bytes: Uint8Array; gzipped: boolean }> {
  const gz = await gzipCompress(data);
  if (gz.length < data.length * 0.95) return { bytes: gz, gzipped: true };
  return { bytes: data, gzipped: false };
}
