import { startStandaloneServer } from "./index.js";

startStandaloneServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
