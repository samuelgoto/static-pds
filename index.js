import { TestPds } from "@atproto/dev-env";

const port = process.env.PORT || 8080;
const hostname = process.env.HOSTNAME || `localhost`;

const pds = await TestPds.create({
  port: port,
  hostname: hostname,
});

console.log(`Running on ${hostname}.`);
