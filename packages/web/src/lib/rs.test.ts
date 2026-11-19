import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock URL.createObjectURL. Capture the Blob passed in so tests can assert
// on its type — module file reads build a fresh Blob with a
// clean MIME type.
let blobUrlCounter = 0;
let lastCreatedBlob: Blob | null = null;
vi.stubGlobal('URL', {
  ...globalThis.URL,
  createObjectURL: (blob: Blob) => {
    lastCreatedBlob = blob;
    return `blob:test/${blobUrlCounter++}`;
  },
  revokeObjectURL: vi.fn(),
});

import { recoverLegacyBinaryStringEncoding } from '@inbox-rs/rs-module';
import { fetchProviderFileBlobUrl } from './rs';

/**
 * Encode bytes the way the v1.8-and-earlier upload path did:
 * `String.fromCharCode(byte)` per byte to make a binary string, then UTF-8
 * encode that string (which is what `fetch(..., { body: string })` does).
 */
function legacyEncodeBytes(bytes: Uint8Array): Uint8Array {
  let binaryString = '';
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return new TextEncoder().encode(binaryString);
}

beforeEach(() => {
  mockFetch.mockClear();
  lastCreatedBlob = null;
});

describe('recoverLegacyBinaryStringEncoding', () => {
  it('returns raw binary unchanged when the bytes are not valid UTF-8', () => {
    // Lone 0xFF is never a valid UTF-8 lead byte → TextDecoder({fatal}) throws.
    const raw = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
    ]);
    const result = recoverLegacyBinaryStringEncoding(raw.buffer.slice(0));
    expect(new Uint8Array(result)).toEqual(raw);
  });

  it('recovers the original JPEG bytes from the legacy UTF-8-encoded form', () => {
    const original = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
    ]);
    const corrupted = legacyEncodeBytes(original);
    const result = recoverLegacyBinaryStringEncoding(
      corrupted.buffer.slice(
        corrupted.byteOffset,
        corrupted.byteOffset + corrupted.byteLength,
      ),
    );
    expect(new Uint8Array(result)).toEqual(original);
  });

  it('recovers the original PNG bytes from the legacy UTF-8-encoded form', () => {
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    const original = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    const corrupted = legacyEncodeBytes(original);
    const result = recoverLegacyBinaryStringEncoding(
      corrupted.buffer.slice(
        corrupted.byteOffset,
        corrupted.byteOffset + corrupted.byteLength,
      ),
    );
    expect(new Uint8Array(result)).toEqual(original);
  });

  it('handles an empty buffer', () => {
    const result = recoverLegacyBinaryStringEncoding(new ArrayBuffer(0));
    expect(result.byteLength).toBe(0);
  });

  it('passes through pure ASCII unchanged (decoding gives same bytes back)', () => {
    // Pure ASCII is valid UTF-8 with all chars < 256 — the helper would
    // "recover" it, but the recovered bytes are identical to the input
    // because each ASCII byte UTF-8-encodes to itself.
    const ascii = new TextEncoder().encode('Hello, world!');
    const result = recoverLegacyBinaryStringEncoding(
      ascii.buffer.slice(ascii.byteOffset, ascii.byteOffset + ascii.byteLength),
    );
    expect(new Uint8Array(result)).toEqual(ascii);
  });

  it('does not touch real UTF-8 text containing non-Latin1 chars', () => {
    // "héllo 世界" — 世 has code point 0x4E16 which is >= 256, so the
    // recovery bails out and returns the bytes untouched.
    const text = new TextEncoder().encode('héllo 世界');
    const result = recoverLegacyBinaryStringEncoding(
      text.buffer.slice(text.byteOffset, text.byteOffset + text.byteLength),
    );
    expect(new Uint8Array(result)).toEqual(text);
  });

  it('round-trips: encode → recover gives back the original for a 256-byte sweep', () => {
    // Cover every possible byte value 0–255. This is the strongest possible
    // test of the inverse property because it exercises the full domain.
    const original = new Uint8Array(256);
    for (let i = 0; i < 256; i++) original[i] = i;
    const corrupted = legacyEncodeBytes(original);
    const result = recoverLegacyBinaryStringEncoding(
      corrupted.buffer.slice(
        corrupted.byteOffset,
        corrupted.byteOffset + corrupted.byteLength,
      ),
    );
    expect(new Uint8Array(result)).toEqual(original);
  });
});

describe('provider file reads', () => {
  it('reads through the provider client without forwarding tokens to an RS URL', async () => {
    mockFetch.mockClear();
    const bytes = new Uint8Array([0, 128, 255]).buffer;
    const client = {
      getFile: vi.fn().mockResolvedValue({
        data: bytes,
        mimeType: 'image/png; charset=binary',
      }),
    };
    const url = await fetchProviderFileBlobUrl(client, 'files/example.png');
    expect(client.getFile).toHaveBeenCalledWith('files/example.png');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(url).toMatch(/^blob:test\//);
    expect(lastCreatedBlob?.type).toBe('image/png');
    expect(lastCreatedBlob?.size).toBe(3);
  });

  it('returns no URL for missing provider files or provider failures', async () => {
    expect(
      await fetchProviderFileBlobUrl(
        { getFile: vi.fn().mockResolvedValue(undefined) },
        'missing',
      ),
    ).toBeNull();
    expect(
      await fetchProviderFileBlobUrl(
        { getFile: vi.fn().mockRejectedValue(new Error('offline')) },
        'missing',
      ),
    ).toBeNull();
  });
});
