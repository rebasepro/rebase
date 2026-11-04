/**
 * A submit whose `onSubmit` throws still ends.
 *
 * `isSubmitting` was cleared only after `onSubmit` returned, so one that threw
 * — a save callback that rejects, a validation that throws — left the form
 * submitting for good, and a form that disables its fields and its Save button
 * while submitting could not be used again without a reload.
 */
import { act, renderHook } from "@testing-library/react";
import { useCreateFormex } from "@rebasepro/forms";

type Doc = { title: string };

describe("a submit that throws", () => {
    it("is no longer submitting once onSubmit rejects", async () => {
        const { result } = renderHook(() => useCreateFormex<Doc>({
            initialValues: { title: "a" },
            onSubmit: async () => {
                throw new Error("refused");
            }
        }));
        await act(async () => {
            await expect(result.current.handleSubmit()).rejects.toThrow("refused");
        });
        expect(result.current.isSubmitting).toBe(false);
        expect(result.current.submitCount).toBe(1);
    });

    it("is no longer submitting once validation throws", async () => {
        const { result } = renderHook(() => useCreateFormex<Doc>({
            initialValues: { title: "a" },
            validation: () => {
                throw new Error("validator broke");
            }
        }));
        await act(async () => {
            await expect(result.current.handleSubmit()).rejects.toThrow("validator broke");
        });
        expect(result.current.isSubmitting).toBe(false);
    });
});
