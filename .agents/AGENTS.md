# Project Rules & Guidelines

## TypeScript and Type Safety
- **NEVER convert to any.**
- Do not use structural or duck-typing type casting (e.g., `driver as { executeSql?: ... }`) as a workaround to bypass `any` restrictions.
- To execute raw SQL on a backend driver, do not cast the driver. Instead, use the `isSQLAdmin` type guard from `@rebasepro/types` to check and narrow `driver.admin`.
- Example of correct pattern:
  ```typescript
  import { isSQLAdmin } from "@rebasepro/types";

  const driver = c.get("driver");
  const admin = driver?.admin;
  if (!isSQLAdmin(admin)) {
      throw new Error("Native SQL execution is not available on the current data driver.");
  }
  const results = await admin.executeSql(sql, params);
  ```
