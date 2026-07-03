import {
  Snapshot,
  SnapshotCollection,
  SnapshotStatus,
  FilterValues,
  FetchCollectionProps,
  FetchOneProps,
  SaveProps,
  DeleteProps,
  WebSocketMessage,
  CollectionUpdateMessage,
  SingleUpdateMessage
} from "@rebasepro/types";

// Subscription types
export interface ListenCollectionRequest<M extends Record<string, unknown> = Record<string, unknown>> extends FetchCollectionProps<M> {
  subscriptionId: string;
  onUpdate: (snapshots: Snapshot<M>[]) => void;
  onError?: (error: Error) => void;
}

export interface ListenSnapshotRequest<M extends Record<string, unknown> = Record<string, unknown>> extends FetchOneProps<M> {
  subscriptionId: string;
  onUpdate: (snapshot: Snapshot<M> | null) => void;
  onError?: (error: Error) => void;
}

