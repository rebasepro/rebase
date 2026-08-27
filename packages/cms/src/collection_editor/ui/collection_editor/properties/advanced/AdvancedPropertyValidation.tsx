import React from "react";

import { Field, FormexFieldProps } from "@rebasepro/forms";
import { SwitchControl } from "../../SwitchControl";

export function AdvancedPropertyValidation({ disabled }: {
    disabled: boolean
}) {

    // `ui` was renamed to `admin` in 0.11. Nothing reads `ui.*` — the toggles did
    // nothing — and the boot validator treats the old name as a removed key, so a
    // save through here left a project that would not start.
    const hideFromCollection = "admin.hideFromCollection";
    const readOnly = "admin.readOnly";

    return (

        <div className={"grid grid-cols-12 gap-2"}>
            <div className={"col-span-12"}>
                <Field type="checkbox" name={hideFromCollection}>
                    {({ field, form }: FormexFieldProps) => {
                        return <SwitchControl
                            label={"Hide from collection"}
                            size={"small"}
                            disabled={disabled}
                            form={form}
                            tooltip={"Hide this field from the collection view. It will still be visible in the form view"}
                            field={field}/>
                    }}
                </Field>
            </div>

            <div className={"col-span-12"}>
                <Field name={readOnly}
                    type="checkbox">
                    {({ field, form }: FormexFieldProps) => {
                        return <SwitchControl
                            label={"Read only"}
                            size={"small"}
                            disabled={disabled}
                            tooltip={"Is this a read only field. Display only as a preview"}
                            form={form}
                            field={field}/>
                    }}
                </Field>
            </div>
        </div>
    );
}
