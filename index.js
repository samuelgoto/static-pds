import { TestPds } from "@atproto/dev-env";

//console.log(TestPds);

const pds = await TestPds.create({
   port: 8080,
   inviteRequired: false,
});

console.log("Running");
// console.log(pds);

const client = pds.getClient();

// console.log(client);
// console.log(client.session);
