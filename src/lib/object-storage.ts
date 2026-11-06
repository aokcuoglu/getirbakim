import "server-only";
import { S3Client } from "@aws-sdk/client-s3";

// Two setups share this client:
// - MinIO (local development, Contabo VPS): S3_ENDPOINT plus the media user's static S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY.
// - Amazon S3 (AWS Production): no endpoint and no keys. The SDK's default credential chain uses the ECS task role,
//   so no long-lived key exists anywhere. S3_REGION names the buckets' Region.
export function objectStorage() {
  const { S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
  if (S3_ENDPOINT) {
    if (!S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) throw new Error("Object storage is not configured");
    return new S3Client({ endpoint: S3_ENDPOINT, region: S3_REGION || "us-east-1", forcePathStyle: true,
      credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY } });
  }
  if (!S3_REGION) throw new Error("Object storage is not configured");
  return new S3Client({ region: S3_REGION });
}
