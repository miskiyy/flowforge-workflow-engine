process.env.NODE_ENV ??= 'test';
process.env.JWT_SECRET ??= 'test-only-secret-do-not-use-in-production';
process.env.DATABASE_URL ??= 'postgres://flowforge:local_dev_only@localhost:5433/flowforge';
