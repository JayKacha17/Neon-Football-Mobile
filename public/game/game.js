const socket = io();

// State
let roomCode = '';
let players = {}; // socketId -> playerData
let isGameRunning = false;

// UI Elements
const lobbyScreen = document.getElementById('lobby-screen');
const roomCodeDisplay = document.getElementById('room-code-display');
const joinUrlDisplay = document.getElementById('join-url');
const qrcodeContainer = document.getElementById('qrcode');
const playersContainer = document.getElementById('players-container');
const startBtn = document.getElementById('start-btn');
const scoreboard = document.getElementById('scoreboard');
const scoreADisplay = document.getElementById('score-a');
const scoreBDisplay = document.getElementById('score-b');
const timerDisplay = document.getElementById('timer');
const announcer = document.getElementById('announcer');

// Game State
let score = { A: 0, B: 0 };
let matchTimer = 180; // 3 minutes
let matchInterval;
let lastSyncTime = 0;
let lastScuffTime = 0;

// Physics & Rendering Objects
let engine, world;
let scene, camera, renderer;
let ballBody, ballMesh;
let playerBodies = {}; // socketId -> matter body
let playerMeshes = {}; // socketId -> three mesh
let goals = { A: null, B: null }; // Sensor bodies

const PITCH_WIDTH = 2100; // Scaled up to 2100
const PITCH_HEIGHT = 1360;
const GOAL_WIDTH = 240;
const PLAYER_RADIUS = 20; 
const BALL_RADIUS = 10;

// Init Socket Connection (Host)
socket.on('connect', () => {
    socket.emit('create_room');
});

socket.on('room_created', (data) => {
    roomCode = data.shortCode;
    roomCodeDisplay.innerText = roomCode;
    
    const joinUrl = `${window.location.origin}/controller`;
    joinUrlDisplay.innerText = joinUrl;
    
    // Generate QR Code
    qrcodeContainer.innerHTML = '';
    new QRCode(qrcodeContainer, {
        text: `${joinUrl}?room=${roomCode}`,
        width: 150,
        height: 150,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });
});

socket.on('player_joined', (playerData) => {
    players[playerData.id] = playerData;
    updateLobbyUI();
});

socket.on('player_disconnected', (playerId) => {
    delete players[playerId];
    updateLobbyUI();
    
    if (isGameRunning && playerBodies[playerId]) {
        // Remove from physics and scene
        Matter.Composite.remove(world, playerBodies[playerId]);
        scene.remove(playerMeshes[playerId]);
        delete playerBodies[playerId];
        delete playerMeshes[playerId];
    }
});

let currentInputs = {}; // Stores continuous input state

socket.on('player_input', (data) => {
    const { playerId, input } = data;
    if (isGameRunning && playerBodies[playerId]) {
        currentInputs[playerId] = input;
    }
});

function updateLobbyUI() {
    playersContainer.innerHTML = '';
    const playerIds = Object.keys(players);
    
    playerIds.forEach(id => {
        const p = players[id];
        const card = document.createElement('div');
        card.className = 'player-card active';
        card.style.borderColor = p.color;
        
        card.innerHTML = `
            <div class="player-avatar" style="background-color: ${p.color}"></div>
            <div class="player-name">${p.username}</div>
            <div style="margin-top: 10px; font-weight: bold; color: ${p.team === 'A' ? '#00ffcc' : '#ff00ff'}">TEAM ${p.team}</div>
        `;
        playersContainer.appendChild(card);
    });
    
    if (playerIds.length >= 2) {
        startBtn.innerText = 'START MATCH';
        startBtn.disabled = false;
    } else {
        startBtn.innerText = 'WAITING FOR PLAYERS... (MIN 2)';
        startBtn.disabled = true;
    }
}

startBtn.addEventListener('click', () => {
    // Fill with bots if less than 4 players
    const playerCount = Object.keys(players).length;
    for (let i = playerCount; i < 4; i++) {
        const botId = 'bot_' + i;
        players[botId] = {
            id: botId,
            username: `AI Bot ${i}`,
            color: '#aaaaaa',
            team: i % 2 === 0 ? 'B' : 'A',
            isBot: true,
            aggressionMap: {} // tracks tackles against this bot
        };
    }
    startMatch();
});

// --- GAME LOGIC & ENGINE ---

function startMatch() {
    isGameRunning = true;
    socket.emit('match_started');
    lobbyScreen.style.display = 'none';
    scoreboard.style.display = 'flex';
    
    initPhysics();
    initRendering();
    
    score = { A: 0, B: 0 };
    updateScoreUI();
    
    matchTimer = 180;
    updateTimerUI();
    
    matchInterval = setInterval(() => {
        matchTimer--;
        updateTimerUI();
        if (matchTimer <= 0) {
            endMatch();
        }
    }, 1000);
    
    // Announce start
    announce('MATCH START!');
    
    // Start game loop
    requestAnimationFrame(gameLoop);
}

