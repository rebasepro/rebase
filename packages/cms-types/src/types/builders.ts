import type { AuthController } from "../controllers/auth";
import type { RebaseData } from "@rebasepro/types";
import type { User } from "@rebasepro/types";

import type { AppView } from "../controllers/navigation";
import type { AdminCollection } from "@rebasepro/cms-types";

export type CollectionConfigsBuilder<EC extends AdminCollection = AdminCollection> = (params: {
    user: User | null,
    authController: AuthController,
    data: RebaseData
}) => EC[] | Promise<EC[]>;

export type AppViewsBuilder = (params: {
    user: User | null,
    authController: AuthController,
    data: RebaseData
}) => AppView[] | Promise<AppView[]>;
