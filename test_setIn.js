const setIn = (obj, path, value) => {
    if (path.length === 0) return value;
    const [head, ...tail] = path;
    const clone = Array.isArray(obj) ? [...obj] : { ...obj };
    clone[head] = setIn(obj[head], tail, value);
    return clone;
};
let editedValues = { arr: [{_ref: "a"}, {_ref: "b"}] };
console.log(JSON.stringify(setIn(editedValues, ["arr", "0"], { _ref: "c" })));
