/**
 * Mock worker for testing ClusterManager
 * This worker just starts up and responds to shutdown signals
 */

// Simulate worker startup
console.log(`Mock worker ${process.pid} started`);
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

// Keep process alive
setInterval(() => {
    // Mock work
}, 500);
