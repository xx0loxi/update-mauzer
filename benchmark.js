const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const tabsArg = process.argv.find(arg => arg.startsWith('--tabs='));
const isLowEndArg = process.argv.includes('--low-end');

const TABS_TO_OPEN = tabsArg ? parseInt(tabsArg.split('=')[1], 10) : 20;
const LOW_END_SIMULATION = isLowEndArg;

console.log(`=========================================`);
console.log(`🚀 MAUZER BROWSER BENCHMARK TOOL 🚀`);
console.log(`=========================================`);
console.log(`Tabs to open: ${TABS_TO_OPEN}`);
console.log(`Low-End Simulation: ${LOW_END_SIMULATION ? 'ON' : 'OFF'}`);
console.log(`System RAM: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`);
console.log(`System Cores: ${os.cpus().length}`);
console.log(`=========================================\n`);

console.log(`[1] Launching Mauzer Browser...`);

const env = { ...process.env };
if (LOW_END_SIMULATION) {
    env.SIMULATE_LOW_END = '1';
}

// Pass the --benchmark flag so the main.js knows it's a test
// Isolated temp profile: real user data is never touched and the run does
// not collide with the single-instance lock of an already-open Mauzer
const benchUserData = path.join(os.tmpdir(), `mauzer-bench-${Date.now()}`);
const browserProcess = spawn('npx', ['electron', '.', `--benchmark=${TABS_TO_OPEN}`, `--user-data-dir=${benchUserData}`], {
    env,
    shell: true,
    cwd: __dirname
});

browserProcess.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
        const lines = output.split('\n');
        for (const line of lines) {
            // Only print benchmark specific logs or warnings
            if (line.includes('[Benchmark]')) {
                console.log(line);
            } else if (line.includes('[Mauzer] Windows 7 or Low-End PC detected')) {
                console.log(`⚠️  ${line}`);
            }
        }
    }
});

browserProcess.stderr.on('data', (data) => {
    // Ignore stderr to keep output clean, unless you want to debug crashes
});

browserProcess.on('close', (code) => {
    console.log(`\n[!] Browser closed with code ${code}. Benchmark finished.`);
});

console.log(`[2] Waiting for browser to load and report metrics...\n`);
console.log(`(Do not close this terminal. The test will run for ~20 seconds and print results.)\n`);
