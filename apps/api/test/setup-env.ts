// Runs before every integration test file. Points the app at the test database and
// makes sure nothing can touch a real one by accident.
import { resolveTestDatabaseUrl } from './db-url';

const url = resolveTestDatabaseUrl();
process.env.DATABASE_URL = url;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
// The background notification projector scans the whole database on boot; tests do not need it.
process.env.NOTIFICATIONS_WORKER_DISABLED = '1';
