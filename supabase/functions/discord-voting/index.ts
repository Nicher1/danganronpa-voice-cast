import { createHandler } from "./handler.mjs";

Deno.serve(createHandler({
  // Public application identifiers, not credentials. Environment overrides support other deployments.
  publicKey: Deno.env.get("DISCORD_PUBLIC_KEY") || "73cc3b49fb270c9ab5a82613b8104ebab9f3a56ae8a096f86174e4b1f47dceaa",
  applicationId: Deno.env.get("DISCORD_APPLICATION_ID") || "1563530017814614138",
  supabaseUrl: Deno.env.get("SUPABASE_URL"),
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  waitUntil: (task: Promise<unknown>) => EdgeRuntime.waitUntil(task),
}));
