import { createServer, registerRoutes } from './src/http/server';

const app = await createServer();
await registerRoutes(app);
await app.ready();
const res = await app.inject({ method: 'GET', url: '/app/components/__mocks__/with-import.ts' });
console.log(JSON.stringify(res.body));
await app.close();