function initPhysics() {
    engine = Matter.Engine.create();
    engine.gravity.y = 0; // Top-down physics
    world = engine.world;
    
    // Pitch bounds (walls)
    const wallOptions = { isStatic: true, restitution: 0.5, friction: 0 };
    const walls = [
        Matter.Bodies.rectangle(0, -PITCH_HEIGHT/2 - 25, PITCH_WIDTH, 50, wallOptions), // Top
        Matter.Bodies.rectangle(0, PITCH_HEIGHT/2 + 25, PITCH_WIDTH, 50, wallOptions), // Bottom
        Matter.Bodies.rectangle(-PITCH_WIDTH/2 - 25, -PITCH_HEIGHT/4 - GOAL_WIDTH/4, 50, PITCH_HEIGHT/2 - GOAL_WIDTH/2, wallOptions),
        Matter.Bodies.rectangle(-PITCH_WIDTH/2 - 25, PITCH_HEIGHT/4 + GOAL_WIDTH/4, 50, PITCH_HEIGHT/2 - GOAL_WIDTH/2, wallOptions),
        Matter.Bodies.rectangle(PITCH_WIDTH/2 + 25, -PITCH_HEIGHT/4 - GOAL_WIDTH/4, 50, PITCH_HEIGHT/2 - GOAL_WIDTH/2, wallOptions),
        Matter.Bodies.rectangle(PITCH_WIDTH/2 + 25, PITCH_HEIGHT/4 + GOAL_WIDTH/4, 50, PITCH_HEIGHT/2 - GOAL_WIDTH/2, wallOptions),
    ];
    
    // Realistic Goal Nets (Physical boxes trapping the ball)
    const netOptions = { isStatic: true, restitution: 0.1, friction: 0.8 };
    const netDepth = 80;
    const netThick = 20;
    
    const nets = [
        // Left Goal Net
        Matter.Bodies.rectangle(-PITCH_WIDTH/2 - netDepth, 0, netThick, GOAL_WIDTH, netOptions), // Back
        Matter.Bodies.rectangle(-PITCH_WIDTH/2 - netDepth/2, -GOAL_WIDTH/2, netDepth, netThick, netOptions), // Top edge
        Matter.Bodies.rectangle(-PITCH_WIDTH/2 - netDepth/2, GOAL_WIDTH/2, netDepth, netThick, netOptions), // Bottom edge
        // Right Goal Net
        Matter.Bodies.rectangle(PITCH_WIDTH/2 + netDepth, 0, netThick, GOAL_WIDTH, netOptions), // Back
        Matter.Bodies.rectangle(PITCH_WIDTH/2 + netDepth/2, -GOAL_WIDTH/2, netDepth, netThick, netOptions), // Top edge
        Matter.Bodies.rectangle(PITCH_WIDTH/2 + netDepth/2, GOAL_WIDTH/2, netDepth, netThick, netOptions) // Bottom edge
    ];
    
    // Corner Flags Physics (Interactive)
    window.cornerFlags = [];
    const corners = [
        { x: -PITCH_WIDTH/2, y: -PITCH_HEIGHT/2 },
        { x: PITCH_WIDTH/2, y: -PITCH_HEIGHT/2 },
        { x: -PITCH_WIDTH/2, y: PITCH_HEIGHT/2 },
        { x: PITCH_WIDTH/2, y: PITCH_HEIGHT/2 }
    ];
    corners.forEach(c => {
        const flagBody = Matter.Bodies.circle(c.x, c.y, 5, { frictionAir: 0.1, density: 0.01 });
        const constraint = Matter.Constraint.create({
            pointA: { x: c.x, y: c.y },
            bodyB: flagBody,
            stiffness: 0.1,
            damping: 0.5
        });
        window.cornerFlags.push({ body: flagBody, startX: c.x, startY: c.y });
        Matter.Composite.add(world, [flagBody, constraint]);
    });
    
    // Goal sensors
    goals.A = Matter.Bodies.rectangle(-PITCH_WIDTH/2 - 20, 0, 40, GOAL_WIDTH - 20, { isStatic: true, isSensor: true, label: 'goalA' });
    goals.B = Matter.Bodies.rectangle(PITCH_WIDTH/2 + 20, 0, 40, GOAL_WIDTH - 20, { isStatic: true, isSensor: true, label: 'goalB' });
    
    Matter.Composite.add(world, [...walls, ...nets, goals.A, goals.B]);
    
    // Ball
    ballBody = Matter.Bodies.circle(0, 0, BALL_RADIUS, {
        restitution: 0.3, // Less bouncy for realism
        friction: 0.05,
        frictionAir: 0.015,
        density: 0.003, 
        label: 'ball'
    });
    Matter.Composite.add(world, ballBody);
    
    // Players
    const teamA = [];
    const teamB = [];
    
    Object.values(players).forEach(p => {
        if (p.team === 'A') teamA.push(p);
        else teamB.push(p);
    });
    
    // Position players
    const positionTeam = (teamArr, isTeamA) => {
        teamArr.forEach((p, index) => {
            const x = isTeamA ? -PITCH_WIDTH/4 : PITCH_WIDTH/4;
            const y = (index - (teamArr.length-1)/2) * 150;
            
            const body = Matter.Bodies.circle(x, y, PLAYER_RADIUS, {
                restitution: 0.0, // Human bodies don't bounce
                frictionAir: 0.08,
                density: 0.006, 
                label: `player_${p.id}`
            });
            playerBodies[p.id] = body;
            Matter.Composite.add(world, body);
        });
    };
    
    positionTeam(teamA, true);
    positionTeam(teamB, false);
    
    // Collision events for goals & emotional AI
    Matter.Events.on(engine, 'collisionStart', (event) => {
        event.pairs.forEach((pair) => {
            // Goal check
            if ((pair.bodyA === ballBody && pair.bodyB === goals.A) || (pair.bodyB === ballBody && pair.bodyA === goals.A)) {
                handleGoal('B');
            } else if ((pair.bodyA === ballBody && pair.bodyB === goals.B) || (pair.bodyB === ballBody && pair.bodyA === goals.B)) {
                handleGoal('A');
            }
            
            // Emotional AI check: Player colliding with Bot
            const labelA = pair.bodyA.label;
            const labelB = pair.bodyB.label;
            
            if (labelA.startsWith('player_') && labelB.startsWith('player_')) {
                const idA = labelA.replace('player_', '');
                const idB = labelB.replace('player_', '');
                const pA = players[idA];
                const pB = players[idB];
                
                // Relative speed calculation for "roughness"
                const vA = pair.bodyA.velocity;
                const vB = pair.bodyB.velocity;
                const relativeSpeed = Math.sqrt(Math.pow(vA.x - vB.x, 2) + Math.pow(vA.y - vB.y, 2));
                
                if (relativeSpeed > 5) { // Hard tackle
                    if (pA && pA.isBot && pB && !pB.isBot) {
                        pA.aggressionMap[idB] = (pA.aggressionMap[idB] || 0) + 1;
                    }
                    if (pB && pB.isBot && pA && !pA.isBot) {
                        pB.aggressionMap[idA] = (pB.aggressionMap[idA] || 0) + 1;
                    }
                }
            }
        });
    });
}

