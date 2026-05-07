export class DatakiException extends Error {
    status: number;
    message: string;
    code?: string;
    data?: object;

    constructor(status: number, message: string, code?: string, data?: object) {
        super(message);
        this.status = status ?? 500;
        this.message = message;
        this.code = code;
        this.data = data;
    }
}
