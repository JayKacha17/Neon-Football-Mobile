const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '../public')));

// Store active rooms and their state
const rooms = {};

// Generate a random 4-character short code
function generateShortCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Host creates a new room
    socket.on('create_room', () => {
        let shortCode = generateShortCode();
        while (rooms[shortCode]) {
            shortCode = generateShortCode();
        }

        const roomId = uuidv4();
        
        rooms[shortCode] = {
            roomId: roomId,
            hostSocketId: socket.id,
            players: {}, // socketId -> player data
            state: 'LOBBY'
        };

        socket.join(roomId);
        console.log(`Room created: ${shortCode} (Host: ${socket.id})`);
        
        socket.emit('room_created', { shortCode, roomId });
    });

    // Player joins a room via short code
    socket.on('join_room', (data) => {
        const { shortCode, username, color } = data;
        const roomCode = shortCode.toUpperCase();
        
        const room = rooms[roomCode];
        
        if (!room) {
            socket.emit('join_error', { message: 'Room not found' });
            return;
        }

        if (Object.keys(room.players).length >= 8) {
            socket.emit('join_error', { message: 'Room is full (max 8 players)' });
            return;
        }

        const roomId = room.roomId;
        socket.join(roomId);
        
        const playerNumber = Object.keys(room.players).length + 1;
        const playerData = {
            id: socket.id,
            username: username || `Player ${playerNumber}`,
            color: color || '#ff0000',
            number: playerNumber,
            team: playerNumber % 2 === 0 ? 'B' : 'A',
            ready: false
        };

        room.players[socket.id] = playerData;

        console.log(`${playerData.username} joined room ${roomCode}`);

        // Tell the player they joined successfully
        socket.emit('join_success', { 
            roomId, 
            playerData 
        });

        // Notify host that a player joined
        io.to(room.hostSocketId).emit('player_joined', playerData);
    });

    // Forward game state from host to mobile players
    socket.on('sync_game_state', (state) => {
        for (const code in rooms) {
            const room = rooms[code];
            if (room.hostSocketId === socket.id) {
                socket.to(room.roomId).emit('game_state_update', state);
                break;
            }
        }
    });

    // Notify players when match begins
    socket.on('match_started', () => {
        for (const code in rooms) {
            const room = rooms[code];
            if (room.hostSocketId === socket.id) {
                room.state = 'PLAYING';
                socket.to(room.roomId).emit('match_started');
                break;
            }
        }
    });

    // Player controller input
    socket.on('controller_input', (data) => {
        for (const code in rooms) {
            const room = rooms[code];
            if (room.players[socket.id]) {
                // Forward input directly to host
                io.to(room.hostSocketId).emit('player_input', {
                    playerId: socket.id,
                    input: data
                });
                break;
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        // Check if it was a host
        for (const code in rooms) {
            const room = rooms[code];
            if (room.hostSocketId === socket.id) {
                console.log(`Host disconnected, destroying room ${code}`);
                // Tell all players the host disconnected
                socket.to(room.roomId).emit('host_disconnected');
                delete rooms[code];
                return;
            }
            
            // Check if it was a player
            if (room.players[socket.id]) {
                console.log(`Player ${room.players[socket.id].username} disconnected from ${code}`);
                io.to(room.hostSocketId).emit('player_disconnected', socket.id);
                delete room.players[socket.id];
                return;
            }
        }
    });
});

const os = require('os');
const { exec } = require('child_process');

server.listen(PORT, '0.0.0.0', () => {
    console.log('\n========================================================');
    console.log('       ⚽ NEON FOOTBALL MOBILE - OFFLINE LAN SERVER ⚽');
    console.log('========================================================');
    console.log('Server is running on port: ' + PORT);
    
    // Find local IP addresses, filtering out VirtualBox, WSL, and VPNs
    const interfaces = os.networkInterfaces();
    let bestIp = 'localhost';
    const allIps = [];
    
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                allIps.push({ name, ip: iface.address });
                // Prefer Wi-Fi or Ethernet
                const lower = name.toLowerCase();
                if (!lower.includes('vbox') && 
                    !lower.includes('vmware') && 
                    !lower.includes('wsl') && 
                    !lower.includes('virtual') &&
                    !lower.includes('tailscale') &&
                    !lower.includes('vpn') &&
                    bestIp === 'localhost') {
                    bestIp = iface.address;
                }
            }
        }
    }

    if (bestIp === 'localhost' && allIps.length > 0) {
        bestIp = allIps[0].ip;
    }
    
    const localUrl = 'http://' + bestIp + ':' + PORT;
    const mobileUrl = localUrl + '/mobile';
    
    console.log('\n📱 PLAY ON MOBILE (Phone / Tablet):');
    console.log('   -> ' + mobileUrl);
    console.log('\n🖥️ HOST SCREEN (PC / TV / Laptop):');
    console.log('   -> ' + localUrl + '/game');
    console.log('   -> http://localhost:' + PORT + '/game');

    if (allIps.length > 1) {
        console.log('\nAll detected network IPs:');
        allIps.forEach(item => {
            console.log('   • ' + item.name + ': http://' + item.ip + ':' + PORT);
        });
    }

    console.log('\n📶 HOTSPOT / WI-FI TIP:');
    console.log('   Open ' + mobileUrl + ' on any phone connected');
    console.log('   to the same Wi-Fi or Phone Hotspot (0 Internet Needed!)');
    console.log('========================================================\n');
    
    // Automatically open the mobile game in the host's browser if running locally
    if (process.env.NODE_ENV !== 'production') {
        const platform = process.platform;
        if (platform === 'win32') {
            exec('start ' + mobileUrl);
        } else if (platform === 'darwin') {
            exec('open ' + mobileUrl);
        } else {
            exec('which xdg-open && xdg-open ' + mobileUrl, () => {});
        }
    } else {
        console.log('[Render / Production Mode]: Server successfully started.\n');
    }
});