function initRendering() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#050510');
    
    // Camera Setup (Higher for larger pitch)
    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 5000);
    camera.position.set(0, -1000, 1500); 
    camera.lookAt(0, 0, 0);
    
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.getElementById('game-container').appendChild(renderer.domElement);
    
    // Lights (Stadium floodlights)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(0, 0, 2000);
    dirLight.castShadow = true;
    dirLight.shadow.camera.left = -PITCH_WIDTH/2 - 200;
    dirLight.shadow.camera.right = PITCH_WIDTH/2 + 200;
    dirLight.shadow.camera.top = PITCH_HEIGHT/2 + 200;
    dirLight.shadow.camera.bottom = -PITCH_HEIGHT/2 - 200;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    scene.add(dirLight);
    
    // Living Pitch (Destructible Turf with Grass Stripes)
    const pitchCanvas = document.createElement('canvas');
    pitchCanvas.width = 2048;
    pitchCanvas.height = 2048;
    window.pitchCtx = pitchCanvas.getContext('2d');
    
    // Draw striped grass
    const stripeCount = 14;
    const stripeHeight = 2048 / stripeCount;
    for (let i = 0; i < stripeCount; i++) {
        window.pitchCtx.fillStyle = i % 2 === 0 ? '#2E4C20' : '#355525';
        window.pitchCtx.fillRect(0, i * stripeHeight, 2048, stripeHeight);
    }
    
    // Draw pitch lines
    window.pitchCtx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    window.pitchCtx.lineWidth = 6;
    const cw = 2048;
    const ch = 2048 * (PITCH_HEIGHT/PITCH_WIDTH); // proportional height
    const offsetY = (2048 - ch) / 2;
    
    // Bounds
    window.pitchCtx.strokeRect(0, offsetY, cw, ch);
    
    // Center line and circle
    window.pitchCtx.beginPath();
    window.pitchCtx.moveTo(cw/2, offsetY);
    window.pitchCtx.lineTo(cw/2, offsetY + ch);
    window.pitchCtx.stroke();
    
    // Center circle
    window.pitchCtx.beginPath();
    window.pitchCtx.arc(cw/2, offsetY + ch/2, 180, 0, Math.PI*2);
    window.pitchCtx.stroke();
    
    // Center spot
    window.pitchCtx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    window.pitchCtx.beginPath();
    window.pitchCtx.arc(cw/2, offsetY + ch/2, 8, 0, Math.PI*2);
    window.pitchCtx.fill();
    
    // Penalty areas (18-yard box)
    window.pitchCtx.strokeRect(0, offsetY + ch/2 - 350, 280, 700);
    window.pitchCtx.strokeRect(cw - 280, offsetY + ch/2 - 350, 280, 700);
    
    // Goal areas (6-yard box)
    window.pitchCtx.strokeRect(0, offsetY + ch/2 - 150, 90, 300);
    window.pitchCtx.strokeRect(cw - 90, offsetY + ch/2 - 150, 90, 300);
    
    // Penalty spots
    window.pitchCtx.beginPath();
    window.pitchCtx.arc(200, offsetY + ch/2, 6, 0, Math.PI*2);
    window.pitchCtx.fill();
    window.pitchCtx.beginPath();
    window.pitchCtx.arc(cw - 200, offsetY + ch/2, 6, 0, Math.PI*2);
    window.pitchCtx.fill();
    
    // Penalty arcs (D)
    window.pitchCtx.beginPath();
    window.pitchCtx.arc(280, offsetY + ch/2, 150, -Math.PI*0.3, Math.PI*0.3);
    window.pitchCtx.stroke();
    window.pitchCtx.beginPath();
    window.pitchCtx.arc(cw - 280, offsetY + ch/2, 150, Math.PI - Math.PI*0.3, Math.PI + Math.PI*0.3);
    window.pitchCtx.stroke();
    
    // Corner arcs
    const cornerRadius = 30;
    // Top-Left
    window.pitchCtx.beginPath();
    window.pitchCtx.arc(0, offsetY, cornerRadius, 0, Math.PI/2);
    window.pitchCtx.stroke();
    // Bottom-Left
    window.pitchCtx.beginPath();
    window.pitchCtx.arc(0, offsetY + ch, cornerRadius, -Math.PI/2, 0);
    window.pitchCtx.stroke();
    // Top-Right
    window.pitchCtx.beginPath();
    window.pitchCtx.arc(cw, offsetY, cornerRadius, Math.PI/2, Math.PI);
    window.pitchCtx.stroke();
    // Bottom-Right
    window.pitchCtx.beginPath();
    window.pitchCtx.arc(cw, offsetY + ch, cornerRadius, Math.PI, Math.PI*1.5);
    window.pitchCtx.stroke();
    
    window.pitchTexture = new THREE.CanvasTexture(pitchCanvas);
    window.pitchTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    
    const pitchGeo = new THREE.PlaneGeometry(PITCH_WIDTH, PITCH_WIDTH); 
    const pitchMat = new THREE.MeshStandardMaterial({ 
        map: window.pitchTexture,
        roughness: 0.9,
        metalness: 0.1
    });
    const pitch = new THREE.Mesh(pitchGeo, pitchMat);
    pitch.receiveShadow = true;
    scene.add(pitch);
    
    // Stadium Bleachers/Stands
    const standMat = new THREE.MeshStandardMaterial({ color: 0x333344, roughness: 1.0 });
    const standHeight = 300;
    
    const topStand = new THREE.Mesh(new THREE.BoxGeometry(PITCH_WIDTH + 800, PITCH_HEIGHT/2, standHeight), standMat);
    topStand.position.set(0, PITCH_HEIGHT + 200, standHeight/2 - 50);
    topStand.rotation.x = -Math.PI/6;
    scene.add(topStand);
    
    const bottomStand = new THREE.Mesh(new THREE.BoxGeometry(PITCH_WIDTH + 800, PITCH_HEIGHT/2, standHeight), standMat);
    bottomStand.position.set(0, -PITCH_HEIGHT - 200, standHeight/2 - 50);
    bottomStand.rotation.x = Math.PI/6;
    scene.add(bottomStand);
    
    // LED Boards
    const boardGeo = new THREE.BoxGeometry(PITCH_WIDTH + 100, 20, 40);
    const boardMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x00ffcc, emissiveIntensity: 0.7 });
    const topBoard = new THREE.Mesh(boardGeo, boardMat);
    topBoard.position.set(0, PITCH_HEIGHT/2 + 35, 20);
    scene.add(topBoard);
    const bottomBoard = new THREE.Mesh(boardGeo, boardMat);
    bottomBoard.position.set(0, -PITCH_HEIGHT/2 - 35, 20);
    scene.add(bottomBoard);
    
    // Render Corner Flags
    window.flagMeshes = [];
    window.cornerFlags.forEach(c => {
        const poleGeo = new THREE.CylinderGeometry(2, 2, 60);
        poleGeo.rotateX(Math.PI/2);
        const poleMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
        const poleMesh = new THREE.Mesh(poleGeo, poleMat);
        
        const flagCloth = new THREE.Mesh(new THREE.PlaneGeometry(20, 15), new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide }));
        flagCloth.position.set(12, 0, 20);

        flagCloth.rotation.x = Math.PI/2;
        poleMesh.add(flagCloth);
        
        scene.add(poleMesh);
        window.flagMeshes.push(poleMesh);
    });
    
    // 3D Goalposts and Nets
    function createGoal(xOffset, color, isRightSide) {
        const goalGroup = new THREE.Group();
        const netDepth = 80;
        
        const postGeo = new THREE.CylinderGeometry(4, 4, 100);
        const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
        
        // Left Post
        const leftPost = new THREE.Mesh(postGeo, postMat);
        leftPost.position.set(0, GOAL_WIDTH/2, 50);
        leftPost.rotation.x = Math.PI/2;
        goalGroup.add(leftPost);
        
        // Right Post
        const rightPost = new THREE.Mesh(postGeo, postMat);
        rightPost.position.set(0, -GOAL_WIDTH/2, 50);
        rightPost.rotation.x = Math.PI/2;
        goalGroup.add(rightPost);
        
        // Crossbar
        const crossbarGeo = new THREE.CylinderGeometry(4, 4, GOAL_WIDTH);
        const crossbar = new THREE.Mesh(crossbarGeo, postMat);
        crossbar.position.set(0, 0, 100);
        goalGroup.add(crossbar);
        
        // Net (Transparent patterned plane)
        const netMat = new THREE.MeshStandardMaterial({ 
            color: color, 
            wireframe: true, 
            transparent: true, 
            opacity: 0.6 
        });
        
        // Back net
        const backNet = new THREE.Mesh(new THREE.PlaneGeometry(100, GOAL_WIDTH), netMat);
        backNet.position.set(isRightSide ? netDepth : -netDepth, 0, 50);
        backNet.rotation.y = Math.PI/2;
        goalGroup.add(backNet);
        
        // Top net
        const topNet = new THREE.Mesh(new THREE.PlaneGeometry(netDepth, GOAL_WIDTH), netMat);
        topNet.position.set(isRightSide ? netDepth/2 : -netDepth/2, 0, 100);
        goalGroup.add(topNet);
        
        // Side nets
        const sideNetGeo = new THREE.PlaneGeometry(netDepth, 100);
        const leftSideNet = new THREE.Mesh(sideNetGeo, netMat);
        leftSideNet.position.set(isRightSide ? netDepth/2 : -netDepth/2, GOAL_WIDTH/2, 50);
        leftSideNet.rotation.x = Math.PI/2;
        goalGroup.add(leftSideNet);
        
        const rightSideNet = new THREE.Mesh(sideNetGeo, netMat);
        rightSideNet.position.set(isRightSide ? netDepth/2 : -netDepth/2, -GOAL_WIDTH/2, 50);
        rightSideNet.rotation.x = Math.PI/2;
        goalGroup.add(rightSideNet);
        
        goalGroup.position.set(xOffset, 0, 0);
        scene.add(goalGroup);
        return goalGroup;
    }
    
    createGoal(-PITCH_WIDTH/2, 0x00ffcc, false);
    createGoal(PITCH_WIDTH/2, 0xff00ff, true);
    
    // Ball Mesh
    const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 16, 16);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x555555 });
    ballMesh = new THREE.Mesh(ballGeo, ballMat);
    ballMesh.castShadow = true;
    scene.add(ballMesh);
    
    // Player Meshes (Hierarchical Rigging)
    Object.keys(playerBodies).forEach(id => {
        const p = players[id];
        if (!p) return;
        const colorHex = p.color || (p.team === 'A' ? '#00ffcc' : '#ff00ff');
        const color = new THREE.Color(colorHex);
        
        // Sweat/Lighting material (High specular/roughness mapping equivalent)
        const skinMat = new THREE.MeshStandardMaterial({ color: 0xffdcb1, roughness: 0.3, metalness: 0.1 }); 
        const clothMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.8, emissive: color.clone().multiplyScalar(0.2) });
        
        const playerGroup = new THREE.Group();
        
        // Torso (Leaner)
        const torsoGeo = new THREE.BoxGeometry(16, 24, 10);
        const torso = new THREE.Mesh(torsoGeo, clothMat);
        torso.position.z = 25; // Height off ground
        torso.castShadow = true;
        playerGroup.add(torso);
        
        // Head
        const headGeo = new THREE.SphereGeometry(6, 16, 16);
        const head = new THREE.Mesh(headGeo, skinMat);
        head.position.set(0, 0, 15); // Relative to torso
        head.castShadow = true;
        torso.add(head);
        
        // Arms
        const armGeo = new THREE.BoxGeometry(4, 16, 4);
        const leftArm = new THREE.Mesh(armGeo, skinMat);
        leftArm.position.set(-10, 0, 0);
        leftArm.castShadow = true;
        torso.add(leftArm);
        
        const rightArm = new THREE.Mesh(armGeo, skinMat);
        rightArm.position.set(10, 0, 0);
        rightArm.castShadow = true;
        torso.add(rightArm);
        
        // Legs
        const legGeo = new THREE.BoxGeometry(5, 18, 5);
        const leftLeg = new THREE.Mesh(legGeo, skinMat);
        leftLeg.position.set(-4, 0, -20);
        leftLeg.castShadow = true;
        torso.add(leftLeg);
        
        const rightLeg = new THREE.Mesh(legGeo, skinMat);
        rightLeg.position.set(4, 0, -20);
        rightLeg.castShadow = true;
        torso.add(rightLeg);
        
        // Secondary Animation (Jersey flow tail)
        const tailGeo = new THREE.PlaneGeometry(12, 10);
        const tail = new THREE.Mesh(tailGeo, clothMat);
        tail.position.set(0, -10, -10);
        tail.rotation.x = -Math.PI / 4;
        torso.add(tail);
        
        // Save references for animation
        playerGroup.userData = { torso, leftArm, rightArm, leftLeg, rightLeg, tail, time: Math.random() * 100 };
        
        scene.add(playerGroup);
        playerMeshes[id] = playerGroup;
    });
    
    // Handle Window Resize
    window.addEventListener('resize', onWindowResize, false);
}

function onWindowResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function applyInput(playerId, input) {
    const body = playerBodies[playerId];
    if (!body || !input) return;
    
    const btns = input.btns || {};
    const forceMagnitude = btns.sprint ? 0.0068 : 0.0038;
    const ix = Number(input.x) || 0;
    const iy = Number(input.y) || 0;
    
    Matter.Body.applyForce(body, body.position, {
        x: ix * forceMagnitude,
        y: iy * forceMagnitude
    });
    
    // Shooting (if near ball)
    if (btns.shoot && ballBody) {
        const dist = Matter.Vector.magnitude(Matter.Vector.sub(ballBody.position, body.position));
        if (dist < PLAYER_RADIUS + BALL_RADIUS + 35) {
            let dir = Matter.Vector.normalise(Matter.Vector.sub(ballBody.position, body.position));
            
            // If moving joystick, use joystick direction for shot aim
            if (Math.abs(ix) > 0.1 || Math.abs(iy) > 0.1) {
                dir = Matter.Vector.normalise({ x: ix, y: iy });
            }
            
            const kickForce = 0.014;
            Matter.Body.applyForce(ballBody, ballBody.position, {
                x: dir.x * kickForce,
                y: dir.y * kickForce
            });
        }
    }
}

let isResetting = false;

function handleGoal(team) {
    if (isResetting) return;
    isResetting = true;
    
    score[team]++;
    updateScoreUI();
    
    announce(`GOAL TEAM ${team}!`);
    
    // Reset positions after a delay
    setTimeout(() => {
        resetPositions();
        isResetting = false;
        announce('GO!');
    }, 3000);
}

