import type { FieldProps } from "../../types/fields";
import type { GeopointProperty } from "@rebasepro/types";
import React, { useCallback, useEffect, useState } from "react";
import { IconButton, TextField, Trash2Icon } from "@rebasepro/ui";

import { FieldHelperText } from "../components/FieldHelperText";
import { LabelWithIcon } from "../components/LabelWithIcon";
import { useClearRestoreValue } from "../useClearRestoreValue";
import { PropertyIdCopyTooltip } from "../../components/PropertyIdCopyTooltip";
import { getIconForProperty } from "../../util/property_utils";

/** Latitude runs −90…90, longitude −180…180. Anything else is not a place. */
const LAT_RANGE: [number, number] = [-90, 90];
const LNG_RANGE: [number, number] = [-180, 180];

interface Coordinates { latitude: number; longitude: number }

/**
 * Read whatever the driver handed us as a pair of coordinates.
 *
 * A geopoint arrives as a `GeoPoint` instance from the client, but as a plain
 * object once it has been through JSON — and PostGIS-backed rows may present it
 * as `{ x, y }`, where `x` is the longitude. Reading only one of those shapes
 * would render an empty field over data that is actually there.
 */
export function readCoordinates(value: unknown): Coordinates | null {
    if (!value || typeof value !== "object") return null;
    const v = value as Record<string, unknown>;

    const lat = typeof v.latitude === "number" ? v.latitude : (typeof v.y === "number" ? v.y : undefined);
    const lng = typeof v.longitude === "number" ? v.longitude : (typeof v.x === "number" ? v.x : undefined);

    if (typeof lat !== "number" || typeof lng !== "number") return null;
    return { latitude: lat, longitude: lng };
}

const inRange = (n: number, [min, max]: [number, number]) => n >= min && n <= max;

/**
 * Field binding for `type: "geopoint"`.
 *
 * The model has defined this type all along and the admin had no way to render
 * it: the widget lookup fell off the end of its chain, logged to the console
 * and returned undefined, so the field simply did not appear on the form. A
 * geopoint column was invisible in the admin panel, and unreachable in the
 * property editor.
 *
 * Two number inputs rather than a map. A map needs a tile provider, which means
 * a network dependency and an API key, and neither belongs in a field binding
 * that has to work offline and in every deployment. Coordinates are typed,
 * pasted and copied far more often than they are dropped on a map.
 *
 * @group Form fields
 */
export function GeopointFieldBinding({
    propertyKey,
    value,
    setValue,
    error,
    showError,
    disabled,
    autoFocus,
    property,
    includeDescription,
    hideLabel,
    size = "large"
}: FieldProps<GeopointProperty>) {

    const coordinates = readCoordinates(value);

    // Held as text while editing: a half-typed "-" or "12." is not a number
    // yet, and rounding it through `Number` on every keystroke fights the user.
    const [latText, setLatText] = useState(() => coordinates ? String(coordinates.latitude) : "");
    const [lngText, setLngText] = useState(() => coordinates ? String(coordinates.longitude) : "");

    useEffect(() => {
        const next = readCoordinates(value);
        setLatText(next ? String(next.latitude) : "");
        setLngText(next ? String(next.longitude) : "");
    }, [coordinates?.latitude, coordinates?.longitude]);

    useClearRestoreValue({ property, value, setValue });

    const commit = useCallback((rawLat: string, rawLng: string) => {
        // Both empty means "no location", which is different from 0,0 — a real
        // point in the Gulf of Guinea, and the classic way a cleared field
        // turns into a wrong one.
        if (rawLat.trim() === "" && rawLng.trim() === "") {
            setValue(null);
            return;
        }
        // One side filled and the other still empty is a location half typed,
        // not a location. Committing it would send the empty side through
        // `Number("")`, which is 0 and perfectly finite — so typing a latitude
        // and pausing used to write longitude 0 and drop the point in the Gulf
        // of Guinea. Hold until both sides are there; `halfEntered` below says
        // so in the meantime.
        if (rawLat.trim() === "" || rawLng.trim() === "") return;

        const latitude = Number(rawLat);
        const longitude = Number(rawLng);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        setValue({ latitude, longitude } as never);
    }, [setValue]);

    const handleClear = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        setLatText("");
        setLngText("");
        setValue(null);
    }, [setValue]);

    const latNumber = Number(latText);
    const lngNumber = Number(lngText);
    const latInvalid = latText.trim() !== "" && (!Number.isFinite(latNumber) || !inRange(latNumber, LAT_RANGE));
    const lngInvalid = lngText.trim() !== "" && (!Number.isFinite(lngNumber) || !inRange(lngNumber, LNG_RANGE));

    // One side filled and the other empty is not a point.
    const halfEntered = (latText.trim() === "") !== (lngText.trim() === "");

    const localError = latInvalid
        ? `Latitude must be between ${LAT_RANGE[0]} and ${LAT_RANGE[1]}`
        : lngInvalid
            ? `Longitude must be between ${LNG_RANGE[0]} and ${LNG_RANGE[1]}`
            : halfEntered
                ? "A location needs both a latitude and a longitude"
                : undefined;

    return (
        <div className="flex flex-col gap-2 w-full">
            {/* Label only, and only when there is one: a row that survives
                `hideLabel` still spends its `mb-1` and the column's `gap-2`, so
                the pair of inputs sat below the control next to them even
                though the two labels were level. */}
            {!hideLabel && <div className="flex items-center justify-between mb-1">
                <LabelWithIcon
                    icon={getIconForProperty(property, "small")}
                    required={property.validation?.required}
                    title={property.name ?? propertyKey}
                />
            </div>}

            <PropertyIdCopyTooltip propertyKey={propertyKey}>
                {/* Clear sits beside the inputs rather than above them, so
                    entering a location does not grow the field by a row and
                    knock it out of line with its neighbour. */}
                <div className="flex gap-4 w-full items-center">
                    <TextField
                        className="flex-1"
                        size={size}
                        label="Latitude"
                        value={latText}
                        autoFocus={autoFocus}
                        disabled={disabled}
                        error={showError ? Boolean(error) || latInvalid : latInvalid}
                        onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                            setLatText(e.target.value);
                            commit(e.target.value, lngText);
                        }}
                        placeholder="e.g. 41.3874"
                        inputClassName="font-mono"
                    />
                    <TextField
                        className="flex-1"
                        size={size}
                        label="Longitude"
                        value={lngText}
                        disabled={disabled}
                        error={showError ? Boolean(error) || lngInvalid : lngInvalid}
                        onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                            setLngText(e.target.value);
                            commit(latText, e.target.value);
                        }}
                        placeholder="e.g. 2.1686"
                        inputClassName="font-mono"
                    />
                    {!disabled && (latText || lngText) && (
                        <IconButton
                            size="small"
                            onClick={handleClear}
                            className="shrink-0 text-text-secondary hover:text-red-500"
                            aria-label="Clear location"
                        >
                            <Trash2Icon size={14}/>
                        </IconButton>
                    )}
                </div>
            </PropertyIdCopyTooltip>

            <FieldHelperText
                includeDescription={includeDescription}
                showError={showError || Boolean(localError)}
                error={error || localError}
                disabled={disabled}
                property={property}
            />
        </div>
    );
}
