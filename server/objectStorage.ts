import { randomUUID } from "crypto";
import { Response } from "express";
import { Storage, File } from "@google-cloud/storage";
import {
  canAccessObject,
  getObjectAclPolicy,
  ObjectPermission,
  setObjectAclPolicy,
} from "./objectAcl";

const bucketName =
  process.env.GCS_BUCKET_NAME ||
  process.env.GOOGLE_CLOUD_STORAGE_BUCKET ||
  process.env.AWS_STORAGE_BUCKET_NAME ||
  "";

const privatePrefix = (process.env.GCS_PRIVATE_PREFIX || "pg-ride/private").replace(/\/$/, "");

export const STORAGE_AVAILABLE = Boolean(bucketName);

let storageClient: Storage | null = null;

function getStorage(): Storage {
  if (!storageClient) {
    storageClient = new Storage();
  }
  return storageClient;
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  private bucket() {
    if (!STORAGE_AVAILABLE) {
      throw new Error("Object storage is not configured. Set GCS_BUCKET_NAME on Railway.");
    }
    return getStorage().bucket(bucketName);
  }

  getPublicObjectSearchPaths(): Array<string> {
    if (!STORAGE_AVAILABLE) throw new Error("Object storage is not configured for this environment.");
    return [];
  }

  getPrivateObjectDir(): string {
    if (!STORAGE_AVAILABLE) throw new Error("Object storage is not configured for this environment.");
    return privatePrefix;
  }

  async searchPublicObject(_filePath: string): Promise<null> {
    return null;
  }

  async downloadObject(file: File, res: Response, cacheTtlSec: number = 3600) {
    const [metadata] = await file.getMetadata();
    res.setHeader("Content-Type", metadata.contentType || "application/octet-stream");
    res.setHeader("Cache-Control", `private, max-age=${cacheTtlSec}`);
    file.createReadStream().on("error", () => res.sendStatus(500)).pipe(res);
  }

  async getObjectEntityUploadURL(): Promise<string> {
    if (!STORAGE_AVAILABLE) {
      throw new Error("File uploads are not available in this environment.");
    }
    const objectName = `${privatePrefix}/${randomUUID()}`;
    const file = this.bucket().file(objectName);
    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 15 * 60 * 1000,
      contentType: "application/octet-stream",
    });
    return url;
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!STORAGE_AVAILABLE) {
      throw new ObjectNotFoundError();
    }
    const normalized = this.normalizeObjectEntityPath(objectPath);
    const file = this.bucket().file(normalized);
    const [exists] = await file.exists();
    if (!exists) throw new ObjectNotFoundError();
    return file;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    const trimmed = rawPath.replace(/^\/+/, "");
    const withoutObjectsPrefix = trimmed.replace(/^objects\//, "");
    return withoutObjectsPrefix;
  }

  async trySetObjectEntityAclPolicy(rawPath: string, aclPolicy: { owner: string; visibility: "public" | "private" }): Promise<string> {
    const normalized = this.normalizeObjectEntityPath(rawPath);
    const file = this.bucket().file(normalized);
    await setObjectAclPolicy(file, aclPolicy);
    return normalized;
  }

  async canAccessObjectEntity(opts: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    if (!opts.userId) return false;
    return canAccessObject({
      userId: opts.userId,
      objectFile: opts.objectFile,
      requestedPermission: opts.requestedPermission ?? ObjectPermission.READ,
    });
  }
}

export const objectStorageClient = STORAGE_AVAILABLE ? getStorage() : null;
