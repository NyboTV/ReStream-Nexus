import { exec } from 'child_process';

let publicIp = 'localhost';

export function getPublicIp(): string {
    return publicIp;
}

export function fetchPublicIp(): void {
    exec('curl -s https://api.ipify.org', (error, stdout) => {
        if (!error && stdout) {
            publicIp = stdout.trim();
            console.log('[System] Fetched Public IP:', publicIp);
        } else {
            console.warn('[System] Could not fetch Public IP, using localhost.');
        }
    });
}
