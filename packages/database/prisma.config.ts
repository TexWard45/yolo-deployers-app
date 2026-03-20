import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

function findEnvFile(dir: string): string {
  const envPath = path.join(dir, ".env");
  if (fs.existsSync(envPath)) return envPath;
  const parent = path.dirname(dir);
  if (parent === dir) return envPath;
  return findEnvFile(parent);
}

dotenv.config({ path: findEnvFile(process.cwd()) });

export default defineConfig({
  schema: path.join(__dirname, "prisma"),
  datasource: {
    url: process.env.DATABASE_URL!,
  },
  migrate: {
    url: process.env.DATABASE_URL!,
  },
});
