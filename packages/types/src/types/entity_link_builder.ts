import { Entity } from "./entitys";

/**
 * @group Models
 */
export type EntityLinkBuilder<M extends Record<string, unknown> = Record<string, unknown>> = ({ entity }: {
    entity: Entity<M>
}) => string;
