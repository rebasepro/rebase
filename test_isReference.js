function isReference(value) {
    if (!value || typeof value !== "object") return false;
    if ("_ref" in value) return true;
    if ("_converter" in value && "_firestore" in value && "_path" in value) return true;
    return false;
}
console.log(isReference({ _ref: "test/123" }));
