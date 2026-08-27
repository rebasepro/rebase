import { Entity } from "@rebasepro/types";

/**
 * @group Models
 */
export type EntityLinkBuilder<M extends Record<string, unknown> = Record<string, unknown>> = ({ entity }: {
    entity: Entity<M>
}) => string;
