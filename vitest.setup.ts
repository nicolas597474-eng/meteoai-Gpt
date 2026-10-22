import { installTestNetworkGuard, sanitizeTestEnvironment } from "./server/testNetworkGuard";

sanitizeTestEnvironment();
installTestNetworkGuard();
