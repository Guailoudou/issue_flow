import { randomUUID } from "node:crypto";
import type { OssSetting } from "@prisma/client";
import { ApiError } from "../errors";
import { decryptSecret, encryptSecret, requireEncryptionKey } from "../integrations/yunxiao/crypto";

export interface WebDavOptions {
  encryptionKey?: string;
  fetchImpl?: typeof fetch;
}

function encryptionKey(options: WebDavOptions) {
  return requireEncryptionKey(options.encryptionKey ?? process.env.YUNXIAO_ENCRYPTION_KEY);
}

export function encryptWebDavCredential(value: string, options: WebDavOptions) {
  return encryptSecret(value, encryptionKey(options));
}

function encodePath(value: string) {
  return value.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

export function createWebDavClient(setting: OssSetting, options: WebDavOptions = {}) {
  if (!setting.webdavUrl || !setting.webdavPath || !setting.webdavUsernameEncrypted || !setting.webdavPasswordEncrypted) {
    throw new ApiError(400, "WEBDAV_CONFIGURATION_INCOMPLETE", "WebDAV URL, path, username and password are required");
  }
  const key = encryptionKey(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const authorization = `Basic ${Buffer.from(`${decryptSecret(setting.webdavUsernameEncrypted, key)}:${decryptSecret(setting.webdavPasswordEncrypted, key)}`).toString("base64")}`;
  const baseUrl = setting.webdavUrl.replace(/\/+$/, "");
  const headers = { Authorization: authorization };
  const url = (name: string) => `${baseUrl}/${encodePath(name)}`;
  const ensureCollections = async () => {
    let current = baseUrl;
    for (const part of setting.webdavPath.split("/").filter(Boolean)) {
      current += `/${encodeURIComponent(part)}`;
      const response = await fetchImpl(current, { method: "MKCOL", headers });
      if (![200, 201, 204, 405].includes(response.status)) throw new ApiError(502, "WEBDAV_REQUEST_FAILED", `WebDAV directory creation failed (${response.status})`);
    }
  };
  return {
    async put(name: string, body: Buffer, mime?: string) {
      await ensureCollections();
      const response = await fetchImpl(url(name), { method: "PUT", headers: { ...headers, "Content-Type": mime || "application/octet-stream" }, body: new Uint8Array(body) });
      if (!response.ok) throw new ApiError(502, "WEBDAV_REQUEST_FAILED", `WebDAV upload failed (${response.status})`);
    },
    async get(name: string) {
      const response = await fetchImpl(url(name), { headers });
      if (response.status === 404) throw new ApiError(404, "ATTACHMENT_CONTENT_NOT_FOUND", "Attachment content not found");
      if (!response.ok) throw new ApiError(502, "WEBDAV_REQUEST_FAILED", `WebDAV download failed (${response.status})`);
      return Buffer.from(await response.arrayBuffer());
    },
    async delete(name: string) {
      const response = await fetchImpl(url(name), { method: "DELETE", headers });
      if (!response.ok && response.status !== 404) throw new ApiError(502, "WEBDAV_REQUEST_FAILED", `WebDAV deletion failed (${response.status})`);
    },
    async test() {
      const name = `${setting.webdavPath}/.issueflow-test-${randomUUID()}`;
      await this.put(name, Buffer.from("IssueFlow WebDAV connection test"));
      await this.delete(name);
    },
  };
}

export function asWebDavError(error: unknown, action: string) {
  if (error instanceof ApiError) return error;
  return new ApiError(502, "WEBDAV_REQUEST_FAILED", `WebDAV ${action} failed`);
}
