/**
 * Addresses no mail can reach: the synthetic ones a guest and an X (Twitter)
 * account are given, because `email` is NOT NULL. Nothing is mailed to them,
 * and no account may move onto one.
 */
export function isDeliverableAddress(email: string): boolean {
    const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
    return domain !== "anonymous.local" && domain !== "twitter.placeholder.rebase";
}
