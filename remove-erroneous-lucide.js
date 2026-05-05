const fs = require('fs');
const path = require('path');

const files = [
  "packages/client-firebase/src/hooks/useFirebaseStorageSource.ts",
  "packages/client/src/storage.ts",
  "packages/server-core/src/cron/cron-store.ts",
  "packages/server-core/src/storage/S3StorageController.ts",
  "packages/server-core/src/storage/LocalStorageController.ts",
  "packages/server-core/src/storage/types.ts",
  "packages/server-postgresql/src/services/EntityFetchService.ts",
  "packages/server-postgresql/src/services/RelationService.ts",
  "packages/admin/src/util/resolutions.ts",
  "packages/admin/src/hooks/navigation/useNavigationResolution.ts",
  "packages/server-postgresql/src/auth/services.ts",
  "packages/common/src/util/permissions.test.ts",
  "packages/common/test/permissions.test.ts",
  "packages/auth/src/hooks/useBackendUserManagement.ts",
  "packages/auth/src/hooks/useRebaseAuthController.ts",
  "packages/auth/src/types.ts",
  "packages/core/src/hooks/useBackendStorageSource.ts",
  "packages/core/src/hooks/useAuthSubscription.ts",
  "packages/types/src/controllers/storage.ts",
  "packages/types/src/types/properties.ts",
  "packages/types/src/types/collections.ts"
];

for (const file of files) {
  const filePath = path.join('/Users/francesco/rebase', file);
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(/^import \{ [^}]+ \} from "lucide-react";\n/m, '');
  fs.writeFileSync(filePath, content);
  console.log(`Cleaned ${file}`);
}
