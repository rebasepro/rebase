import type { AuthController } from "../controllers/auth";
import type { RebaseData } from "../controllers/data";
import type { User } from "../users";
import type { EntityCollection } from "./collections";
import type { AppView } from "../controllers/navigation";

export type EntityCollectionsBuilder<EC extends EntityCollection = EntityCollection> = (params: {
    user: User | null,
    authController: AuthController,
    data: RebaseData
}) => EC[] | Promise<EC[]>;

export type AppViewsBuilder = (params: {
    user: User | null,
    authController: AuthController,
    data: RebaseData
}) => AppView[] | Promise<AppView[]>;
