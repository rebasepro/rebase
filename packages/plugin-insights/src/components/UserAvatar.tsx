import { Avatar } from "@rebasepro/ui";

interface UserAvatarUser {
    displayName?: string | null;
    email?: string | null;
    photoURL?: string | null;
}

export function UserAvatar({ user }: { user: UserAvatarUser }) {
    return (
        <Avatar className="h-8 w-8" src={user.photoURL ?? undefined}
                alt={user.displayName ?? user.email ?? undefined}>
            {user.displayName ? user.displayName.charAt(0).toUpperCase() : user.email?.charAt(0).toUpperCase()}
        </Avatar>
    );

}
