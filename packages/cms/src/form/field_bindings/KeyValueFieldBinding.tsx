import type { FieldProps } from "../../types/fields";
import type { MapProperty } from "@rebasepro/types";
import React, { useEffect, useState } from "react";
import { DataType, GeoPoint } from "@rebasepro/types";

import { ArrayContainer } from "../../components/ArrayContainer";
import { FieldHelperText } from "../components/FieldHelperText";
import { LabelWithIconAndTooltip } from "../components/LabelWithIconAndTooltip";
import {
    BooleanSwitchWithLabel,
    Button,
    ChevronDownIcon,
    cls,
    DateTimeField,
    defaultBorderMixin,
    ExpandablePanel,
    IconButton,
    iconSize,
    Menu,
    MenuItem,
    MinusIcon,
    PlusIcon,
    TextField,
    Typography
} from "@rebasepro/ui";
import { getIconForProperty } from "../../util/property_utils";
import { useCustomizationController, useTranslation } from "@rebasepro/app";
import { getIn } from "@rebasepro/forms";
import { getDefaultValueFortype } from "@rebasepro/common";

type MapEditViewRowState = [number, {
    key: string,
    type: DataType
}];

/**
 * Field that allows edition of key value pairs.
 *
 * @group Form fields
 */
export function KeyValueFieldBinding({
                                         propertyKey,
                                         value,
                                         showError,
                                         error,
                                         disabled,
                                         property,
                                         setValue,
                                         minimalistView,
                                         includeDescription,
                                         underlyingValueHasChanged,
                                         autoFocus,
                                         context
                                     }: FieldProps<MapProperty>) {

    const expanded = (property.admin?.expanded === undefined ? true : property.admin?.expanded) || autoFocus;

    if (!property.keyValue) {
        throw Error(`Your property ${propertyKey} needs to have the 'keyValue' prop in order to use this field binding`);
    }

    const initialValues = getIn(context.formex.initialValues, propertyKey) as Record<string, unknown> | undefined;

    const mapFormView = <MapEditView value={value}
                                     setValue={setValue}
                                     disabled={disabled}
                                     initialValue={initialValues}
                                     fieldName={property.name ?? propertyKey}/>;

    const title = <LabelWithIconAndTooltip
        propertyKey={propertyKey}
        icon={getIconForProperty(property, "small")}
        required={property.validation?.required}
        title={property.name ?? propertyKey}
        className={"text-text-secondary dark:text-text-secondary-dark"}/>;

    return (
        <>

            {!minimalistView && <ExpandablePanel initiallyExpanded={expanded}
                                                 title={title}
                                                 innerClassName={"px-2 md:px-4 pb-2 md:pb-4 pt-1 md:pt-2"}>{mapFormView}</ExpandablePanel>}

            {minimalistView && mapFormView}

            <FieldHelperText includeDescription={includeDescription}
                             showError={showError}
                             error={error}
                             disabled={disabled}
                             property={property}/>

        </>
    );
}

interface MapEditViewParams<T extends Record<string, unknown>> {
    value?: T;
    initialValue?: T;
    setValue: (value: (T | null)) => void;
    fieldName?: string,
    disabled?: boolean
}

