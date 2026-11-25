import { testEmailConnection } from "../lib/email-service";

// npm run test-email — checks SMTP_USER / SMTP_PASS / REPORT_RECIPIENTS from .env.local.
(async () => {
  const r = await testEmailConnection();
  console.log(r.ok ? `SMTP OK${r.warning ? ` — ${r.warning}` : ""}` : `SMTP failed: ${r.error}`);
  process.exit(r.ok ? 0 : 1);
})();
