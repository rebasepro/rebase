import { Button, cls, defaultBorderMixin, Dialog, DialogActions, DialogContent, DialogTitle, Label, Select, SelectItem, TextField } from "@rebasepro/ui";
import { Filter, Code } from "lucide-react";
import React, { lazy, Suspense, useState } from "react";
import { DashboardFilterConfig, FilterConfig, FilterOption } from "../types";
import { FieldLabel } from "./FieldLabel";
import { DataSourcesSelection } from "./DataSourcesSelection";

const CodeEditor = lazy(() => import("./CodeEditor").then(m => ({ default: m.CodeEditor })));

export interface FilterConfigFormProps {
    formOpen: boolean;
    setFormOpen: (open: boolean) => void;
    filter?: FilterConfig;
    onSave: (filter: FilterConfig) => void;
    onCancel: () => void;
    availableWidgetIds?: string[];
}

export const FilterConfigFormDialog: React.FC<FilterConfigFormProps> = ({
                                                                            formOpen,
                                                                            setFormOpen,
                                                                            filter,
                                                                            onSave,
                                                                            onCancel,
                                                                            availableWidgetIds = []
                                                                        }) => {
    const [formState, setFormState] = useState<DashboardFilterConfig>({
        key: "",
        label: "",
        type: "text_exact",
        position: {
            x: 0,
            y: 0
        },
        dataSources: [],
        ...(filter || {}),
    });

    const [errors, setErrors] = useState<Record<string, string>>({});

    // Update options array
    const addOption = () => {
        setFormState({
            ...formState,
            options: [...(formState.options || []), {
                label: "",
                value: ""
            }]
        });
    };

    const updateOption = (index: number, key: keyof FilterOption, value: any) => {
        const options = [...(formState.options || [])];
        options[index] = {
            ...options[index],
            [key]: value
        };
        setFormState({
            ...formState,
            options
        });
    };

    const removeOption = (index: number) => {
        const options = [...(formState.options || [])];
        options.splice(index, 1);
        setFormState({
            ...formState,
            options
        });
    };

    const handleChange = (key: keyof DashboardFilterConfig, value: any) => {
        setFormState({
            ...formState,
            [key]: value
        });

        // Clear validation error for this field if exists
        if (errors[key]) {
            const newErrors = { ...errors };
            delete newErrors[key];
            setErrors(newErrors);
        }
    };

    const handleSubmit = () => {
        // Validate required fields
        const newErrors: Record<string, string> = {};
        if (!formState.key) newErrors.key = "Key is required";
        if (!formState.label) newErrors.label = "Label is required";

        if (Object.keys(newErrors).length) {
            setErrors(newErrors);
            return;
        }

        onSave(formState);
    };

    return (
        <Dialog open={formOpen} onOpenChange={setFormOpen} maxWidth={"2xl"}
                containerClassName={"z-50"}
                className={"rounded-xl"}>
            <DialogContent className="flex flex-col gap-4 p-4">
                <DialogTitle variant="h5" className={"p-0 m-0"}>Edit Filter</DialogTitle>

                <table className="w-full border-separate border-spacing-y-2">
                    <tbody>
                    <tr>
                        <td className="align-top pt-2 pr-4">
                            <Label>Key</Label>
                        </td>
                        <td className="align-top pt-2">
                            <TextField
                                size="small"
                                value={formState.key}
                                onChange={(e) => handleChange("key", e.target.value)}
                                error={Boolean(errors.key)}
                                className={cls("w-full", defaultBorderMixin)}
                            />
                            <FieldLabel
                                error={Boolean(errors.key)}>{errors.key ?? "Used in SQL queries (e.g., date_column, product_id)"}</FieldLabel>
                        </td>
                    </tr>
                    <tr>
                        <td className="align-top pt-2 pr-4">
                            <Label>Label</Label>
                        </td>
                        <td className="align-top pt-2">
                            <TextField
                                size="small"
                                value={formState.label}
                                onChange={(e) => handleChange("label", e.target.value)}
                                error={Boolean(errors.label)}
                                className={cls("w-full", defaultBorderMixin)}
                            />
                            <FieldLabel
                                error={Boolean(errors.label)}>{errors.label ?? "User-friendly name shown in UI"}</FieldLabel>
                        </td>
                    </tr>
                    <tr>
                        <td className="align-top pt-2 pr-4">
                            <Label>Filter Type</Label>
                        </td>
                        <td className="align-top pt-2">
                            <Select
                                size="medium"
                                fullWidth
                                value={formState.type}
                                onChange={(e) => handleChange("type", e.target.value)}
                                className={cls("w-full", defaultBorderMixin)}
                            >
                                <SelectItem value="text_exact">Text (Exact Match)</SelectItem>
                                <SelectItem value="text_search">Text (Search)</SelectItem>
                                <SelectItem value="enum">Multiple Choice</SelectItem>
                                <SelectItem value="number">Number</SelectItem>
                                <SelectItem value="boolean">Boolean</SelectItem>
                                <SelectItem value="date">Date</SelectItem>
                                <SelectItem value="date_range">Date Range</SelectItem>
                            </Select>
                            <FieldLabel>The type of input widget that should be rendered</FieldLabel>
                        </td>
                    </tr>
                    <tr>
                        <td className="align-top pt-2 pr-4">
                            <Label>Placeholder</Label>
                        </td>
                        <td className="align-top pt-2">
                            <TextField
                                size="small"
                                value={formState.placeholder || ""}
                                onChange={(e) => handleChange("placeholder", e.target.value || undefined)}
                                className={cls("w-full", defaultBorderMixin)}
                            />
                            <FieldLabel>Placeholder text for textfields</FieldLabel>
                        </td>
                    </tr>
                    <tr>
                        <td className="align-top pt-2 pr-4">
                            <Label>DataSources</Label>
                        </td>
                        <td className="align-top pt-2">
                            <DataSourcesSelection
                                selectedDataSources={formState.dataSources}
                                setSelectedDataSources={(dataSources) => handleChange("dataSources", dataSources)}
                            />
                            <FieldLabel>Specify widget IDs to which this filter applies</FieldLabel>
                        </td>
                    </tr>

                    {formState.type === "enum" && (
                        <>
                            <tr>
                                <td className="align-top pt-2 pr-4">
                                    <Label>SQL Query for Options</Label>
                                </td>
                                <td className="align-top pt-2 min-h-48">
                                    <Suspense fallback={<div className="p-4">Loading editor...</div>}>
                                        <CodeEditor
                                            autoHeight={true}
                                            defaultLanguage={"sql"}
                                            value={formState.sqlQuery || ""}
                                            onChange={(newSql) => {
                                                handleChange("sqlQuery", newSql || undefined)
                                            }}
                                        />
                                    </Suspense>
                                    <FieldLabel>SQL query to fetch the enum options. It must
                                        return <code>value</code> and <code>label</code> columns</FieldLabel>
                                </td>
                            </tr>
                            <tr>
                                <td className="align-top pt-2 pr-4">
                                    <Label>Static Options </Label>
                                </td>
                                <td className="align-top pt-2">
                                    <div className="flex flex-col gap-2">
                                        {(formState.options || []).map((option, index) => (
                                            <div key={index} className="flex items-center gap-2">
                                                <TextField
                                                    size="small"
                                                    value={option.label}
                                                    onChange={(e) => updateOption(index, "label", e.target.value)}
                                                    placeholder="Label"
                                                    className={cls("flex-1", defaultBorderMixin)}
                                                />
                                                <TextField
                                                    size="small"
                                                    value={String(option.value)}
                                                    onChange={(e) => updateOption(index, "value", e.target.value)}
                                                    placeholder="Value"
                                                    className={cls("flex-1", defaultBorderMixin)}
                                                />
                                                <Button
                                                    size="small"
                                                    onClick={() => removeOption(index)}
                                                    variant="text"
                                                    color="neutral"
                                                >
                                                    Remove
                                                </Button>
                                            </div>
                                        ))}
                                        <Button
                                            size="small"
                                            className="ml-3"
                                            onClick={addOption}
                                            variant="outlined"
                                            color="neutral"
                                        >
                                            Add Option
                                        </Button>
                                    </div>
                                    <FieldLabel>Static list of options for the multiple choice filter. If the SQL query
                                        is set, this parameter has no effect</FieldLabel>
                                </td>
                            </tr>
                        </>
                    )}
                    </tbody>
                </table>

            </DialogContent>

            <DialogActions className="flex justify-end gap-2 mt-4">
                <Button
                    onClick={onCancel}
                    variant="text"
                >
                    Cancel
                </Button>
                <Button
                    onClick={handleSubmit}
                    variant="filled"
                    color="primary"
                >
                    Save
                </Button>
            </DialogActions>
        </Dialog>
    );
};
