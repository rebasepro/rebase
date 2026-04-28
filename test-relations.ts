import { resolveCollectionRelations } from "./packages/common/src/util/relations";
import companiesCollection from "../sustentalent/admin-app/shared/collections/companies";

const relations = resolveCollectionRelations(companiesCollection as any);
console.log(Object.keys(relations));
