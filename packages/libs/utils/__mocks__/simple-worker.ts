/**
 * Simple mock worker for integration testing ClusterManager
 * This worker just starts up and responds to shutdown signals
 */

// Simulate worker startup
console.log(`Worker ${process.pid} started`);

// Handle shutdown signals
process.on('SIGTERM', () => {
    console.log(`Worker ${process.pid} received SIGTERM, exiting...`);
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log(`Worker ${process.pid} received SIGINT, exiting...`);
    process.exit(0);
});

// Keep process alive
setInterval(() => {
    // Mock work
}, 1000);
