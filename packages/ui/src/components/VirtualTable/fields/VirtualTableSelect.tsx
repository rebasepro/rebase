import React, { useCallback, useEffect, useRef } from "react";
import { Select, SelectItem } from "../../Select";
import { MultiSelect, MultiSelectItem } from "../../MultiSelect";
import { Chip } from "../../Chip";

export interface VirtualTableSelectOption {
    value: string | number;
    label: string;
    color?: string;
}

export function VirtualTableSelect(props: {
    options: VirtualTableSelectOption[];
    error?: Error;
    multiple?: boolean;
    disabled: boolean;
    small?: boolean;
    value: string | number | string[] | number[] | undefined;
    updateValue: (newValue: (string | number | string[] | number[] | null)) => void;
    focused: boolean;
    onBlur?: React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
}) {
    const { options, value, disabled, small = false, focused, updateValue, multiple = false } = props;
    const validValue = (Array.isArray(value) && multiple) || (!Array.isArray(value) && !multiple);
    const ref = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (ref.current && focused) {
            ref.current?.focus({ preventScroll: true });
        }
    }, [focused, ref]);

    const onChange = useCallback((updatedValue: string | string[]) => {
        if (multiple) {
            const isNumber = options.some(o => typeof o.value === "number");
            const newValue = (updatedValue as string[]).map((v) => {
                const opt = options.find(o => String(o.value) === v);
                return typeof opt?.value === "number" ? parseFloat(v) : v;
            });
            if (isNumber) {
                updateValue(newValue as number[]);
            } else {
                updateValue(newValue as string[]);
            }
        } else {
            const opt = options.find(o => String(o.value) === updatedValue);
            updateValue(typeof opt?.value === "number" ? parseFloat(updatedValue as string) : (updatedValue as string || null));
        }
    }, [multiple, updateValue, options]);

    const renderValue = (val?: string | number) => {
        const option = options.find(o => o.value === val);
        return (
            <Chip size={small ? "small" : "medium"}>
                {option ? option.label : String(val)}
            </Chip>
        );
    };

    const handleOpenChange = useCallback((open: boolean) => {
        if (!open && ref.current) {
            setTimeout(() => {
                ref.current?.focus({ preventScroll: true });
            }, 0);
        }
    }, []);

    return multiple ? (
        <MultiSelect
            inputRef={ref}
            className="w-full h-full p-0 bg-transparent outline-none"
            position={"item-aligned"}
            disabled={disabled}
            includeClear={false}
            useChips={false}
            value={validValue ? (value as (string | number)[]).map(v => String(v)) : []}
            onValueChange={onChange}
            onOpenChange={handleOpenChange}
        >
            {options.map((opt) => (
                <MultiSelectItem key={String(opt.value)} value={String(opt.value)}>
                    <Chip size={small ? "small" : "medium"}>{opt.label}</Chip>
                </MultiSelectItem>
            ))}
        </MultiSelect>
    ) : (
        <Select
            inputRef={ref}
            fullWidth
            className="w-full h-full p-0 bg-transparent outline-none [&_button]:ring-0 [&_button]:ring-offset-0"
            inputClassName="ring-0 ring-offset-0 focus:ring-0 focus-visible:ring-0 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-offset-0"
            position={"item-aligned"}
            disabled={disabled}
            padding={false}
            value={validValue ? String(value) : ""}
            onValueChange={onChange}
            onOpenChange={handleOpenChange}
            renderValue={renderValue}
        >
            {options.map((opt) => (
                <SelectItem key={String(opt.value)} value={String(opt.value)}>
                    <Chip size={small ? "small" : "medium"}>{opt.label}</Chip>
                </SelectItem>
            ))}
        </Select>
    );
}
