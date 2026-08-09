
import React, { useCallback, useState } from "react";
import {
    Alert,
    Button,
    cls,
    CodeIcon,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    iconSize,
    TextField,
    Typography
} from "@rebasepro/ui";

import { validateCollectionJson, CollectionValidationError } from "../../validateCollectionJson";
import type { AdminCollection } from "@rebasepro/admin-types";

const EXAMPLE_JSON = `{
  "id": "products",
  "name": "Products",
  "path": "products",
  "icon": "shopping_cart",
  "properties": {
    "name": {
      "type": "string",
      "name": "Name",
      "validation": { "required": true }
    },
    "price": {
      "type": "number",
      "name": "Price"
    },
    "available": {
      "type": "boolean",
      "name": "Available"
    }
  }
}`;

export interface CollectionJsonImportDialogProps {
    open: boolean;
    onClose: () => void;
    onImport: (collection: AdminCollection) => void;
}

export function CollectionJsonImportDialog({
    open,
    onClose,
    onImport
}: CollectionJsonImportDialogProps) {
    const [jsonValue, setJsonValue] = useState<string>("");
    const [errors, setErrors] = useState<CollectionValidationError[]>([]);
    const [touched, setTouched] = useState(false);

    const handleJsonChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const value = e.target.value;
        setJsonValue(value);
        setTouched(true);

        if (!value.trim()) {
            setErrors([]);
            return;
        }

        const result = validateCollectionJson(value);
        setErrors(result.errors);
    }, []);

    const handleImport = useCallback(() => {
        const result = validateCollectionJson(jsonValue);
        if (result.valid && result.collection) {
            onImport(result.collection);
            setJsonValue("");
            setErrors([]);
            setTouched(false);
            onClose();
        }
    }, [jsonValue, onImport, onClose]);

    const handleClose = useCallback(() => {
        setJsonValue("");
        setErrors([]);
        setTouched(false);
        onClose();
    }, [onClose]);

    const isValid = touched && jsonValue.trim() && errors.length === 0;

    return (
        <Dialog
            open={open}
            onOpenChange={(open) => !open && handleClose()}
            maxWidth="2xl"
        >
            <DialogTitle className="flex items-center gap-2">
                <CodeIcon size={iconSize.smallest}/>
                Import Collection from JSON
            </DialogTitle>
            <DialogContent className="flex flex-col gap-4">
                <Typography variant="body2" color="secondary">
                    Paste a JSON object representing your collection configuration.
                    The JSON must include <code className="bg-surface-200 dark:bg-surface-700 px-1 rounded">id</code>,
                    <code className="bg-surface-200 dark:bg-surface-700 px-1 rounded">name</code>,
                    <code className="bg-surface-200 dark:bg-surface-700 px-1 rounded">path</code>, and
                    <code className="bg-surface-200 dark:bg-surface-700 px-1 rounded">properties</code>.
                </Typography>

                <TextField
                    multiline
                    minRows={12}
                    aria-label="Collection JSON"
                    value={jsonValue}
                    onChange={handleJsonChange}
                    placeholder={EXAMPLE_JSON}
                    error={errors.length > 0 && touched}
                    className="w-full"
                    inputClassName="font-mono text-sm resize-none overflow-y-auto h-[300px]"
                />

                {errors.length > 0 && touched && (
                    <Alert color="error">
                        <Typography variant="body2" className="font-medium mb-2">
                            Validation errors:
                        </Typography>
                        <ul className="list-disc list-inside space-y-1">
                            {errors.map((error, index) => (
                                <li key={index} className="text-sm">
                                    {error.path ? (
                                        <>
                                            <code className="bg-red-100 dark:bg-red-900/40 px-1 rounded">
                                                {error.path}
                                            </code>
                                            : {error.message}
                                        </>
                                    ) : (
                                        error.message
                                    )}
                                </li>
                            ))}
                        </ul>
                    </Alert>
                )}

                {isValid && (
                    <Alert color="success">
                        <Typography variant="body2">
                            ✓ JSON is valid and ready to import
                        </Typography>
                    </Alert>
                )}
            </DialogContent>
            <DialogActions>
                <Button
                    variant="text"
                    onClick={handleClose}
                >
                    Cancel
                </Button>
                <Button
                    variant="filled"
                    color="primary"
                    onClick={handleImport}
                    disabled={!isValid}
                >
                    Import Collection
                </Button>
            </DialogActions>
        </Dialog>
    );
}
