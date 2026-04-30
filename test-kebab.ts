import { toKebabCase } from "./packages/utils/src/strings.ts";

const tests = ["posts", "companyMembers", "talentApplicationStatus", "xY", "leadMagnetSignups", "company-members"];
for (const t of tests) {
  console.log(`${t} -> ${toKebabCase(t)}`);
}