function MapEditView<T extends Record<string, unknown>>({
                                                            value,
                                                            initialValue,
                                                            setValue,
                                                            fieldName,
                                                            disabled
                                                        }: MapEditViewParams<T>) {
    const [internalState, setInternalState] = React.useState<MapEditViewRowState[]>(
        Object.keys(initialValue ?? {}).map((key) => [getRandomId(), {
            key,
            type: gettype(initialValue?.[key]) ?? "string"
        }])
    );
    const { t } = useTranslation();

    useEffect(() => {
        const currentKeys = internalState.map(([id, { key }]) => key);
        const newKeys = Object.entries(value ?? {}).filter(([key, v]) => v !== undefined).map(([key]) => key);
        const keysToAdd = newKeys.filter((key) => !currentKeys.includes(key));
        const keysToRemove = currentKeys.filter((key) => !newKeys.includes(key));
        const newRowIds = [...internalState];
        keysToAdd.forEach((key) => {
            newRowIds.push([getRandomId(), {
                key,
                type: gettype(value?.[key]) ?? "string"
            }]);
        });
        keysToRemove.forEach((key) => {
            const index = newRowIds.findIndex(([id, { key: k }]) => k === key);
            newRowIds.splice(index, 1);
        });
        setInternalState(newRowIds);
    }, [value]);

    const updatetype = (id: number, type: DataType) => {
        if (!id) {
            console.warn("No key selected for data type update");
            return;
        }
        setInternalState(internalState.map((row) => {
            if (row[0] === id) {
                return [row[0], {
                    key: row[1].key,
                    type
                }];
            }
            return row;
        }));
        setValue({
            ...(value ?? {} as T),
            [internalState.find((row) => row[0] === id)?.[1].key ?? ""]: getDefaultValueFortype(type)
        })
    };

    return <div className="py-1 flex flex-col gap-1">
        {internalState
            .map(([id, {
                    key: fieldKey,
                    type
                }], index) => {
                    const entryValue = fieldKey ? value?.[fieldKey] : "";
                    const onFieldKeyChange = (newKey: string) => {

                        setInternalState(internalState.map((currentId) => {
                            if (currentId[0] === id) {
                                return [id, {
                                    key: newKey ?? "",
                                    type: currentId[1].type
                                }];
                            }
                            return currentId;
                        }));

                        if (typeof value === "object" && newKey in value) {
                            // if the key is already there, don't delete the previous value
                            return;
                        }

                        const newValue = { ...(value ?? {}) } as T;
                        if (typeof initialValue === "object" && fieldKey in initialValue) {
                            (newValue as Record<string, unknown>)[fieldKey] = undefined; // set to undefined to remove from the object, the driver will remove it from the backend
                        } else {
                            delete (newValue as Record<string, unknown>)[fieldKey];
                        }
                        setValue({
                            ...newValue,
                            [newKey ?? ""]: entryValue
                        });
                    };
                    return <MapKeyValueRow id={id}
                                           key={id}
                                           fieldKey={fieldKey}
                                           value={value ?? {} as T}
                                           onDeleteClick={() => {
                                               const newValue = { ...(value ?? {}) as T };
                                               if (initialValue && fieldKey in initialValue) {
                                                   (newValue as Record<string, unknown>)[fieldKey] = undefined;
                                               } else {
                                                   delete (newValue as Record<string, unknown>)[fieldKey];
                                               }
                                               setInternalState(internalState.filter((currentId) => currentId[0] !== id));
                                               setValue({
                                                   ...newValue
                                               });
                                           }}
                                           onFieldKeyChange={onFieldKeyChange}
                                           setValue={setValue}
                                           entryValue={entryValue}
                                           type={type}
                                           disabled={disabled}
                                           updatetype={updatetype}/>;
                }
            )}

        <Button variant={"text"}
                size={"small"}
                className="w-full"
                disabled={disabled}
                startIcon={<PlusIcon/>}
                onClick={(e) => {
                    e.preventDefault();
                    setValue({
                        ...(value ?? {} as T),
                        "": null
                    });
                    setInternalState([...internalState, [getRandomId(), {
                        key: "",
                        type: "string"
                    }]]);
                }
                }>
            {fieldName ? t("add_to_field", { fieldName }) : t("add")}
        </Button>

    </div>;
}