function resetPositions() {
    if (ballBody) {
        Matter.Body.setPosition(ballBody, { x: 0, y: 0 });
        Matter.Body.setVelocity(ballBody, { x: 0, y: 0 });
    }
    
    const teamA = [];
    const teamB = [];
    
    Object.keys(playerBodies).forEach(id => {
        const p = players[id];
        const b = playerBodies[id];
        if (p && b) {
            if (p.team === 'A') teamA.push(b);
            else teamB.push(b);
        }
    });
    
    teamA.forEach((body, index) => {
        Matter.Body.setPosition(body, { x: -PITCH_WIDTH/4, y: (index - (teamA.length-1)/2) * 100 });
        Matter.Body.setVelocity(body, { x: 0, y: 0 });
    });
    
    teamB.forEach((body, index) => {
        Matter.Body.setPosition(body, { x: PITCH_WIDTH/4, y: (index - (teamB.length-1)/2) * 100 });
        Matter.Body.setVelocity(body, { x: 0, y: 0 });
    });
}

function updateScoreUI() {
    scoreADisplay.innerText = score.A;
    scoreBDisplay.innerText = score.B;
}

function updateTimerUI() {
    const m = Math.floor(matchTimer / 60);
    const s = matchTimer % 60;
    timerDisplay.innerText = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function announce(msg) {
    announcer.innerText = msg;
    announcer.style.opacity = 1;
    announcer.style.transform = 'translate(-50%, -50%) scale(1.5)';
    
    setTimeout(() => {
        announcer.style.transform = 'translate(-50%, -50%) scale(1)';
    }, 100);
    
    setTimeout(() => {
        announcer.style.opacity = 0;
    }, 2000);
}

function endMatch() {
    isGameRunning = false;
    clearInterval(matchInterval);
    
    let winner = 'DRAW';
    if (score.A > score.B) winner = 'TEAM A WINS!';
    if (score.B > score.A) winner = 'TEAM B WINS!';
    
    announce(winner);
    
    setTimeout(() => {
        // Simple reload to lobby for now
        window.location.reload();
    }, 5000);
}

// Game Loop
function gameLoop() {
    if (!isGameRunning) return;
    
    // Apply continuous human inputs (so holding joystick locks direction)
    Object.keys(currentInputs).forEach(id => {
        if (currentInputs[id]) {
            applyInput(id, currentInputs[id]);
        }
    });
    
    // Physics Step
    Matter.Engine.update(engine, 1000 / 60);
    
    // Sync Rendering with Physics
    // Matter.js uses (x,y) where y is down. Three.js uses (x,y,z) where z is towards camera, y is up.
    // We map Matter(x,y) to Three(x, y, 0) and look down on it.
    
    // Note: To match the angled camera and pitch orientation:
    // Matter X -> Three X
    // Matter Y -> Three Y
    // Z is up (height)
    
    if (ballMesh && ballBody) {
        ballMesh.position.x = ballBody.position.x;
        ballMesh.position.y = -ballBody.position.y; // Flip Y for 3D coordinate system
        ballMesh.position.z = BALL_RADIUS; // Sitting on pitch
        
        // Simple rotation based on velocity
        ballMesh.rotation.x += ballBody.velocity.y * 0.1;
        ballMesh.rotation.y += ballBody.velocity.x * 0.1;
    }
    
    // Corner Flags rendering sync
    if (window.flagMeshes && window.cornerFlags) {
        window.cornerFlags.forEach((flag, i) => {
            const mesh = window.flagMeshes[i];
            mesh.position.x = flag.body.position.x;
            mesh.position.y = -flag.body.position.y;
            
            // Calculate bending angle
            const dx = flag.body.position.x - flag.startX;
            const dy = flag.body.position.y - flag.startY;
            mesh.rotation.z = dy * -0.05;
            mesh.rotation.x = Math.PI/2 + dx * -0.05;
        });
    }
    
    // --- AI LOGIC ---
    Object.keys(playerBodies).forEach(id => {
        const p = players[id];
        if (p && p.isBot && ballBody) {
            const body = playerBodies[id];
            
            // Tactical Intelligence: Goalkeeper Mode
            // Bots will prioritize defending their own goal rather than chasing the ball
            const myGoalX = p.team === 'A' ? -PITCH_WIDTH/2 : PITCH_WIDTH/2;
            const defLineX = p.team === 'A' ? myGoalX + 150 : myGoalX - 150; // Stand in front of goal
            
            // Track the ball's Y position to block shots, but stay inside the penalty box
            let defLineY = ballBody.position.y;
            const boxLimit = GOAL_WIDTH/2 + 100;
            if (defLineY < -boxLimit) defLineY = -boxLimit;
            if (defLineY > boxLimit) defLineY = boxLimit;
            
            let targetX = defLineX;
            let targetY = defLineY;
            
            // If ball comes dangerously close to the goal, rush the ball to clear it
            const distToBall = Matter.Vector.magnitude(Matter.Vector.sub(ballBody.position, body.position));
            if (distToBall < 350 && Math.abs(ballBody.position.x - myGoalX) < 400) {
                targetX = ballBody.position.x;
                targetY = ballBody.position.y;
            }
            
            // Calculate input to target
            const dx = targetX - body.position.x;
            const dy = targetY - body.position.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            let inputX = 0;
            let inputY = 0;
            let sprint = false;
            let shoot = false;
            
            if (dist > 20) {
                inputX = dx / dist;
                inputY = dy / dist;
                if (dist > 200) sprint = true; // Sprint if far
            }
            
            // Shoot if near ball and near enemy goal
            if (dist < 60) {
                const goalX = p.team === 'A' ? PITCH_WIDTH/2 : -PITCH_WIDTH/2;
                if (Math.abs(body.position.x - goalX) < 500) {
                    shoot = true;
                    // Aim at goal
                    inputX = (goalX - body.position.x) > 0 ? 1 : -1;
                    inputY = (0 - body.position.y) > 0 ? 1 : -1;
                }
            }
            
            // Apply bot input
            applyInput(id, { x: inputX, y: inputY, btns: { sprint, shoot } });
        }
    });

    const now = performance.now();

    Object.keys(playerBodies).forEach(id => {
        const body = playerBodies[id];
        const meshGroup = playerMeshes[id];
        
        if (body && meshGroup) {
            meshGroup.position.x = body.position.x;
            meshGroup.position.y = -body.position.y;
            
            const speed = Matter.Vector.magnitude(body.velocity);
            
            // Living Pitch: Throttle texture uploads (saves GPU on mobile/laptops)
            if (speed > 2.8 && window.pitchCtx && (now - lastScuffTime > 300)) {
                lastScuffTime = now;
                const cx = (body.position.x / PITCH_WIDTH) * 2048 + 1024;
                const cy = (body.position.y / PITCH_WIDTH) * 2048 + 1024; 
                
                window.pitchCtx.fillStyle = `rgba(30, 20, 10, ${Math.min(speed * 0.05, 0.3)})`;
                window.pitchCtx.beginPath();
                window.pitchCtx.arc(cx, cy, 3 + Math.random() * 3, 0, Math.PI * 2);
                window.pitchCtx.fill();
                window.pitchTexture.needsUpdate = true; // Trigger GPU upload
            }
            
            // Procedural Anatomical Animation
            const data = meshGroup.userData;
            data.time += speed * 0.1;
            
            if (speed > 0.5) {
                // Rotate player to face movement direction
                const angle = Math.atan2(-body.velocity.y, body.velocity.x);
                data.torso.rotation.z = angle - Math.PI/2;
                
                // Walking/Sprinting Cycle
                const swing = Math.sin(data.time);
                data.leftArm.position.y = swing * 5;
                data.rightArm.position.y = -swing * 5;
                data.leftLeg.position.y = -swing * 6;
                data.rightLeg.position.y = swing * 6;
                
                // Secondary Animation (Jersey tail flaps in wind)
                data.tail.rotation.x = -Math.PI / 4 + Math.sin(data.time * 2) * 0.2;
            } else {
                // Idle
                data.leftArm.position.y = 0;
                data.rightArm.position.y = 0;
                data.leftLeg.position.y = 0;
                data.rightLeg.position.y = 0;
                data.tail.rotation.x = -Math.PI / 4;
            }
        }
    });
    
    // Camera follow ball gently (Updated for larger pitch)
    if (ballBody) {
        const targetCamX = ballBody.position.x * 0.4;
        const targetCamY = -ballBody.position.y * 0.4 - 1000;
        
        camera.position.x += (targetCamX - camera.position.x) * 0.05;
        camera.position.y += (targetCamY - camera.position.y) * 0.05;
        camera.lookAt(camera.position.x, camera.position.y + 1000, 0);
    }
    
    renderer.render(scene, camera);
    
    // Broadcast live game state to mobile clients at 30Hz (Ultra-Low Latency, no bufferbloat)
    if (socket && socket.connected && ballBody && (now - lastSyncTime >= 33)) {
        lastSyncTime = now;
        const pState = Object.keys(playerBodies).map(id => {
            const b = playerBodies[id];
            const p = players[id] || {};
            return {
                id,
                x: Math.round(b.position.x),
                y: Math.round(b.position.y),
                vx: Number(b.velocity.x.toFixed(1)),
                vy: Number(b.velocity.y.toFixed(1)),
                team: p.team,
                number: p.number,
                username: p.username,
                color: p.color
            };
        });
        
        socket.emit('sync_game_state', {
            ball: {
                x: Math.round(ballBody.position.x),
                y: Math.round(ballBody.position.y),
                vx: Number(ballBody.velocity.x.toFixed(1)),
                vy: Number(ballBody.velocity.y.toFixed(1))
            },
            players: pState,
            score,
            matchTimer
        });
    }
    
    requestAnimationFrame(gameLoop);
}
