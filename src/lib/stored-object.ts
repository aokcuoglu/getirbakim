import { createHash } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

// How the content-addressed media writers check and write an object (#1417): the storefront bundle importer
// (scripts/storefront-bundle-media.ts) and storeProductImageBytes (src/modules/enrichment/import.ts, behind admin uploads,
// enrichment workers and the image scripts). An object counts as stored when its size and sha256 metadata match (one HEAD).
// A write sends that sha256 as ChecksumSHA256: the store hashes the bytes it receives and refuses the PUT on a mismatch, so a
// PUT it acknowledges needs no read-back. A store that does not echo the checksum (one that ignores the header) gets the
// object read back whole instead, as every write was before. Neither path notices an object whose size and metadata are
// right but whose bytes were changed later.

export type ObjectStore = Pick<S3Client, "send">;
/** An object that must hold the bytes whose sha256 (lowercase hex) is `sha256`. */
export type StoredObject = { bucket: string; key: string; sha256: string; contentType: string };

// The error names a store gives a PUT whose bytes do not match its x-amz-checksum-sha256: Amazon S3 BadDigest, MinIO
// XAmzContentChecksumMismatch (local smoke test, 2026-11-26). The SDK also signs the payload hash (x-amz-content-sha256),
// so S3 may name bytes changed in transit XAmzContentSHA256Mismatch instead.
const CHECKSUM_MISMATCH = new Set(["BadDigest", "XAmzContentChecksumMismatch", "XAmzContentSHA256Mismatch"]);
const SHA256_HEX = /^[0-9a-f]{64}$/;
let warnedUnacknowledged = false;

const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const integrityFailed = (object: StoredObject, cause?: unknown) =>
  new Error(`Stored media integrity failed: ${object.key}`, cause === undefined ? undefined : { cause });

/** True when the object exists with `size` bytes and its sha256 metadata; a missing object (HEAD 404 or 403) is false. */
export async function objectIsStored(storage: ObjectStore, object: Pick<StoredObject, "bucket" | "key" | "sha256">, size: number) {
  const head = await storage.send(new HeadObjectCommand({ Bucket: object.bucket, Key: object.key })).catch((error: unknown) => {
    // Without s3:ListBucket, S3 answers 403 for a missing key as well; a real permission problem fails at the PUT that follows.
    const status = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
    if (status === 404 || status === 403) return null;
    throw error;
  });
  return head?.ContentLength === size && head.Metadata?.sha256 === object.sha256;
}

/**
 * Writes `bytes` with their type and sha256 metadata and makes sure the store holds exactly them: "acknowledged" when the
 * store echoed the checksum it validated, "read-back" when it did not and the object was read back whole. The checksum is
 * the expected `sha256`, not a hash of `bytes`, so bytes that differ from it are refused as well. Throws
 * "Stored media integrity failed: <key>" when the store refuses the checksum or reads back other bytes.
 */
export async function putVerifiedObject(storage: ObjectStore, object: StoredObject, bytes: Uint8Array): Promise<"acknowledged" | "read-back"> {
  if (!SHA256_HEX.test(object.sha256)) throw new Error(`Invalid sha256 for ${object.key}: ${object.sha256}`);
  const location = { Bucket: object.bucket, Key: object.key };
  const checksum = Buffer.from(object.sha256, "hex").toString("base64");
  const response = await storage.send(new PutObjectCommand({ ...location, Body: bytes, ContentType: object.contentType,
    Metadata: { sha256: object.sha256 }, ChecksumSHA256: checksum })).catch((error: unknown) => {
    const name = (error as { name?: unknown } | null)?.name;
    throw typeof name === "string" && CHECKSUM_MISMATCH.has(name) ? integrityFailed(object, error) : error;
  });
  if (response.ChecksumSHA256 === checksum) return "acknowledged";
  if (!warnedUnacknowledged) {
    warnedUnacknowledged = true;
    console.warn(`The object store did not acknowledge ChecksumSHA256 (bucket ${object.bucket}); written objects are read back instead (#1417)`);
  }
  const saved = await (await storage.send(new GetObjectCommand(location))).Body?.transformToByteArray();
  if (!saved || sha256Hex(saved) !== object.sha256) throw integrityFailed(object);
  return "read-back";
}
