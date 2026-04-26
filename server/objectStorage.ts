import { Response } from "express";

// Object storage uses Replit's internal sidecar service which is unavailable
// on Railway. All upload/download routes degrade gracefully with a clear error
// until a GCS or S3 replacement is configured.
const STORAGE_AVAILABLE = false;

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    if (!STORAGE_AVAILABLE) throw new Error("Object storage is not configured for this environment.");
    return [];
  }

  getPrivateObjectDir(): string {
    if (!STORAGE_AVAILABLE) throw new Error("Object storage is not configured for this environment.");
    return "";
  }

  async searchPublicObject(_filePath: string): Promise<null> {
    return null;
  }

  async downloadObject(_file: any, res: Response, _cacheTtlSec: number = 3600) {
    res.status(503).json({ error: "File storage is not available in this environment." });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    throw new Error("File uploads are not available in this environment.");
  }

  async getObjectEntityFile(_objectPath: string): Promise<never> {
    throw new ObjectNotFoundError();
  }

  normalizeObjectEntityPath(rawPath: string): string {
    return rawPath;
  }

  async trySetObjectEntityAclPolicy(rawPath: string, _aclPolicy: any): Promise<string> {
    return rawPath;
  }

  async canAccessObjectEntity(_opts: { userId?: string; objectFile: any; requestedPermission?: any }): Promise<boolean> {
    return false;
  }
}

// Stub — real client not available outside Replit
export const objectStorageClient = null;
