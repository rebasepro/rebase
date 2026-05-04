import { getChanges } from "./packages/admin/src/form/EntityForm";

const initialValues = {
    content: [
        { type: "text", value: "Initial text" }
    ]
};

const newValues = {
    content: [
        { type: "text", value: "Initial text" },
        { type: "image", value: "test.jpg" }
    ]
};

const changes = getChanges(newValues, initialValues);
console.log("Changes:");
console.log(JSON.stringify(changes, null, 2));

const initialValues2 = {
    content: []
};

const newValues2 = {
    content: [
        { type: "text", value: "test" }
    ]
};

console.log("Changes 2:");
console.log(JSON.stringify(getChanges(newValues2, initialValues2), null, 2));
