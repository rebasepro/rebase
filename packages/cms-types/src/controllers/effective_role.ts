/**
 * The role the signed-in user is acting as in the panel (an admin previewing
 * the panel as another role), and how to change it. `null` is their own roles.
 * @group Models
 */
export interface EffectiveRoleController {
    effectiveRole: string | null;
    setEffectiveRole: (role: string | null) => void;
}
