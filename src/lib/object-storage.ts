import "server-only";
import { S3Client } from "@aws-sdk/client-s3";

export function objectStorage() {
  const { S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
  if (!S3_ENDPOINT || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) throw new Error("Object storage is not configured");
  return new S3Client({ endpoint: S3_ENDPOINT, region: S3_REGION || "us-east-1", forcePathStyle: true,
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY } });
}
