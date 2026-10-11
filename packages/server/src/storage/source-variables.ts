import { resourceEnvSuffix } from "@rebasepro/types";

/**
 * The variable that binds a declared object-store source's bucket on a
 * deployment — `S3_BUCKET__MEDIA`, `GCS_BUCKET__ARCHIVE`, `S3_BUCKET` for the
 * default source.
 *
 * One spelling for the three places that tell an operator to set it: the boot
 * warning, the 501 a request to the unbound source answers, and `rebase
 * status`. The 501 used to say "the media suffixed environment variables".
 */
export function storageBucketVariable(key: string, engine: string | undefined): string {
    return `${engine === "gcs" ? "GCS" : "S3"}_BUCKET${resourceEnvSuffix(key)}`;
}
