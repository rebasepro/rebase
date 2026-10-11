/**
 * Compile-time assertions about the admin client's answers.
 *
 * A plain module under `src`, imported by nothing, for the reason
 * `query-contract.types.ts` gives: a type assertion in a jest test is checked
 * by nothing here, and `pnpm typecheck` reads `src`.
 */
import type { createAdmin } from "./admin";

type Admin = ReturnType<typeof createAdmin>;

/**
 * `POST /admin/users` answers `{ user, invitationSent, temporaryPassword?,
 * emailDeliveryFailed? }`, and the temporary password is returned exactly
 * once. Typed `{ user }`, it was a compile error to read — while the sibling
 * `resetPassword` typed the same three fields.
 */
export const createUserDelivery = async (admin: Admin) => {
    const created = await admin.createUser({ email: "new@example.com" });
    const temporaryPassword: string | undefined = created.temporaryPassword;
    const invitationSent: boolean | undefined = created.invitationSent;
    const emailDeliveryFailed: boolean | undefined = created.emailDeliveryFailed;
    return { temporaryPassword, invitationSent, emailDeliveryFailed };
};
