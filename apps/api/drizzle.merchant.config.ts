import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/merchant-schema.ts',
  out: './drizzle/merchant',
});
