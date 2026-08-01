import readline from "readline";
import { getDevDatabaseUrl, getTableIncludesFromCollections, promptConfirm } from "../src/cli-helpers";

jest.mock("readline");

describe("promptConfirm", () => {
    const realIsTTY = process.stdin.isTTY;
    let question: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        question = jest.fn();
        (readline.createInterface as jest.Mock).mockReturnValue({
            question,
            close: jest.fn()
        });
    });

    afterEach(() => {
        Object.defineProperty(process.stdin, "isTTY", { value: realIsTTY, configurable: true });
    });

    const setTTY = (value: boolean | undefined) => {
        Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
    };

    // This guard is the last thing between `db push --` in CI and an
    // unattended destructive migration. A non-TTY stdin cannot answer, so
    // returning `true` there would silently auto-confirm every prompt; and
    // readline must not even be opened, or the process hangs on a pipe that
    // never closes instead of exiting.
    it.each([[false], [undefined]])("refuses without prompting when isTTY is %s", async (isTTY) => {
        setTTY(isTTY as boolean | undefined);

        await expect(promptConfirm("apply destructive changes? ")).resolves.toBe(false);
        expect(readline.createInterface).not.toHaveBeenCalled();
    });

    // The mirror image: without this, "always return false" would satisfy the
    // assertions above and the prompt would be dead code.
    it("asks on a TTY and accepts an affirmative answer", async () => {
        setTTY(true);
        question.mockImplementation((_q: string, cb: (answer: string) => void) => cb(" YES "));

        await expect(promptConfirm("apply? ")).resolves.toBe(true);
        expect(readline.createInterface).toHaveBeenCalledTimes(1);
    });

    it("asks on a TTY and refuses anything else", async () => {
        setTTY(true);
        question.mockImplementation((_q: string, cb: (answer: string) => void) => cb("no"));

        await expect(promptConfirm("apply? ")).resolves.toBe(false);
    });
});

describe("CLI Helpers", () => {
    describe("getDevDatabaseUrl", () => {
        it("should parse standard postgres URL and append _dev_diff", () => {
            const dbUrl = "postgresql://user:pass@localhost:5432/my_db";
            expect(getDevDatabaseUrl(dbUrl)).toBe("postgresql://user:pass@localhost:5432/my_db_dev_diff");
        });

        it("should parse postgres URL with query parameters", () => {
            const dbUrl = "postgresql://user:pass@localhost:5432/my_db?sslmode=disable";
            expect(getDevDatabaseUrl(dbUrl)).toBe("postgresql://user:pass@localhost:5432/my_db_dev_diff?sslmode=disable");
        });

        it("should fall back to simple string concatenation on invalid URL", () => {
            const dbUrl = "invalid-url-string";
            expect(getDevDatabaseUrl(dbUrl)).toBe("invalid-url-string_dev_diff");
        });
    });

    describe("getTableIncludesFromCollections", () => {
        it("should parse collections and return correct includes array", async () => {
            const mockCollections = [
                {
                    slug: "users",
                    table: "users",
                    properties: {
                        name: { type: "string" }
                    }
                },
                {
                    slug: "posts",
                    table: "posts",
                    properties: {
                        title: { type: "string" }
                    },
                    relations: [
                        {
                            kind: "manyToMany",
                            relationName: "tags",
                            target: () => ({ table: "tags", slug: "tags" }),
                            through: {
                                table: "posts_to_tags",
                                sourceColumn: "post_id",
                                targetColumn: "tag_id"
                            }
                        }
                    ]
                }
            ];

            const includes = await getTableIncludesFromCollections(mockCollections);
            expect(includes).toContain("public.users");
            expect(includes).toContain("public.posts");
            expect(includes).toContain("public.posts_to_tags");
        });
    });
});
