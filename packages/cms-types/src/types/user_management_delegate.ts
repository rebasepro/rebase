import type { User } from "@rebasepro/types";

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
     * Temporary password, present when no invitation email could be delivered —
     * either because no email service is configured, or because delivery failed
     * (see `emailDeliveryFailed`). Returned one-time, to be shared manually.
     */
    temporaryPassword?: string;
    /**
     * Whether an email service was configured but delivery failed, causing the
     * fallback to `temporaryPassword`. Absent when no email service is configured.
     */
    emailDeliveryFailed?: boolean;
}
