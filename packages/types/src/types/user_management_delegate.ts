import type { User } from "../users";

/**
 * Result of creating a new user via admin flow.
 * Contains the created user plus information about how credentials were delivered.
 */
export interface UserCreationResult<USER extends User = User> {
    /** The created user */
    user: USER;
    /** Whether an invitation email was sent to the user */
    invitationSent: boolean;
    /**
     * Temporary password (only present when email service is not configured).
     * This is returned one-time and should be shown to the admin to share manually.
     */
    temporaryPassword?: string;
}
