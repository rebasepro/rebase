import type { User } from "@rebasepro/types";
import type {
    AdminCollection,
    CollectionActionsProps,
    EntitySelectionController,
    EntityTableController
} from "@rebasepro/cms-types";

/**
 * What the admin's own collection actions (export, the collection editor's
 * gear) are handed: an app's {@link CollectionActionsProps} with the view's
 * controllers in the admin's view model, which they read records from.
 *
 * @internal
 */
export type BuiltInCollectionActionProps<
    M extends Record<string, unknown> = Record<string, unknown>,
    USER extends User = User,
    EC extends AdminCollection<M> = AdminCollection<M>
> = Omit<CollectionActionsProps<M, USER, EC>, "selectionController" | "tableController"> & {
    selectionController: EntitySelectionController<M>;
    tableController: EntityTableController<M>;
};
