import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { systemClock } from './time.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const app = createApp({ db, clock: systemClock, config });

const server = app.listen(config.port, () => {
  console.log(`bank listening on :${config.port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
