declare module "json-logic-js" {
    interface JsonLogic {
        apply(logic: unknown, data?: unknown): unknown;
        add_operation<T extends any[]>(name: string, fn: (...args: T) => unknown): void;
    }
    const jsonLogic: JsonLogic;
    export default jsonLogic;
}
