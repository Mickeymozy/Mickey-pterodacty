<!DOCTYPE html>
<html lang="sw">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mickey Host pannel - Control Area</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <style>
        .blinking-text { animation: blinker 1.2s linear infinite; }
        @keyframes blinker { 50% { opacity: 0; } }
        .vps-card {
            background: rgba(255, 255, 255, 0.02);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.08);
            transition: all 0.3s ease-in-out;
        }
        .vps-card:hover {
            border-color: #00ffcc;
            transform: translateY(-5px);
            box-shadow: 0 15px 30px rgba(0, 255, 204, 0.1);
        }
    </style>
</head>
<body class="bg-[#0b0f19] text-gray-100 min-h-screen relative overflow-x-hidden">

    <div id="canvas-3d" class="fixed top-0 left-0 w-full h-full -z-10 opacity-20 pointer-events-none"></div>

    <div class="bg-red-500/10 border-b border-red-500/30 text-center py-2 text-xs tracking-wider">
        <span class="blinking-text text-red-500 font-bold mr-1">MFUMO WA DIGITAL:</span> Malipo yanatumia <span class="text-yellow-400 font-semibold">SonicPesa USSD Push</span>. Ingiza namba yako ya simu upokee ombi la siri papo hapo.
    </div>

    <nav class="flex justify-between items-center px-8 py-4 border-b border-white/5 backdrop-blur-md sticky top-0 z-50 bg-[#0b0f19]/90">
        <div class="text-xl font-bold text-[#00ffcc]">Mickey Host.⚡ <span id="admin-badge" class="hidden text-xs bg-red-600 text-white px-2 py-0.5 rounded ml-2 font-mono">ADMIN CONTROL ACTIVE</span></div>
        <div class="flex items-center space-x-6 text-sm">
            <span id="user-display" class="text-gray-400"></span>
            <button onclick="logout()" class="text-red-400 hover:underline">Ondoka (Logout)</button>
        </div>
    </nav>

    <div class="max-w-7xl mx-auto px-4 py-8 space-y-12">
        
        <div>
            <h2 class="text-xl font-bold mb-4 text-[#00ffcc]" id="servers-title">Mali Zako (Active Pterodactyl Servers)</h2>
            <div class="bg-white/5 border border-white/5 rounded-xl p-6 overflow-x-auto">
                <table class="w-full text-left text-sm text-gray-300">
                    <thead class="border-b border-white/5 text-gray-400">
                        <tr>
                            <th class="pb-2" id="th-owner" class="hidden">Mteja</th>
                            <th class="pb-2">Kifurushi</th>
                            <th class="pb-2">Panel URL Host</th>
                            <th class="pb-2">Username</th>
                            <th class="pb-2">Password</th>
                            <th class="pb-2">Port</th>
                        </tr>
                    </thead>
                    <tbody id="server-table-body"></tbody>
                </table>
                <p id="no-servers" class="text-xs text-gray-500 text-center py-4 hidden">Hakuna seva yoyote iliyopatikana kwenye mfumo kwa sasa.</p>
            </div>
        </div>

        <div id="pending-box" class="hidden">
            <h3 class="text-md font-bold mb-3 text-yellow-500" id="pending-title">Miamala Inayosubiri Malipo ya PIN</h3>
            <div id="pending-container" class="space-y-2"></div>
        </div>

        <div id="vps-shop-section">
            <h2 class="text-xl font-bold mb-2 text-center">Chagua Kifurushi Chako cha VPS</h2>
            <p class="text-xs text-gray-400 text-center mb-8">Baada ya kubofya, utatumiwa USSD push kwenye namba utakayoingiza.</p>
            
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div class="vps-card p-6 rounded-xl flex flex-col justify-between">
                    <div>
                        <h3 class="font-bold text-lg">VPS Starter</h3>
                        <div class="text-2xl font-extrabold text-[#00ffcc] my-2">25,000 TZS</div>
                        <ul class="text-xs text-gray-400 space-y-1 mb-6">
                            <li>⚡ 1 vCPU Core (Xeon)</li>
                            <li>💾 2 GB RAM DDR4</li>
                            <li>💽 30 GB NVMe SSD</li>
                        </ul>
                    </div>
                    <div class="space-y-2">
                        <input type="text" id="phone-Starter" placeholder="Mfano: 0657779003" class="w-full p-2 bg-gray-900 border border-gray-800 rounded text-xs text-white focus:outline-none focus:border-[#00ffcc]">
                        <button onclick="triggerPayment('Starter', 25000)" class="w-full bg-[#00ffcc] text-[#0b0f19] py-2 rounded font-bold text-xs hover:bg-[#00cc99] transition">Lipia na SonicPesa (Push)</button>
                    </div>
                </div>
                <div class="vps-card p-6 rounded-xl flex flex-col justify-between border-[#00ffcc]/30">
                    <div>
                        <h3 class="font-bold text-lg">VPS Professional</h3>
                        <div class="text-2xl font-extrabold text-[#00ffcc] my-2">50,000 TZS</div>
                        <ul class="text-xs text-gray-400 space-y-1 mb-6">
                            <li>⚡ 2 vCPU Cores (AMD)</li>
                            <li>💾 4 GB RAM DDR4</li>
                            <li>💽 60 GB NVMe SSD</li>
                        </ul>
                    </div>
                    <div class="space-y-2">
                        <input type="text" id="phone-Professional" placeholder="Mfano: 0657779003" class="w-full p-2 bg-gray-900 border border-gray-800 rounded text-xs text-white focus:outline-none focus:border-[#00ffcc]">
                        <button onclick="triggerPayment('Professional', 50000)" class="w-full bg-[#00ffcc] text-[#0b0f19] py-2 rounded font-bold text-xs hover:bg-[#00cc99] transition">Lipia na SonicPesa (Push)</button>
                    </div>
                </div>
                <div class="vps-card p-6 rounded-xl flex flex-col justify-between">
                    <div>
                        <h3 class="font-bold text-lg">VPS Enterprise</h3>
                        <div class="text-2xl font-extrabold text-[#00ffcc] my-2">95,000 TZS</div>
                        <ul class="text-xs text-gray-400 space-y-1 mb-6">
                            <li>⚡ 4 vCPU Cores (Ryzen)</li>
                            <li>💾 8 GB RAM DDR4</li>
                            <li>💽 120 GB NVMe SSD</li>
                        </ul>
                    </div>
                    <div class="space-y-2">
                        <input type="text" id="phone-Enterprise" placeholder="Mfano: 0657779003" class="w-full p-2 bg-gray-900 border border-gray-800 rounded text-xs text-white focus:outline-none focus:border-[#00ffcc]">
                        <button onclick="triggerPayment('Enterprise', 95000)" class="w-full bg-[#00ffcc] text-[#0b0f19] py-2 rounded font-bold text-xs hover:bg-[#00cc99] transition">Lipia na SonicPesa (Push)</button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const token = localStorage.getItem('mickey_token');
        if (!token) window.location.href = '/login.html';

        const user = JSON.parse(localStorage.getItem('mickey_user'));
        const isAdmin = user.role === 'admin';

        document.getElementById('user-display').innerText = `${isAdmin ? 'Admin' : 'Mteja'}: ${user.name}`;
        
        if (isAdmin) {
            document.getElementById('admin-badge').classList.remove('hidden');
            document.getElementById('th-owner').classList.remove('hidden');
            document.getElementById('servers-title').innerText = "Marekodi ya Servers Zote Duniani (Admin view)";
            document.getElementById('pending-title').innerText = "Miamala ya Wateja Wote Inayosubiri (Admin monitoring)";
            document.getElementById('vps-shop-section').classList.add('hidden'); // Ficha duka kwa ajili ya admin
        }

        function logout() {
            localStorage.clear();
            window.location.href = '/login.html';
        }

        async function fetchDashboardData() {
            try {
                const res = await fetch('/api/vps/my-assets', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await res.json();
                if(!data.success) return;

                const tbody = document.getElementById('server-table-body');
                tbody.innerHTML = '';
                if (data.servers.length === 0) {
                    document.getElementById('no-servers').classList.remove('hidden');
                } else {
                    document.getElementById('no-servers').classList.add('hidden');
                    data.servers.forEach(srv => {
                        tbody.innerHTML += `<tr class="border-b border-white/5">
                            ${isAdmin ? `<td class="py-3 text-xs text-yellow-400 font-bold">${srv.owner_name || 'N/A'}</td>` : ''}
                            <td class="py-3 font-semibold text-[#00ffcc]">${srv.plan || 'VPS'}</td>
                            <td class="py-3 text-blue-400 underline">${srv.host}</td>
                            <td class="py-3 font-mono text-xs">${srv.user}</td>
                            <td class="py-3"><span class="bg-white/10 px-2 py-0.5 rounded font-mono text-xs">${srv.pass}</span></td>
                            <td class="py-3">${srv.port}</td>
                        </tr>`;
                    });
                }

                const pendingContainer = document.getElementById('pending-container');
                pendingContainer.innerHTML = '';
                if (data.pending.length > 0) {
                    document.getElementById('pending-box').classList.remove('hidden');
                    data.pending.forEach(req => {
                        pendingContainer.innerHTML += `<div class="flex justify-between items-center p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-xs">
                            <div>Oda ID: <span class="font-bold text-gray-300">${req.sonicOrderId}</span> (${req.plan}) ${isAdmin ? `| Mteja: ${req.buyer_name}` : ''}</div>
                            <div class="blinking-text text-yellow-500 font-semibold">${isAdmin ? 'Mteja hajalipia bado...' : 'Tafadhali weka namba yako ya siri ya mtandao kwenye simu yako...'}</div>
                        </div>`;
                    });
                } else {
                    document.getElementById('pending-box').classList.add('hidden');
                }
            } catch (err) { console.error(err); }
        }

        async function triggerPayment(planName, price) {
            const phoneInput = document.getElementById(`phone-${planName}`).value;
            if (!phoneInput || phoneInput.length < 9) {
                alert('Tafadhali ingiza namba sahihi ya simu!');
                return;
            }

            const res = await fetch('/api/vps/create-ussd-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ plan: 'VPS ' + planName, amount: price, phone: phoneInput })
            });
            const data = await res.json();
            if (data.success) {
                alert(data.message);
                fetchDashboardData();
            } else {
                alert(data.message || "Imeshindikana.");
            }
        }

        fetchDashboardData();
        setInterval(fetchDashboardData, 5000);

        const init3D = () => {
            const container = document.getElementById('canvas-3d');
            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
            const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
            renderer.setSize(window.innerWidth, window.innerHeight);
            container.appendChild(renderer.domElement);

            const geometry = new THREE.TorusKnotGeometry(2.5, 0.4, 120, 16);
            const material = new THREE.MeshBasicMaterial({ color: 0x00ffcc, wireframe: true });
            const mesh = new THREE.Mesh(geometry, material);
            scene.add(mesh);
            camera.position.z = 6;

            const animate = () => {
                requestAnimationFrame(animate);
                mesh.rotation.x += 0.002;
                mesh.rotation.y += 0.004;
                renderer.render(scene, camera);
            };
            animate();
        };
        init3D();
    </script>
</body>
</html>
