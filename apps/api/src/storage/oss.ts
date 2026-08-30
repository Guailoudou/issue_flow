import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import type { OssSetting } from "@prisma/client";
import { ApiError } from "../errors";
import { decryptSecret, encryptSecret, requireEncryptionKey } from "../integrations/yunxiao/crypto";

export interface OssClient {
  put(name: string, body: Buffer, options?: { mime?: string }): Promise<unknown>;
  get(name: string): Promise<{ content: Uint8Array | undefined }>;
  getStream(name: string): Promise<{ stream?: unknown }>;
  delete(name: string): Promise<unknown>;
  getBucketInfo(): Promise<unknown>;
}

export interface OssOptions {
  encryptionKey?: string;
  clientFactory?: (options: S3ClientConfig & { bucket: string }) => OssClient;
}

export const DEFAULT_OSS_PREFIX = "issueflow/attachments";

export function publicOssSetting(setting: OssSetting | null) {
  return {
    enabled: setting?.enabled ?? false,
    endpoint: setting?.endpoint ?? "",
    region: setting?.region ?? "us-east-1",
    bucket: setting?.bucket ?? "",
    prefix: setting?.prefix ?? DEFAULT_OSS_PREFIX,
    forcePathStyle: setting?.forcePathStyle ?? false,
    hasAccessKeyId: Boolean(setting?.accessKeyIdEncrypted),
    hasAccessKeySecret: Boolean(setting?.accessKeySecretEncrypted),
    lastTestedAt: setting?.lastTestedAt ?? null,
    lastTestStatus: setting?.lastTestStatus ?? null,
    lastTestMessage: setting?.lastTestMessage ?? null,
    updatedAt: setting?.updatedAt ?? null,
  };
}

function encryptionKey(options: OssOptions) {
  return requireEncryptionKey(options.encryptionKey ?? process.env.YUNXIAO_ENCRYPTION_KEY);
}

export function encryptOssCredential(value: string, options: OssOptions) {
  return encryptSecret(value, encryptionKey(options));
}

export function createOssClient(setting: OssSetting, options: OssOptions = {}) {
  if (!setting.endpoint || !setting.region || !setting.bucket || !setting.accessKeyIdEncrypted || !setting.accessKeySecretEncrypted) {
    throw new ApiError(400, "S3_CONFIGURATION_INCOMPLETE", "S3 endpoint, region, bucket, AccessKey ID and AccessKey Secret are required");
  }
  const key = encryptionKey(options);
  const clientOptions: S3ClientConfig & { bucket: string } = {
    endpoint: setting.endpoint,
    region: setting.region,
    bucket: setting.bucket,
    forcePathStyle: setting.forcePathStyle,
    credentials: {
      accessKeyId: decryptSecret(setting.accessKeyIdEncrypted, key),
      secretAccessKey: decryptSecret(setting.accessKeySecretEncrypted, key),
    },
  };
  if (options.clientFactory) return options.clientFactory(clientOptions);
  const client = new S3Client(clientOptions);
  const adapter: OssClient = {
    put: (name, body, putOptions) => client.send(new PutObjectCommand({ Bucket: setting.bucket, Key: name, Body: body, ContentType: putOptions?.mime })),
    get: async (name) => ({ content: await (await client.send(new GetObjectCommand({ Bucket: setting.bucket, Key: name }))).Body?.transformToByteArray() }),
    getStream: async (name) => ({ stream: (await client.send(new GetObjectCommand({ Bucket: setting.bucket, Key: name }))).Body }),
    delete: (name) => client.send(new DeleteObjectCommand({ Bucket: setting.bucket, Key: name })),
    getBucketInfo: () => client.send(new HeadBucketCommand({ Bucket: setting.bucket })),
  };
  return adapter;
}

export function asOssError(error: unknown, action: string) {
  if (error instanceof ApiError) return error;
  const typed = error as { $metadata?: { httpStatusCode?: number }; status?: number; statusCode?: number; name?: string };
  const status = typed.$metadata?.httpStatusCode ?? typed.status ?? typed.statusCode;
  if (status === 404 || typed.name === "NoSuchKey") return new ApiError(404, "ATTACHMENT_CONTENT_NOT_FOUND", "Attachment content not found");
  return new ApiError(502, "S3_REQUEST_FAILED", `S3 ${action} failed`);
}
