# @rebasepro/forms

Lightweight React form state management with undo/redo support.

## Installation

```bash
pnpm add @rebasepro/forms
```

ESM-only: `"type": "module"` with no CommonJS build, so it is loaded with
`import`. `require()` of it resolves only on Node 22.12+, which supports
`require(esm)`.

**Peer dependencies:** `react >= 19.0.0`, `react-dom >= 19.0.0`

## What This Package Does

Formex is a minimal, Formik-inspired form library used throughout the Rebase admin panel. It manages form values, validation, touched/dirty state, submission, and provides built-in undo/redo history tracking. It uses `fast-equals` for deep equality checks and avoids unnecessary re-renders.

## Key Exports

| Export | Type | Description |
|---|---|---|
| `useCreateFormex<T>` | Hook | Creates a `FormexController` — the primary way to initialize a form |
| `Formex` | Component | Context provider — wraps children to share form state via `useFormex` |
| `useFormex<T>` | Hook | Consumes the nearest `Formex` context, returns `FormexController<T>` |
| `Field` | Component | Connects an input to the form by `name`. Supports render-prop children, `as` prop, checkbox/radio/select types |
| `FormexController<T>` | Type | The full form controller object (values, errors, touched, dirty, submit, undo/redo, etc.) |
| `FormexResetProps<T>` | Type | Options for `resetForm()` (values, errors, touched, submitCount) |
| `getIn` | Utility | Deep-get a value from an object by dot/bracket path |
| `setIn` | Utility | Immutably deep-set a value in an object by path |

### `useCreateFormex` Options

| Option | Type | Default | Description |
|---|---|---|---|
| `initialValues` | `T` | *required* | Starting form values |
| `initialErrors` | `Record<string, string>` | `{}` | Pre-set field errors |
| `initialDirty` | `boolean` | `false` | Initial dirty flag |
| `initialTouched` | `Record<string, boolean>` | `{}` | Pre-set touched fields |
| `validation` | `(values: T) => Record<string, string> \| Promise<...> \| void` | — | Sync or async validation function |
| `validateOnChange` | `boolean` | `false` | Run validation on every field change |
| `validateOnInitialRender` | `boolean` | `false` | Run validation on mount |
| `onSubmit` | `(values: T, controller) => void \| Promise<void>` | — | Submit handler |
| `onReset` | `(controller) => void \| Promise<void>` | — | Reset callback |
| `onValuesChangeDeferred` | `(values: T, controller) => void` | — | Debounced (300ms) callback on value changes |
| `debugId` | `string` | — | Optional identifier for debugging |

### `FormexController<T>` Properties

| Property | Type | Description |
|---|---|---|
| `values` | `T` | Current form values |
| `initialValues` | `T` | The initial values the form was created with |
| `errors` | `Record<string, string>` | Current validation errors |
| `touched` | `Record<string, boolean>` | Which fields have been touched |
| `dirty` | `boolean` | Whether values differ from initial |
| `isSubmitting` | `boolean` | Whether the form is currently submitting |
| `isValidating` | `boolean` | Whether validation is running |
| `submitCount` | `number` | How many times submit has been called |
| `version` | `number` | Incremented on submit and reset |
| `canUndo` / `canRedo` | `boolean` | Whether undo/redo is available |
| `setValues`, `setFieldValue`, `setFieldError`, `setFieldTouched`, `setDirty`, `setSubmitting`, `setTouched`, `setSubmitCount` | Functions | State setters |
| `handleChange`, `handleBlur`, `handleSubmit` | Event handlers | Bind to form/input events |
| `validate`, `resetForm`, `undo`, `redo` | Functions | Form actions |

## Quick Start

```tsx
import { useCreateFormex, Formex, useFormex, Field } from "@rebasepro/forms";

function MyForm() {
    const controller = useCreateFormex({
        initialValues: { name: "", email: "" },
        validation: (values) => {
            const errors: Record<string, string> = {};
            if (!values.name) errors.name = "Required";
            return errors;
        },
        onSubmit: async (values) => {
            await saveToAPI(values);
        }
    });

    return (
        <Formex value={controller}>
            <form onSubmit={controller.handleSubmit}>
                <Field name="name" />
                <Field name="email" type="email" />
                <button type="submit" disabled={controller.isSubmitting}>
                    Save
                </button>
            </form>
        </Formex>
    );
}

// In a child component:
function SubmitButton() {
    const { isSubmitting, dirty } = useFormex();
    return <button type="submit" disabled={isSubmitting || !dirty}>Save</button>;
}
```

## Related Packages

- `@rebasepro/cms` — Uses Formex for all snapshot editing forms
- `@rebasepro/app` — Core Rebase framework
