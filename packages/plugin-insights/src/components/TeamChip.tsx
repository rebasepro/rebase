import { Chip, cls } from "@rebasepro/ui";

export function TeamChip({
                             team,
                             className
                         }: { team: { name: string; id: string }, className?: string }) {
    return (
        <Chip
            colorScheme={"grayDarker"}
            size={"small"} className={cls("font-semibold", className)}>{team?.name ?? ""}</Chip>
    );
}
