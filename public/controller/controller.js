const socket = io();

// UI Elements
const joinScreen = document.getElementById('join-screen');
const controllerScreen = document.getElementById('controller-screen');
const roomInput = document.getElementById('room-input');
const nameInput = document.getElementById('name-input');
const joinBtn = document.getElementById('join-btn');
const errorMsg = document.getElementById('error-msg');
const playerNameDisplay = document.getElementById('player-name-display');
const playerColor = document.getElementById('player-color');

// State
let roomCode = '';
let isConnected = false;
let myPlayerData = null;

// Input State
const inputState = {
    joystickX: 0,
    joystickY: 0,
    buttons: {
        pass: false,
        shoot: false,
        sprint: false,
        tackle: false
    }
};

// Check for URL parameters (QR code join)
const urlParams = new URLSearchParams(window.location.search);
const roomParam = urlParams.get('room');
if (roomParam) {
    roomInput.value = roomParam;
}

// Join Game
joinBtn.addEventListener('click', () => {
    roomCode = roomInput.value.toUpperCase();
    const username = nameInput.value.trim() || 'Player';
    
    if (roomCode.length !== 4) {
        showError('Invalid Room Code');
        return;
    }
    
    // Pick a random neon color
    const colors = ['#00ffcc', '#ff00ff', '#ffff00', '#ff3333', '#33ff33', '#3333ff', '#ff9900'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    
    socket.emit('join_room', { shortCode: roomCode, username, color });
    joinBtn.innerText = 'CONNECTING...';
    joinBtn.disabled = true;
});

function showError(msg) {
    errorMsg.innerText = msg;
    errorMsg.style.display = 'block';
    joinBtn.innerText = 'CONNECT';
    joinBtn.disabled = false;
}

// Socket Events
socket.on('join_success', (data) => {
    isConnected = true;
    myPlayerData = data.playerData;
    
    joinScreen.style.display = 'none';
    controllerScreen.style.display = 'flex';
    
    playerNameDisplay.innerText = myPlayerData.username;
    playerColor.style.backgroundColor = myPlayerData.color;
    playerColor.style.color = myPlayerData.color;
    
    // Request full screen if possible
    if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(e => console.log(e));
    }
    
    // Vibrate to confirm
    if (navigator.vibrate) navigator.vibrate(200);
});

socket.on('join_error', (data) => {
    showError(data.message);
});

socket.on('host_disconnected', () => {
    alert('Host disconnected. Match ended.');
    window.location.reload();
});

socket.on('disconnect', () => {
    isConnected = false;
    document.getElementById('connection-status').innerText = '🔴 Offline';
    document.getElementById('connection-status').style.color = '#ff3333';
});

socket.on('connect', () => {
    if (myPlayerData) {
        // Try to rejoin
        window.location.reload();
    }
});

// Joystick Logic
const joystickZone = document.getElementById('joystick-zone');
const joystickStick = document.getElementById('joystick-stick');
const joystickBase = document.getElementById('joystick-base');

let joystickActive = false;
let joystickOrigin = { x: 0, y: 0 };
let joystickCurrent = { x: 0, y: 0 };
const maxRadius = 75; // Half of 150px base

joystickZone.addEventListener('touchstart', handleJoystickStart, {passive: false});
joystickZone.addEventListener('touchmove', handleJoystickMove, {passive: false});
joystickZone.addEventListener('touchend', handleJoystickEnd);
joystickZone.addEventListener('touchcancel', handleJoystickEnd);

// Mouse support
joystickZone.addEventListener('mousedown', handleJoystickStart);
window.addEventListener('mousemove', handleJoystickMove);
window.addEventListener('mouseup', handleJoystickEnd);

function getClientCoords(e) {
    if (e.changedTouches) {
        return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
}

function handleJoystickStart(e) {
    // Only prevent default for touch to avoid breaking mouse clicks on other UI elements if any
    if (e.type === 'touchstart') e.preventDefault();
    
    if (!isConnected) return;
    
    // For mouse, ensure we only start on left click
    if (e.type === 'mousedown' && e.button !== 0) return;
    
    joystickActive = true;
    
    const coords = getClientCoords(e);
    
    const rect = joystickBase.getBoundingClientRect();
    joystickOrigin = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
    };
    
    updateJoystick(coords.x, coords.y);
}

function handleJoystickMove(e) {
    if (e.type === 'touchmove') e.preventDefault();
    if (!joystickActive) return;
    
    const coords = getClientCoords(e);
    updateJoystick(coords.x, coords.y);
}

function handleJoystickEnd(e) {
    if (e.type === 'touchend' || e.type === 'touchcancel') e.preventDefault();
    joystickActive = false;
    
    // Reset visual
    joystickStick.style.transform = `translate(-50%, -50%)`;
    
    // Reset state
    inputState.joystickX = 0;
    inputState.joystickY = 0;
    sendInput();
}

function updateJoystick(x, y) {
    let dx = x - joystickOrigin.x;
    let dy = y - joystickOrigin.y;
    
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > maxRadius) {
        dx = (dx / distance) * maxRadius;
        dy = (dy / distance) * maxRadius;
    }
    
    // Update visual
    joystickStick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    
    // Update state (-1 to 1)
    inputState.joystickX = dx / maxRadius;
    inputState.joystickY = dy / maxRadius;
    
    sendInput();
}

// Button Logic
function setupButton(id, stateKey) {
    const btn = document.getElementById(id);
    
    const handlePress = (e) => {
        if (e.type === 'touchstart') e.preventDefault();
        // Ignore right clicks
        if (e.type === 'mousedown' && e.button !== 0) return;
        
        if (!isConnected) return;
        
        btn.classList.add('active');
        inputState.buttons[stateKey] = true;
        if (navigator.vibrate) navigator.vibrate(50); // Light haptic feedback
        sendInput();
    };
    
    const handleRelease = (e) => {
        if (e.type === 'touchend' || e.type === 'touchcancel') e.preventDefault();
        btn.classList.remove('active');
        inputState.buttons[stateKey] = false;
        sendInput();
    };
    
    btn.addEventListener('touchstart', handlePress, {passive: false});
    btn.addEventListener('touchend', handleRelease);
    btn.addEventListener('touchcancel', handleRelease);
    
    // Mouse Support
    btn.addEventListener('mousedown', handlePress);
    btn.addEventListener('mouseup', handleRelease);
    btn.addEventListener('mouseleave', handleRelease);
}

setupButton('btn-pass', 'pass');
setupButton('btn-shoot', 'shoot');
setupButton('btn-sprint', 'sprint');
setupButton('btn-tackle', 'tackle');

// Throttled input sending (60 times a second max)
let lastSendTime = 0;
let pendingSend = false;

function sendInput() {
    if (!isConnected) return;
    
    const now = Date.now();
    if (now - lastSendTime < 16) { // ~60fps throttle
        if (!pendingSend) {
            pendingSend = true;
            setTimeout(() => {
                pendingSend = false;
                sendInput();
            }, 16 - (now - lastSendTime));
        }
        return;
    }
    
    lastSendTime = now;
    
    socket.emit('controller_input', {
        x: inputState.joystickX,
        y: inputState.joystickY,
        btns: inputState.buttons
    });
}