function MapKeyValueRow<T extends Record<string, unknown>>({
                                                               id,
                                                               fieldKey,
                                                               value,
                                                               onFieldKeyChange,
                                                               onDeleteClick,
                                                               setValue,
                                                               entryValue,
                                                               type,
                                                               updatetype,
                                                               disabled
                                                           }: {
    id: number,
    fieldKey: string,
    value: T,
    onFieldKeyChange: (newKey: string) => void,
    onDeleteClick: () => void,
    setValue: (value: (T | null)) => void,
    entryValue: unknown,
    type: DataType,
    disabled?: boolean,
    updatetype: (id: number, type: DataType) => void
}) {

    const { locale } = useCustomizationController();
    const { t } = useTranslation();

    function buildInput(entryValue: unknown, fieldKey: string, type: DataType) {
        if (type === "string" || type === "number") {
            return <TextField
                key={type}
                aria-label={fieldKey ? `${t("value")}: ${fieldKey}` : t("value")}
                placeholder={"value"}
                value={entryValue as string | number | undefined}
                type={type === "number" ? "number" : "text"}
                size={"medium"}
                disabled={disabled || !fieldKey}
                onChange={(event) => {
                    if (type === "number") {
                        const numberValue = event.target.value ? parseFloat(event.target.value) : undefined;
                        if (numberValue && isNaN(numberValue)) {
                            setValue({
                                ...value,
                                [fieldKey]: null
                            });
                        } else if (numberValue !== undefined && numberValue !== null) {
                            setValue({
                                ...value,
                                [fieldKey]: numberValue
                            });
                        } else {
                            setValue({
                                ...value,
                                [fieldKey]: null
                            });
                        }
                    } else {
                        setValue({
                            ...value,
                            [fieldKey]: event.target.value
                        });
                    }
                }}/>;
        } else if (type === "date") {
            return <DateTimeField value={entryValue as Date | null | undefined}
                                  size={"medium"}
                                  locale={locale}
                                  disabled={disabled || !fieldKey}
                                  onChange={(date) => {
                                      setValue({
                                          ...value,
                                          [fieldKey]: date
                                      });
                                  }}/>;
        } else if (type === "boolean") {
            return <BooleanSwitchWithLabel value={entryValue as boolean | null}
                                           size={"medium"}
                                           position={"start"}
                                           disabled={disabled || !fieldKey}
                                           onValueChange={(newValue) => {
                                               setValue({
                                                   ...value,
                                                   [fieldKey]: newValue
                                               });
                                           }}/>;
        } else if (type === "array") {
            const arrayValue = (entryValue as string[]) || [];
            return <div
                className={cls(defaultBorderMixin, "ml-2 pl-2 border-l border-solid")}>
                <ArrayContainer value={arrayValue}
                                newDefaultEntry={""}
                                droppableId={id.toString()}
                                addLabel={fieldKey ? t("add_to_field", { fieldName: fieldKey }) : t("add")}
                                size={"small"}
                                disabled={disabled || !fieldKey}
                                canAddElements={true}
                                onValueChange={(newValue) => {
                                    setValue({
                                        ...value,
                                        [fieldKey]: newValue
                                    });
                                }}
                                buildEntry={({
                                                 index,
                                                 internalId
                                             }) => {
                                    return <ArrayKeyValueRow
                                        index={index}
                                        id={internalId}
                                        value={arrayValue[index]}
                                        disabled={disabled || !fieldKey}
                                        setValue={(newValue) => {
                                            const newArrayValue = [...arrayValue] as unknown[];
                                            newArrayValue[index] = newValue;
                                            setValue({
                                                ...value,
                                                [fieldKey]: newArrayValue
                                            });
                                        }}
                                    />
                                }}/>
            </div>;
        } else if (type === "map") {
            return <div
                className={cls(defaultBorderMixin, "ml-2 pl-2 border-l border-solid")}>
                <MapEditView value={entryValue as Record<string, unknown> | undefined}
                             fieldName={fieldKey}
                             setValue={(updatedValue) => {
                                 setValue({
                                     ...value,
                                     [fieldKey]: updatedValue
                                 });
                             }}/>
            </div>;
        } else {
            return <Typography
                variant={"caption"}>
                {`Data type ${type} not supported yet`}
            </Typography>;
        }
    }

    function doUpdatetype(type: DataType) {
        updatetype(id, type);
    }

    return (<>
            <Typography key={id.toString()}
                        component={"div"}
                        className="font-mono flex flex-row gap-1">
                <div className="w-[300px] max-w-[30%]">
                    <TextField
                        value={fieldKey}
                        aria-label={t("key")}
                        placeholder={"key"}
                        disabled={disabled || (entryValue !== undefined && entryValue !== null && entryValue !== "")}
                        size={"medium"}
                        onChange={(event) => {
                            onFieldKeyChange(event.target.value);
                        }}/>
                </div>

                <div className="grow">
                    {(type !== "map" && type !== "array") && buildInput(entryValue, fieldKey, type)}
                </div>
                <div className={"flex flex-col"}>
                    <Menu
                        trigger={<IconButton size={"smallest"}>
                            <ChevronDownIcon size={iconSize.small}/>
                        </IconButton>}
                    >
                        <MenuItem dense
                                  onClick={() => doUpdatetype("string")}>string</MenuItem>
                        <MenuItem dense
                                  onClick={() => doUpdatetype("number")}>number</MenuItem>
                        <MenuItem dense
                                  onClick={() => doUpdatetype("boolean")}>boolean</MenuItem>
                        <MenuItem dense
                                  onClick={() => doUpdatetype("date")}>date</MenuItem>
                        <MenuItem dense
                                  onClick={() => doUpdatetype("map")}>map</MenuItem>
                        <MenuItem dense
                                  onClick={() => doUpdatetype("array")}>array</MenuItem>
                    </Menu>

                    <IconButton aria-label="delete"
                                size={"smallest"}
                                onClick={onDeleteClick}>
                        <MinusIcon size={iconSize.smallest}/>
                    </IconButton>
                </div>
            </Typography>

            {(type === "map" || type === "array") && buildInput(entryValue, fieldKey, type)}

        </>

    );
}

