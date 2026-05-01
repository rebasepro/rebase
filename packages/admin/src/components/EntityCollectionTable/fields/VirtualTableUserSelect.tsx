import React, { useEffect } from "react";
import { User } from "@rebasepro/types";
import { UserSelector } from "../../../components/UserSelector";

export function VirtualTableUserSelect(props: {
    name: string;
    error: Error | undefined;
    multiple: boolean;
    disabled: boolean;
    small: boolean;
    internalValue: string | string[] | undefined;
    updateValue: (newValue: (string | string[] | null)) => void;
    focused: boolean;
    onBlur?: React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
}) {

    const {
        internalValue,
        disabled,
        small,
        focused,
        updateValue,
        multiple
    } = props;

    // For now we only support single-select in the table context via the new UserSelector
    const singleValue = Array.isArray(internalValue) ? internalValue[0] ?? null : internalValue ?? null;

    return (
        <UserSelector
            value={singleValue}
            onValueChange={(userId) => {
                updateValue(userId);
            }}
            disabled={disabled}
            size={"small"}
            clearable={true}
            invisible={true}
        />
    );
}
