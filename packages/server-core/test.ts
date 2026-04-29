interface I {
    verify: (payload: any) => void;
}
const obj: I = {
    verify: (payload: { code: string }) => {}
};
