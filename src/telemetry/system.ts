/**
 * @file System Telemetry Generator
 * Handles the generation of simulated system metrics (processes, network, logs).
 */

export interface SystemTelemetryState {
    cycle: number;
}

const state: SystemTelemetryState = {
    cycle: 0
};

/**
 * Updates the Process List (Simulated top/htop).
 * @param isProvisioning - If true, shows provisioning logs instead of process list.
 */
export function renderProcessList(isProvisioning: boolean): void {
    const procEl: HTMLElement | null = document.getElementById('tele-proc');
    const procHeader = procEl?.parentElement?.querySelector('.tele-header');
    
    if (!procEl) return;

    if (isProvisioning) {
        if (procHeader) procHeader.textContent = "PROVISIONING RESOURCES";
        const steps = [
            "Allocating GPU nodes (g4dn.xlarge)...",
            "Pulling container images (pytorch:1.13)...",
            "Mounting virtual volumes (/cohort/training)...",
            "Verifying CUDA drivers...",
            " establishing secure tunnels..."
        ];
        const step = steps[Math.floor(Math.random() * steps.length)];
        procEl.innerHTML = `<span class="highlight">${step}</span>\n<span class="dim">Queue position: 1</span>`;
    } else {
        if (procHeader) procHeader.textContent = "ACTIVE PROCESSES (K8S)";
        const procs = [
            { pid: 1492, usr: 'root', cpu: (Math.random() * 80).toFixed(1), mem: '1.2', cmd: 'kube-apiserver' },
            { pid: 1503, usr: 'root', cpu: (Math.random() * 40).toFixed(1), mem: '4.5', cmd: 'etcd' },
            { pid: 8821, usr: 'atlas', cpu: (Math.random() * 95).toFixed(1), mem: '12.4', cmd: 'python3 train.py' },
            { pid: 2201, usr: 'root', cpu: (Math.random() * 10).toFixed(1), mem: '0.8', cmd: 'containerd' },
            { pid: 3392, usr: 'atlas', cpu: (Math.random() * 5).toFixed(1), mem: '0.4', cmd: 'argus-agent' }
        ];
        
        // Sort by CPU
        procs.sort((a, b) => parseFloat(b.cpu) - parseFloat(a.cpu));
        
        let html = '<span class="dim">  PID USER     %CPU %MEM COMMAND</span>\n';
        procs.forEach(p => {
            const cpuClass = parseFloat(p.cpu) > 80 ? 'warn' : 'highlight';
            html += `<span class="${cpuClass}">${p.pid.toString().padEnd(5)} ${p.usr.padEnd(8)} ${p.cpu.padStart(4)} ${p.mem.padStart(4)} ${p.cmd}</span>\n`;
        });
        procEl.innerHTML = html;
    }
}

/**
 * Updates Network Stats (Simulated ifconfig).
 */
export function renderNetworkStats(): void {
    state.cycle++;
    const netEl: HTMLElement | null = document.getElementById('tele-net');
    if (!netEl) return;

    const eth0_rx = (42 + state.cycle * 0.1 + Math.random()).toFixed(2);
    const eth0_tx = (12 + state.cycle * 0.05 + Math.random()).toFixed(2);
    const tun0_rx = (8 + Math.random() * 2).toFixed(2);
    
    let html = '<span class="dim">IFACE    RX (GB)   TX (GB)   STATUS</span>\n';
    html += `eth0     ${eth0_rx.padStart(7)}   ${eth0_tx.padStart(7)}   <span class="highlight">UP 1000Mb</span>\n`;
    html += `tun0     ${tun0_rx.padStart(7)}   0008.12   <span class="highlight">UP VPN</span>\n`;
    html += `docker0  0042.11   0041.88   <span class="dim">UP</span>\n`;
    netEl.innerHTML = html;
}

/**
 * Updates System Logs (Scrolling text).
 */
export function renderSystemLogs(): void {
    const logEl: HTMLElement | null = document.getElementById('tele-log');
    if (!logEl) return;

    const events = [
        '[KERN] Tainted: P           O      5.15.0-1031-aws #35~20.04.1',
        '[AUTH] pam_unix(sshd:session): session opened for user atlas',
        '[K8S ] Pod/default/trainer-x86-04 scheduled on node-04',
        '[NET ] eth0: promiscuous mode enabled',
        '[WARN] GPU-0: Temperature 82C, fan speed 100%',
        '[INFO] ATLAS Federation Link: Heartbeat received from MGH',
        '[INFO] ATLAS Federation Link: Heartbeat received from BCH',
        '[AUDIT] User access granted: dev-001 from 10.0.4.2'
    ];
    
    // Pick a random event occasionally
    if (Math.random() > 0.7) {
        const time = new Date().toISOString().split('T')[1].slice(0,8);
        const event = events[Math.floor(Math.random() * events.length)];
        const line = `${time} ${event}`;
        
        // Append and scroll
        const lines = (logEl.innerText + '\n' + line).split('\n').slice(-5); // Keep last 5 lines
        logEl.innerText = lines.join('\n');
    }
}
