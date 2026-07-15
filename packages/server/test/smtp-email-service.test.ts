import { SMTPEmailService } from "../src/email/smtp-email-service";
import nodemailer from "nodemailer";

jest.mock("nodemailer", () => {
    const mockTransporter = {
        verify: jest.fn().mockResolvedValue(true),
        sendMail: jest.fn().mockResolvedValue(true)
    };
    return {
        createTransport: jest.fn().mockReturnValue(mockTransporter)
    };
});

describe("SMTPEmailService", () => {
    let mockCreateTransport: jest.Mock;
    let mockTransporter: any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockCreateTransport = nodemailer.createTransport as jest.Mock;
        mockTransporter = mockCreateTransport({} as any); // gets the mocked object
        mockCreateTransport.mockClear();
    });

    it("should create transport with explicit name", async () => {
        const service = new SMTPEmailService({
            from: "test@example.com",
            smtp: {
                host: "smtp.example.com",
                port: 587,
                name: "explicit-hostname"
            }
        });
        // The transporter is created lazily on first use
        await service.verifyConnection();

        expect(mockCreateTransport).toHaveBeenCalledWith(
            expect.objectContaining({
                name: "explicit-hostname",
                host: "smtp.example.com",
                port: 587
            })
        );
    });

    it("should infer name from FRONTEND_URL if smtp.name is undefined", async () => {
        const originalFrontendUrl = process.env.FRONTEND_URL;
        process.env.FRONTEND_URL = "https://frontend-url.com/some-path";

        try {
            const service = new SMTPEmailService({
                from: "test@example.com",
                smtp: {
                    host: "smtp.example.com",
                    port: 587
                }
            });
            await service.verifyConnection();

            expect(mockCreateTransport).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: "frontend-url.com"
                })
            );
        } finally {
            process.env.FRONTEND_URL = originalFrontendUrl;
        }
    });

    it("should infer name from resetPasswordUrl if FRONTEND_URL and smtp.name are undefined", async () => {
        const originalFrontendUrl = process.env.FRONTEND_URL;
        delete process.env.FRONTEND_URL;

        try {
            const service = new SMTPEmailService({
                from: "test@example.com",
                smtp: {
                    host: "smtp.example.com",
                    port: 587
                },
                resetPasswordUrl: "http://reset-password-url.org"
            });
            await service.verifyConnection();

            expect(mockCreateTransport).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: "reset-password-url.org"
                })
            );
        } finally {
            process.env.FRONTEND_URL = originalFrontendUrl;
        }
    });

    it("should infer name from verifyEmailUrl if FRONTEND_URL, resetPasswordUrl and smtp.name are undefined", async () => {
        const originalFrontendUrl = process.env.FRONTEND_URL;
        delete process.env.FRONTEND_URL;

        try {
            const service = new SMTPEmailService({
                from: "test@example.com",
                smtp: {
                    host: "smtp.example.com",
                    port: 587
                },
                verifyEmailUrl: "verify-email-url.net/auth"
            });
            await service.verifyConnection();

            expect(mockCreateTransport).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: "verify-email-url.net"
                })
            );
        } finally {
            process.env.FRONTEND_URL = originalFrontendUrl;
        }
    });

    it("should leave name undefined if no URLs are provided", async () => {
        const originalFrontendUrl = process.env.FRONTEND_URL;
        delete process.env.FRONTEND_URL;

        try {
            const service = new SMTPEmailService({
                from: "test@example.com",
                smtp: {
                    host: "smtp.example.com",
                    port: 587
                }
            });
            await service.verifyConnection();

            expect(mockCreateTransport).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: undefined
                })
            );
        } finally {
            process.env.FRONTEND_URL = originalFrontendUrl;
        }
    });

    it("should successfully verify SMTP connection", async () => {
        mockTransporter.verify.mockResolvedValueOnce(true);

        const service = new SMTPEmailService({
            from: "test@example.com",
            smtp: {
                host: "smtp.example.com",
                port: 587
            }
        });

        const verified = await service.verifyConnection();
        expect(verified).toBe(true);
        expect(mockTransporter.verify).toHaveBeenCalled();
    });

    it("should return false if SMTP connection verification fails", async () => {
        mockTransporter.verify.mockRejectedValueOnce(new Error("Connection timeout"));

        const service = new SMTPEmailService({
            from: "test@example.com",
            smtp: {
                host: "smtp.example.com",
                port: 587
            }
        });

        const verified = await service.verifyConnection();
        expect(verified).toBe(false);
        expect(mockTransporter.verify).toHaveBeenCalled();
    });
});