function ArrayKeyValueRow<T>({
                                 id,
                                 index,
                                 value,
                                 setValue
                             }: {
    id: number,
    index: number,
    value: T,
    setValue: (value: T | null) => void,
    disabled?: boolean,
}) {

    const { locale } = useCustomizationController();
    const [selectedtype, setSelectedtype] = useState<DataType>(gettype(value) ?? "string");

    function doUpdatetype(type: DataType) {
        setSelectedtype(type);
    }

    function buildInput(entryValue: unknown, type: DataType) {
        if (type === "string" || type === "number") {
            return <TextField value={entryValue as string | number | undefined}
                              aria-label={`Value ${index + 1}`}
                              type={type === "number" ? "number" : "text"}
                              size={"medium"}
                              onChange={(event) => {
                                  if (type === "number") {
                                      const numberValue = event.target.value ? parseFloat(event.target.value) : undefined;
                                      if (numberValue && isNaN(numberValue)) {
                                          setValue(null);
                                      } else if (numberValue !== undefined && numberValue !== null) {
                                          setValue(numberValue as T);
                                      } else {
                                          setValue(null);
                                      }
                                  } else {
                                      setValue(event.target.value as T);
                                  }
                              }}/>;
        } else if (type === "date") {
            return <DateTimeField value={entryValue as Date | null | undefined}
                                  size={"medium"}
                                  locale={locale}
                                  onChange={(date) => {
                                      setValue(date as T);
                                  }}/>;
        } else if (type === "boolean") {
            return <BooleanSwitchWithLabel value={entryValue as boolean | null}
                                           size={"small"}
                                           position={"start"}
                                           onValueChange={(v) => {
                                               setValue(v as T);
                                           }}/>;
        } else if (type === "array") {
            return <Typography variant={"caption"}>
                Arrays of arrays are not supported.
            </Typography>;
        } else if (type === "map") {
            const mapValue = (entryValue && typeof entryValue === "object") ? (entryValue as Record<string, unknown>) : undefined;
            return <div className={cls(defaultBorderMixin, "ml-2 pl-2 border-l border-solid")}>
                <MapEditView value={mapValue}
                             setValue={(updatedValue) => {
                                 setValue(updatedValue as T | null);
                             }}/>
            </div>;
        } else {
            return <Typography
                variant={"caption"}>
                {`Data type ${type} not supported yet`}
            </Typography>;
        }
    }

    return (<>
            <Typography key={id.toString()}
                        component={"div"}
                        className="font-mono flex min-h-12 flex-row gap-1 items-center">

                <div className="grow">
                    {selectedtype !== "map" && buildInput(value, selectedtype)}
                </div>

                <Menu
                    trigger={<IconButton size={"small"}
                                         className="h-7 w-7">
                        <ChevronDownIcon/>
                    </IconButton>}>
                    <MenuItem dense
                              onClick={() => doUpdatetype("string")}>string</MenuItem>
                    <MenuItem dense
                              onClick={() => doUpdatetype("number")}>number</MenuItem>
                    <MenuItem dense
                              onClick={() => doUpdatetype("boolean")}>boolean</MenuItem>
                    <MenuItem dense
                              onClick={() => doUpdatetype("map")}>map</MenuItem>
                    <MenuItem dense
                              onClick={() => doUpdatetype("date")}>date</MenuItem>
                </Menu>

            </Typography>

            {selectedtype === "map" && buildInput(value, selectedtype)}

        </>

    );
}

function getRandomId() {
    return Math.floor(Math.random() * Math.floor(Number.MAX_SAFE_INTEGER));
}

function gettype(value: unknown): DataType | undefined {
    if (typeof value === "string" || value === null) {
        return "string";
    } else if (typeof value === "number") {
        return "number";
    } else if (typeof value === "boolean") {
        return "boolean";
    } else if (Array.isArray(value)) {
        return "array";
    } else if (value instanceof Date) {
        return "date";
    } else if (value && typeof value === "object" && "isEntityReference" in value && typeof (value as Record<string, unknown>).isEntityReference === "function" && (value as Record<string, (...args: unknown[]) => unknown>).isEntityReference()) {
        return "reference";
    } else if (value instanceof GeoPoint) {
        return "geopoint";
    } else if (typeof value === "object") {
        return "map";
    }

    return undefined;
}
