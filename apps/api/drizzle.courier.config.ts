import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/courier-schema.ts',
  out: './drizzle/courier',
});
