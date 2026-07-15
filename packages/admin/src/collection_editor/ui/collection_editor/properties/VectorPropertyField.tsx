import { FieldCaption } from "../../../_cms_internals";
import React from "react";
import { TextField } from "@rebasepro/ui";
import { getIn, useFormex } from "@rebasepro/forms";

export function VectorPropertyField({ disabled }: {
    disabled: boolean;
}) {
    const { values, setFieldValue, touched, errors } = useFormex();

    const dimensionsPath = "dimensions";
    const dimensionsValue = getIn(values, dimensionsPath) as number | undefined;
    const dimensionsError = (getIn(touched, dimensionsPath) && getIn(errors, dimensionsPath)) as string | undefined;

    return (
        <div className={"col-span-12"}>
            <TextField
                name={dimensionsPath}
                disabled={disabled}
                type={"number"}
                onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                    const parsedVal = parseInt(e.target.value);
                    setFieldValue(dimensionsPath, isNaN(parsedVal) ? undefined : parsedVal);
                }}
                label={"Vector Dimensions"}
                value={dimensionsValue ?? ""}
                error={Boolean(dimensionsError)}
            />
            <FieldCaption error={Boolean(dimensionsError)}>
                {dimensionsError ?? "The dimension size of the vector embeddings (e.g., 1536 for OpenAI text-embedding-3-small)."}
            </FieldCaption>
        </div>
    );
}
