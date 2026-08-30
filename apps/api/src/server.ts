import { buildApp } from "./app";

const app = await buildApp({ logger: true });
const port = Number(process.env.API_PORT || 3101);
try { await app.listen({ port, host: "0.0.0.0" }); }
catch (error) { app.log.error(error); process.exit(1); }
