import { DataType } from "@rebasepro/types";

export function getInferenceType(value: any): DataType {
    // `typeof null === "object"`, so a null or empty CSV cell used to fall past
    // every check and land on "map" — an empty cell described as a nested object.
    // `inferTypeFromValue` in @rebasepro/inference already answers "string" here;
    // the two entry points into inference have to agree.
    if (value === null || value === undefined)
        return "string";
    if (typeof value === "number")
        return "number";
    else if (typeof value === "string")
        return "string";
    else if (typeof value === "boolean")
        return "boolean";
    else if (value instanceof Date)
        return "date";
    else if (Array.isArray(value))
        return "array";
    return "map";
}


function isUnixTimestamp(num: number): boolean {
    const numString = num.toString();
    // check if the number has 13 digits
    const isLengthValid = numString.length === 13;

    // check if it falls in the expected Unix timestamp range (from 1970 to 2100)
    const isInRange = num >= 0 && num <= 4102444800000;

    return isLengthValid && isInRange;
}
