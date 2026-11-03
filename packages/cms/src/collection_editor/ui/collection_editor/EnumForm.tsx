
import { FieldCaption } from "../../_cms_internals";
import React, { useEffect } from "react";
import { useTranslation } from "@rebasepro/app";
import { deepEqual as equal } from "fast-equals"

;
import { EnumValueConfig, EnumValues } from "@rebasepro/types";
import { ArrayContainer, ArrayEntryParams } from "../../_cms_internals";
import {
    Badge,
    Button,
    CircularProgress,
    DebouncedTextField,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    iconSize,
    ListIcon,
    Paper,
    RefreshCcwIcon,
    SettingsIcon,
    Typography
} from "@rebasepro/ui";
import { extractEnumFromValues } from "@rebasepro/inference";
import { Field, Formex, getIn, useCreateFormex, useFormex } from "@rebasepro/forms";

type EnumFormProps = {
    enumValues: EnumValueConfig[];
    onValuesChanged?: (enumValues: EnumValueConfig[]) => void;
    onError?: (error: boolean) => void;
    updateIds: boolean;
    disabled: boolean;
    allowDataInference?: boolean;
    getData?: () => Promise<string[]>;
};

export function EnumForm({
    enumValues,
    onValuesChanged,
    onError,
    updateIds,
    disabled,
    allowDataInference,
    getData
}: EnumFormProps) {

    const { t } = useTranslation();
    const formex = useCreateFormex<{
        enum: EnumValueConfig[]
    }>({
        initialValues: { enum: enumValues },
        validateOnChange: true,
        validation: (values) => {
            const enumErrors = enumValueErrors(values.enum ?? [], t);
            const hasAnyError = enumErrors.some(error => error.label !== undefined || error.id !== undefined);
            onError?.(hasAnyError);
            return (hasAnyError ? { enum: enumErrors } : {}) as Record<string, string>;
        }
    });

    const {
        values,
        errors
    } = formex;

    useEffect(() => {
        if (onValuesChanged) {
            onValuesChanged(values.enum);
        }
    }, [values.enum]);

    return <Formex value={formex as ReturnType<typeof useCreateFormex>}>
        <EnumFormFields enumValuesPath={"enum"}
            values={values}
            errors={errors}
            shouldUpdateId={updateIds}
            disabled={disabled}
            allowDataInference={allowDataInference}
            getData={getData}/>
    </Formex>

}

/** What is wrong with one enum value entry, if anything. */
export interface EnumFieldError { label?: string; id?: string; }

/**
 * The errors of each enum value entry, by index: a missing label, a missing
 * id, or an id an earlier entry already has. An id names one value — two with
 * the same id store the same thing, and the panel cannot tell which label a
 * row means — compared as text, as the stored value and the select compare it.
 */
export function enumValueErrors(
    enumValues: EnumValueConfig[],
    t: (key: string, options?: Record<string, string>) => string
): EnumFieldError[] {
    const seenIds = new Set<string>();
    return enumValues.map((enumValue) => {
        const fieldError: EnumFieldError = {};
        if (!enumValue?.label) {
            fieldError.label = "You must specify a label for this enum value entry";
        }
        if (!hasEnumId(enumValue)) {
            fieldError.id = "You must specify an ID for this enum value entry";
        } else if (seenIds.has(String(enumValue.id))) {
            fieldError.id = t("enum_id_duplicate", { id: String(enumValue.id) });
        } else {
            seenIds.add(String(enumValue.id));
        }
        return fieldError;
    });
}

/**
 * Whether an enum value has its id. `0` is one: a number select's first
 * value is often `0`, and a truthiness check called it missing.
 */
export function hasEnumId(enumValue: EnumValueConfig | undefined): boolean {
    const id = enumValue?.id;
    return id !== undefined && id !== null && id !== "";
}

