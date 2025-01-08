import { TestPds } from "@atproto/dev-env";

const port = process.env.PORT || 8080;
const hostname = process.env.HOSTNAME || `localhost`;
const domains = process.env.DOMAINS || ".test";

const pds = await TestPds.create({
  port: port,
  hostname: hostname,
  serviceHandleDomains: [domains],
});

console.log(`Running on ${hostname}.`);
