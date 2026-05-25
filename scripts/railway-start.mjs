import { spawn } from 'node:child_process';

const serviceName = String(process.env.RAILWAY_SERVICE_NAME || '').toLowerCase();
const serviceId = String(process.env.RAILWAY_SERVICE_ID || '').toLowerCase();
const port = process.env.PORT || '3000';

const isWebService =
  serviceName === 'web' ||
  serviceName.includes('web') ||
  serviceId === 'a564609a-40bf-43f5-a273-dc5a4a2401b2' ||
  Boolean(process.env.NEXT_PUBLIC_API_URL);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: process.env });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) reject(new Error(`${command} ${args.join(' ')} exited with signal ${signal}`));
      else if (code) reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      else resolve();
    });
  });
}

if (isWebService) {
  await run('npm', ['run', 'start', '--workspace=apps/web', '--', '-p', port]);
} else {
  await run('npm', ['run', 'db:migrate:deploy', '--workspace=apps/api']);
  await run('npm', ['run', 'start', '--workspace=apps/api']);
}