type EnumFormFieldsProps = {
    values: {
        enum: EnumValueConfig[]
    };
    errors: { enum?: Array<{ label?: string; id?: string }> };
    enumValuesPath: string;
    shouldUpdateId: boolean;
    disabled: boolean;
    getData?: () => Promise<string[]>;
    allowDataInference?: boolean;
};

// const EnumFormFields = React.memo(
function EnumFormFields({
    values,
    errors,
    disabled,
    enumValuesPath,
    shouldUpdateId,
    allowDataInference,
    getData
}: EnumFormFieldsProps) {

    const {
        setFieldValue
    } = useFormex();

    const [lastInternalIdAdded, setLastInternalIdAdded] = React.useState<number | undefined>();
    const [editDialogIndex, setEditDialogIndex] = React.useState<number | undefined>();
    const [inferring, setInferring] = React.useState(false);

    const inferredValuesRef = React.useRef(new Set());
    const inferredValues = inferredValuesRef.current;

    const buildEntry = ({
        index,
        internalId
    }: ArrayEntryParams) => {
        const justAdded = lastInternalIdAdded === internalId;
        const entryError = errors?.enum?.[index];
        return <EnumEntry index={index}
            disabled={disabled}
            enumValuesPath={enumValuesPath}
            autoFocus={justAdded}
            entryError={entryError}
            shouldUpdateId={shouldUpdateId || justAdded}
            onDialogOpen={() => setEditDialogIndex(index)}
            inferredEntry={inferredValues.has(values.enum[index]?.id as string)}
            key={`${internalId}`}/>;
    };

    const inferValues = async () => {
        if (!getData)
            return;
        setInferring(true);
        getData?.().then((data) => {
            if (!data)
                return;

            const flatData = data.flat();

            const fieldData = Array.from(new Set(flatData));

            const currentEnumValues = values.enum;
            const foundEnumValues = extractEnumFromValues(fieldData);

            // add only new enum values
            const newEnumValues = foundEnumValues.filter((enumValue) => {
                if (!enumValue) return false;
                return !currentEnumValues?.some((v: EnumValueConfig) => v.id === enumValue.id);
            });

            newEnumValues.forEach((enumValue) => {
                if (enumValue) inferredValues.add(enumValue.id);
            });
            setFieldValue(enumValuesPath, [...newEnumValues, ...currentEnumValues], true);
        }).catch(e => {
            console.error(e);
        })
            .finally(() => setInferring(false));
    }

    return (
        <div className={"col-span-12"}>
            <div className="ml-3.5 flex flex-row items-center">
                <ListIcon/>
                <Typography variant={"subtitle2"}
                    className="ml-2 grow">
                    Values
                </Typography>
                {allowDataInference &&
                    <Button
                        disabled={disabled || inferring}
                        variant={"text"}
                        size={"small"}
                        onClick={inferValues}>
                        {inferring ? <CircularProgress size={"smallest"}/> : <RefreshCcwIcon/>}
                        Infer values from data
                    </Button>}
            </div>

            <Paper className="p-4 m-1">

                <ArrayContainer droppableId={enumValuesPath}
                    addLabel={"Add enum value"}
                    value={values.enum}
                    disabled={disabled}
                    size={"small"}
                    buildEntry={buildEntry}
                    onInternalIdAdded={setLastInternalIdAdded}
                    canAddElements={true}
                    onValueChange={(value: EnumValueConfig[]) => setFieldValue(enumValuesPath, value)}
                    newDefaultEntry={{
                        id: "",
                        label: ""
                    }}/>

                <EnumEntryDialog index={editDialogIndex}
                    open={editDialogIndex !== undefined}
                    enumValuesPath={enumValuesPath}
                    onClose={() => setEditDialogIndex(undefined)}/>
            </Paper>
        </div>
    );
}

type EnumEntryProps = {
    index: number,
    enumValuesPath: string,
    shouldUpdateId: boolean,
    autoFocus: boolean,
    onDialogOpen: () => void;
    disabled: boolean;
    inferredEntry?: boolean;
    entryError?: { label?: string, id?: string }
};

