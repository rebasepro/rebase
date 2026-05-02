/**
 * @group Models
 */
export interface UploadFileProps {
    file: File,
    key: string,
    metadata?: Record<string, unknown>,
    bucket?: string
}

/**
 * @group Models
 */
export interface UploadFileResult {
    /**
     * Storage key including the file name where the file was uploaded.
     */
    key: string;
    /**
     * Bucket where the file was uploaded
     */
    bucket: string;

    /**
     * Fully qualified storage URL for the uploaded file.
     *
     * For example: `s3://my-bucket/path/to/file.png`.
     *
     * This is optional for backwards compatibility.
     */
    storageUrl?: string;
}

/**
 * @group Models
 */
export interface DownloadConfig {
    /**
     * Temporal url that can be used to download the file
     */
    url: string | null;

    metadata?: DownloadMetadata;

    fileNotFound?: boolean;
}

/**
 * The full set of object metadata, including read-only properties.
 * @public
 */
export declare interface DownloadMetadata {
    /**
     * The bucket this object is contained in.
     */
    bucket: string;
    /**
     * The full path of this object.
     */
    fullPath: string;
    /**
     * The short name of this object, which is the last component of the full path.
     * For example, if path is 'full/path/image.png', name is 'image.png'.
     */
    name: string;
    /**
     * The size of this object, in bytes.
     */
    size: number;
    /**
     * Type of the uploaded file
     * e.g. "image/jpeg"
     */
    contentType: string;

    customMetadata: Record<string, unknown>;
}

/**
 * @group Models
 */
export interface StorageSource {
    /**
     * Upload an object, specifying a key
     * @param file
     * @param key
     * @param metadata
     * @param bucket
     */
    putObject: ({
                     file,
                     key,
                     metadata,
                     bucket
                 }: UploadFileProps) => Promise<UploadFileResult>;

    /**
     * Convert a storage key or URL into a download configuration (signed URL equivalent)
     * @param keyOrUrl
     * @param bucket
     */
    getSignedUrl: (keyOrUrl: string, bucket?: string) => Promise<DownloadConfig>;

    /**
     * Get an object from a storage key.
     * It returns null if the object does not exist.
     * @param key
     * @param bucket
     */
    getObject: (key: string, bucket?: string) => Promise<File | null>;

    /**
     * Delete an object.
     * @param key
     * @param bucket
     */
    deleteObject: (key: string, bucket?: string) => Promise<void>;

    /**
     * List the contents of a prefix.
     * @param prefix
     * @param options
     */
    listObjects: (prefix: string, options?: {
        bucket?: string,
        maxResults?: number,
        pageToken?: string
    }) => Promise<StorageListResult>;

}

/**
 * Result returned by list().
 * @public
 */
export declare interface StorageListResult {
    /**
     * References to prefixes (sub-folders). You can call list() on them to
     * get its contents.
     *
     * Folders are implicit based on '/' in the object paths.
     * For example, if a bucket has two objects '/a/b/1' and '/a/b/2', list('/a')
     * will return '/a/b' as a prefix.
     */
    prefixes: StorageReference[];
    /**
     * Objects in this directory.
     * You can call getMetadata() and getDownloadUrl() on them.
     */
    items: StorageReference[];
    /**
     * If set, there might be more results for this list. Use this token to resume the list.
     */
    nextPageToken?: string;
}

/**
 * Represents a reference to an S3-compatible storage object. Developers can
 * upload, download, and delete objects, as well as get/set object metadata.
 * @public
 */
export declare interface StorageReference {
    /**
     * Returns a s3:// URL for this object in the form
     *   `s3://<bucket>/<path>/<to>/<object>`
     * @returns The s3:// URL.
     */
    toString(): string;

    /**
     * A reference to the root of this object's bucket.
     */
    root: StorageReference;
    /**
     * The name of the bucket containing this reference's object.
     */
    bucket: string;
    /**
     * The full path of this object.
     */
    fullPath: string;
    /**
     * The short name of this object, which is the last component of the full path.
     * For example, if path is 'full/path/image.png', name is 'image.png'.
     */
    name: string;

    /**
     * A reference pointing to the parent location of this reference, or null if
     * this reference is the root.
     */
    parent: StorageReference | null;
}
