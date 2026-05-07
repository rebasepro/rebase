import { Card, cls, Typography } from "@rebasepro/ui";
import { Database as StorageIcon } from "lucide-react";
import React from "react";

export function UploadFilesButton({
  onClick,
  selected,
  className
}: {
  onClick: () => void;
  selected?: boolean;
  className?: string;
}) {
  return (
    <Card
      className={cls(
        "bg-transparent dark:bg-transparent flex flex-row gap-2 items-center justify-center px-3 py-1.5 cursor-pointer hover:bg-surface-50 dark:hover:bg-gray-800",
        selected ? "border-primary dark:border-primary" : "hover:ring-transparent",
        className
      )}
      onClick={onClick}
    >
      <span className="w-4 h-4 flex items-center justify-center text-text-primary dark:text-text-primary-dark">
        <StorageIcon size="smallest" />
      </span>
      <Typography variant="caption" className="font-medium">
        Upload Files
      </Typography>
    </Card>
  );
}

export default UploadFilesButton;