const EnumEntry = React.memo(
    function EnumEntryInternal({
        index,
        shouldUpdateId: updateId,
        enumValuesPath,
        autoFocus,
        onDialogOpen,
        disabled,
        inferredEntry,
        entryError
    }: EnumEntryProps) {

        const {
            values,
            handleChange,
            errors,
            setFieldValue,
            touched
        } = useFormex<EnumValues>();

        const shouldUpdateIdRef = React.useRef(!getIn(values, `${enumValuesPath}[${index}].id`));
        const shouldUpdateId = updateId || shouldUpdateIdRef.current;

        const idValue = getIn(values, `${enumValuesPath}[${index}].id`);
        const labelValue = getIn(values, `${enumValuesPath}[${index}].label`);

        const currentLabelRef = React.useRef(labelValue);

        React.useEffect(() => {
            if ((currentLabelRef.current === idValue || !idValue) && shouldUpdateId) {
                setFieldValue(`${enumValuesPath}[${index}].id`, labelValue);
            }
            currentLabelRef.current = labelValue;
        }, [labelValue]);

        return (
            <>
                <div className={"flex w-full align-center justify-center"}>
                    <Field name={`${enumValuesPath}[${index}].label`}
                        as={DebouncedTextField}
                        className={"grow"}
                        required
                        disabled={disabled}
                        size="small"
                        autoFocus={autoFocus}
                        autoComplete="off"
                        endAdornment={inferredEntry && <RefreshCcwIcon size={iconSize.small}/>}
                        error={Boolean(entryError?.label)}/>

                    {!disabled &&
                        <Badge color={"error"} invisible={!entryError?.id}>
                            <IconButton
                                size="small"
                                aria-label="edit"
                                className={"m-1"}
                                onClick={() => onDialogOpen()}>
                                <SettingsIcon size={iconSize.small}/>
                            </IconButton>
                        </Badge>}

                </div>

                {entryError?.label && <Typography variant={"caption"}
                    className={"ml-3.5 text-red-500 dark:text-red-500"}>
                    {entryError?.label}
                </Typography>}

                {entryError?.id && <Typography variant={"caption"}
                    className={"ml-3.5 text-red-500 dark:text-red-500"}>
                    {entryError?.id}
                </Typography>}

            </>);
    },
    function areEqual(prevProps: EnumEntryProps, nextProps: EnumEntryProps) {
        return prevProps.index === nextProps.index &&
            prevProps.enumValuesPath === nextProps.enumValuesPath &&
            prevProps.shouldUpdateId === nextProps.shouldUpdateId &&
            prevProps.inferredEntry === nextProps.inferredEntry &&
            equal(prevProps.entryError, nextProps.entryError) &&
            prevProps.autoFocus === nextProps.autoFocus;
    }
);

function EnumEntryDialog({
    index,
    open,
    onClose,
    enumValuesPath
}: {
    index?: number;
    open: boolean;
    enumValuesPath: string;
    onClose: () => void;
}) {

    const {
        errors
    } = useFormex<EnumValues>();

    const idError = index !== undefined ? getIn(errors, `${enumValuesPath}[${index}].id`) as string | undefined : undefined;
    return <Dialog
        maxWidth="md"
        aria-labelledby="enum-edit-dialog"
        open={open}
        onOpenChange={(open) => !open ? onClose() : undefined}
    >
        <DialogTitle hidden>Enum form dialog</DialogTitle>
        <DialogContent>
            {index !== undefined &&
                <div>
                    <Field name={`${enumValuesPath}[${index}].id`}
                        as={DebouncedTextField}
                        required
                        label={"ID"}
                        size="small"
                        autoComplete="off"
                        error={Boolean(idError)}/>

                    <FieldCaption error={Boolean(idError)}>
                        {idError ?? "Value saved in the data source"}
                    </FieldCaption>
                </div>}
        </DialogContent>

        <DialogActions>
            <Button
                autoFocus
                onClick={onClose}>
                Ok
            </Button>
        </DialogActions>

    </Dialog>
}

