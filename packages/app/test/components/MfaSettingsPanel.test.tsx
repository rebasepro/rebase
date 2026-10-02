import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { MfaFactorInfo, MfaSettingsController } from "@rebasepro/cms-types";
import { MfaSettingsPanel } from "../../src/components/MfaSettingsPanel";

/**
 * Two-step verification could be finished in the CMS and never set up there:
 * a user enrolled through the SDK or not at all, and lost recovery codes
 * meant SQL. The settings tab enrols an authenticator, lists the factors,
 * removes one and replaces the recovery codes — stepping the session up with a
 * code first whenever the server asks for one.
 */

jest.mock("../../src/hooks", () => {
    const original = jest.requireActual("../../src/hooks");
    return {
        ...original,
        useTranslation: () => ({ t: (key: string) => key })
    };
});

const verified: MfaFactorInfo = { id: "f-1", factorType: "totp", friendlyName: "Phone", verified: true, createdAt: "2026-10-01T10:00:00.000Z" };

function controller(overrides: Partial<MfaSettingsController> = {}): jest.Mocked<MfaSettingsController> {
    return {
        listFactors: jest.fn(async () => [] as MfaFactorInfo[]),
        enroll: jest.fn(async () => ({ factorId: "f-new", secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/App:me?secret=JBSWY3DPEHPK3PXP", recoveryCodes: ["code-1", "code-2"] })),
        verifyEnrollment: jest.fn(async () => undefined),
        removeFactor: jest.fn(async () => undefined),
        regenerateRecoveryCodes: jest.fn(async () => ["fresh-1", "fresh-2"]),
        stepUp: jest.fn(async () => undefined),
        ...overrides
    } as jest.Mocked<MfaSettingsController>;
}

const aal2Required = () => Object.assign(new Error("MFA verification required"), { code: "AAL2_REQUIRED" });

async function renderPanel(mfa: MfaSettingsController) {
    await act(async () => {
        render(<MfaSettingsPanel mfa={mfa}/>);
    });
}

describe("MfaSettingsPanel", () => {
    it("lists the account's factors, saying which are not confirmed", async () => {
        const mfa = controller({
            listFactors: jest.fn(async () => [verified, { id: "f-2", factorType: "totp", verified: false, createdAt: "2026-10-02T10:00:00.000Z" }])
        });
        await renderPanel(mfa);

        expect(screen.getByText("Phone")).toBeInTheDocument();
        expect(screen.getByText("mfa_factor_unconfirmed")).toBeInTheDocument();
    });

    it("enrols an authenticator: shows its key, confirms the code, then shows the recovery codes once", async () => {
        const mfa = controller();
        await renderPanel(mfa);

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "mfa_add_authenticator" }));
        });
        expect(mfa.enroll).toHaveBeenCalled();
        expect(screen.getByText("JBSW Y3DP EHPK 3PXP")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "mfa_open_in_app" })).toHaveAttribute("href", "otpauth://totp/App:me?secret=JBSWY3DPEHPK3PXP");

        fireEvent.change(screen.getByLabelText("auth_mfa_code_label"), { target: { value: "123456" } });
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "mfa_enroll_confirm" }));
        });

        expect(mfa.verifyEnrollment).toHaveBeenCalledWith("f-new", "123456");
        expect(screen.getByText("mfa_recovery_codes_title")).toBeInTheDocument();
        expect(screen.getByText("code-1")).toBeInTheDocument();
        expect(mfa.listFactors).toHaveBeenCalledTimes(2);
    });

    it("asks for a code when the server wants the second factor, then does what was asked", async () => {
        const mfa = controller({
            listFactors: jest.fn(async () => [verified]),
            removeFactor: jest.fn<Promise<void>, [string]>()
                .mockRejectedValueOnce(aal2Required())
                .mockResolvedValueOnce(undefined)
        });
        await renderPanel(mfa);

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "mfa_remove_factor" }));
        });
        expect(screen.getByText("mfa_step_up_title")).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText("auth_mfa_code_label"), { target: { value: "654321" } });
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "auth_mfa_verify" }));
        });

        expect(mfa.stepUp).toHaveBeenCalledWith("f-1", "654321");
        expect(mfa.removeFactor).toHaveBeenCalledTimes(2);
        expect(mfa.removeFactor).toHaveBeenLastCalledWith("f-1");
        expect(screen.queryByText("mfa_step_up_title")).toBeNull();
    });

    it("replaces the recovery codes and shows the new ones", async () => {
        const mfa = controller({ listFactors: jest.fn(async () => [verified]) });
        await renderPanel(mfa);

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "mfa_regenerate_codes" }));
        });

        expect(mfa.regenerateRecoveryCodes).toHaveBeenCalled();
        expect(screen.getByText("fresh-1")).toBeInTheDocument();
    });

    it("offers new recovery codes only with a confirmed factor", async () => {
        await renderPanel(controller());
        expect(screen.queryByRole("button", { name: "mfa_regenerate_codes" })).toBeNull();
        expect(screen.getByText("mfa_no_factors")).toBeInTheDocument();
    });
});
