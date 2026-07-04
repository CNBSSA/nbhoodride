import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface UploadedFile {
  uploadURL: string;
  name: string;
}

/** Shape-compatible subset of Uppy's UploadResult, which this component
 *  historically returned. Callers read `result.successful[0].uploadURL`. */
interface UploadCompleteResult {
  successful: UploadedFile[];
  failed: Array<{ name: string; error: string }>;
}

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  onGetUploadParameters: () => Promise<{
    method: "PUT";
    url: string;
  }>;
  onComplete?: (result: UploadCompleteResult) => void;
  buttonClassName?: string;
  children: ReactNode;
}

/**
 * File upload button using the NATIVE file picker — one tap opens the phone's
 * own camera/gallery chooser. This replaced an Uppy DashboardModal that
 * failed to open on mobile (the button highlighted but nothing appeared),
 * dead-ending driver onboarding at the documents step.
 *
 * Upload flow (contract unchanged): fetch an upload URL per file from
 * onGetUploadParameters, PUT the raw bytes to it, then hand the URLs to
 * onComplete. Same-origin PUTs (DB-backed storage) automatically carry the
 * CSRF header + session cookie via the patched window.fetch; cross-origin
 * PUTs (GCS presigned URLs) pass through untouched.
 */
export function ObjectUploader({
  maxNumberOfFiles = 1,
  maxFileSize = 10485760, // 10MB
  onGetUploadParameters,
  onComplete,
  buttonClassName,
  children,
}: ObjectUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).slice(0, maxNumberOfFiles);

    setError(null);
    setUploading(true);
    const successful: UploadedFile[] = [];
    const failed: Array<{ name: string; error: string }> = [];

    for (const file of files) {
      if (file.size > maxFileSize) {
        failed.push({ name: file.name, error: `File is larger than ${Math.round(maxFileSize / 1048576)}MB` });
        continue;
      }
      try {
        const { url } = await onGetUploadParameters();
        const res = await fetch(url, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream" },
        });
        if (!res.ok) {
          throw new Error(`Upload failed (${res.status})`);
        }
        successful.push({ uploadURL: url, name: file.name });
      } catch (err) {
        failed.push({ name: file.name, error: String((err as Error)?.message ?? err) });
      }
    }

    setUploading(false);
    if (failed.length > 0) {
      setError(
        failed.length === files.length
          ? "Upload failed. Check your connection and try again."
          : `${failed.length} of ${files.length} files failed — tap to retry those.`,
      );
    }
    if (successful.length > 0) {
      onComplete?.({ successful, failed });
    }
    // Allow re-selecting the same file (e.g. after a failure).
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.pdf"
        multiple={maxNumberOfFiles > 1}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        data-testid="input-file-native"
      />
      <Button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className={buttonClassName}
      >
        {uploading ? (
          <span className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Uploading…
          </span>
        ) : (
          children
        )}
      </Button>
      {error && (
        <p className="text-xs text-destructive mt-1" data-testid="upload-error">{error}</p>
      )}
    </div>
  );
}
