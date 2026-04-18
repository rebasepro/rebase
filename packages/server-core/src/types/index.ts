import { 
  Entity, 
  EntityCollection, 
  EntityStatus, 
  FilterValues,
  FetchCollectionProps,
  FetchEntityProps,
  SaveEntityProps,
  DeleteEntityProps,
  WebSocketMessage,
  CollectionUpdateMessage,
  EntityUpdateMessage
} from "@rebasepro/types";

// Subscription types
export interface ListenCollectionRequest<M extends Record<string, unknown> = Record<string, unknown>> extends FetchCollectionProps<M> {
  subscriptionId: string;
  onUpdate: (entities: Entity<M>[]) => void;
  onError?: (error: Error) => void;
}

export interface ListenEntityRequest<M extends Record<string, unknown> = Record<string, unknown>> extends FetchEntityProps<M> {
  subscriptionId: string;
  onUpdate: (entity: Entity<M> | null) => void;
  onError?: (error: Error) => void;
}

