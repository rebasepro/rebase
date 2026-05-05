
import { DownloadConfig, StorageSource, UploadFileProps, UploadFileResult } from "@rebasepro/core";

export function useBuildMockStorageSource(): StorageSource {

    return {
        getSignedUrl(pathOrUrl: string): Promise<DownloadConfig> {
            throw new Error("Function not implemented.");
        },
getObject(key: string): Promise<File | null> {
            throw new Error("Function not implemented.");
        },
putObject({ file, key, metadata }: UploadFileProps): Promise<UploadFileResult> {
            throw new Error("Function not implemented.");
        },
listObjects(prefix: string): Promise<any> {
            throw new Error("Function not implemented.");
        },
deleteObject(key: string): Promise<void> {
            throw new Error("Function not implemented.");
        }
    };

}
