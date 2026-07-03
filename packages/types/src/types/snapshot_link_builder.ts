import { Snapshot } from "./snapshots";

/**
 * @group Models
 */
export type SnapshotLinkBuilder<M extends Record<string, unknown> = Record<string, unknown>> = ({ snapshot }: {
    snapshot: Snapshot<M>
}) => string;
