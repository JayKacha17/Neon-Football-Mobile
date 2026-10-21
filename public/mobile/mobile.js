// Neon Football Mobile - Standalone & LAN Multiplayer Client

const PITCH_WIDTH = 2100;
const PITCH_HEIGHT = 1360;
const GOAL_WIDTH = 240;
const PLAYER_RADIUS = 20;
const BALL_RADIUS = 10;

// Game State
let isGameActive = false;
let gameMode = 'offline'; // 'offline' | 'lan'
let socket = null;
let myPlayerId = 'solo_player';
let myTeam = 'A';
let myUsername = 'Striker';

// Physics (Offline Solo Mode)
let engine = null;
let world = null;
let localBodies = {
    ball: null,
    players: {},
    walls: [],
    goals: { A: null, B: null }
};

// 3D Rendering (Three.js)
let scene, camera, renderer;
let ballMesh;
let playerMeshes = {};
let matchTimer = 180;
let matchInterval = null;
let score = { A: 0, B: 0 };
let isResetting = false;
let targetBall = { x: 0, y: 0 };
let targetPlayers = {};
let lastMobileInputSend = 0;
let offlinePossessionId = null;
let offlinePossessionCooldown = 0;

// Touch Inputs
let inputState = {
    x: 0,
    y: 0,
    btns: { sprint: false, shoot: false, pass: false }
};

// DOM Elements
const menuScreen = document.getElementById('menu-screen');
const joinModal = document.getElementById('join-modal');
const guideModal = document.getElementById('guide-modal');
const gameHud = document.getElementById('game-hud');
const hudScoreA = document.getElementById('hud-score-a');
const hudScoreB = document.getElementById('hud-score-b');
const hudTimer = document.getElementById('hud-timer');
const hudBadge = document.getElementById('hud-network-badge');
const hudAnnouncer = document.getElementById('hud-announcer');
const radarCanvas = document.getElementById('pitch-radar');
const radarCtx = radarCanvas.getContext('2d');

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', () => {
    initThreeScene();
    setupTouchControls();
    setupMenuHandlers();
    
    // Register PWA service worker if available
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
});

// --- MENU & UI HANDLERS ---
function setupMenuHandlers() {
    document.getElementById('btn-mode-offline').addEventListener('click', () => {
        startOfflineMatch();
    });

    document.getElementById('btn-mode-join').addEventListener('click', () => {
        joinModal.classList.add('active');
    });

    document.getElementById('btn-close-join').addEventListener('click', () => {
        joinModal.classList.remove('active');
    });

    document.getElementById('btn-mode-host').addEventListener('click', () => {
        // Direct to Host screen (PC or mobile host)
        window.location.href = '/game';
    });

    document.getElementById('btn-hotspot-guide').addEventListener('click', () => {
        guideModal.classList.add('active');
    });

    document.getElementById('btn-close-guide').addEventListener('click', () => {
        guideModal.classList.remove('active');
    });

    // Team selector chips
    document.querySelectorAll('.team-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.team-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            myTeam = chip.dataset.team;
        });
    });

    document.getElementById('btn-confirm-join').addEventListener('click', () => {
        const name = document.getElementById('player-name').value.trim() || 'Striker';
        const code = document.getElementById('join-code').value.trim().toUpperCase();
        const customIp = document.getElementById('host-ip').value.trim();
        
        if (!code || code.length !== 4) {
            showJoinError('Please enter a valid 4-letter Room Code');
            return;
        }

        connectToLanMatch(name, code, customIp);
    });

    // Customize Controls Modal Handlers
    const customizeModal = document.getElementById('customize-modal');
    document.getElementById('btn-customize-controls').addEventListener('click', () => {
        customizeModal.classList.add('active');
    });

    document.getElementById('btn-close-customize').addEventListener('click', () => {
        customizeModal.classList.remove('active');
    });

    // Control Settings Options
    let tempScale = 1.25;
    let tempLayout = 'left';
    let tempBottom = 24;

    document.querySelectorAll('#ctrl-size-selector .opt-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#ctrl-size-selector .opt-chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            tempScale = parseFloat(btn.dataset.scale) || 1.25;
        });
    });

    document.querySelectorAll('#ctrl-layout-selector .opt-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#ctrl-layout-selector .opt-chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            tempLayout = btn.dataset.layout || 'left';
        });
    });

    document.querySelectorAll('#ctrl-height-selector .opt-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#ctrl-height-selector .opt-chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            tempBottom = parseInt(btn.dataset.bottom, 10) || 24;
        });
    });

    document.getElementById('btn-save-controls').addEventListener('click', () => {
        const config = { scale: tempScale, layout: tempLayout, bottom: tempBottom };
        try {
            localStorage.setItem('neon_control_config', JSON.stringify(config));
        } catch(e) {}
        applyControlConfig(config);
        customizeModal.classList.remove('active');
    });

    // Load saved control configuration
    loadSavedControls();

    document.getElementById('btn-quit-match').addEventListener('click', () => {
        quitMatch();
    });
}

function loadSavedControls() {
    try {
        const saved = localStorage.getItem('neon_control_config');
        if (saved) {
            const config = JSON.parse(saved);
            applyControlConfig(config);
            
            // Sync active chips in modal
            document.querySelectorAll('#ctrl-size-selector .opt-chip').forEach(b => {
                b.classList.toggle('active', parseFloat(b.dataset.scale) === config.scale);
            });
            document.querySelectorAll('#ctrl-layout-selector .opt-chip').forEach(b => {
                b.classList.toggle('active', b.dataset.layout === config.layout);
            });
            document.querySelectorAll('#ctrl-height-selector .opt-chip').forEach(b => {
                b.classList.toggle('active', parseInt(b.dataset.bottom, 10) === config.bottom);
            });
        } else {
            applyControlConfig({ scale: 1.25, layout: 'left', bottom: 24 });
        }
    } catch(e) {
        applyControlConfig({ scale: 1.25, layout: 'left', bottom: 24 });
    }
}

function applyControlConfig(cfg) {
    const root = document.documentElement;
    root.style.setProperty('--ctrl-scale', cfg.scale);
    root.style.setProperty('--ctrl-bottom', `${cfg.bottom}px`);
    if (cfg.layout === 'right') {
        root.style.setProperty('--joystick-left', 'auto');
        root.style.setProperty('--joystick-right', '28px');
        root.style.setProperty('--action-left', '28px');
        root.style.setProperty('--action-right', 'auto');
    } else {
        root.style.setProperty('--joystick-left', '28px');
        root.style.setProperty('--joystick-right', 'auto');
        root.style.setProperty('--action-left', 'auto');
        root.style.setProperty('--action-right', '28px');
    }
}

function showJoinError(msg) {
    const el = document.getElementById('join-status-msg');
    el.innerText = msg;
    setTimeout(() => { el.innerText = ''; }, 3000);
}

function quitMatch() {
    isGameActive = false;
    clearInterval(matchInterval);
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    gameHud.classList.remove('active');
    menuScreen.classList.add('active');
}

// --- 3D RENDERING SYSTEM ---
function initThreeScene() {
    const container = document.getElementById('canvas-container');
    
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070714);

    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 10, 5000);
    camera.position.set(0, -950, 1400);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(200, -400, 800);
    dirLight.castShadow = true;
    scene.add(dirLight);

    buildPitchAndStadium();
    buildGoalPosts();

    // Ball Mesh
    const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 16, 16);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
    ballMesh = new THREE.Mesh(ballGeo, ballMat);
    ballMesh.castShadow = true;
    scene.add(ballMesh);

    window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function buildPitchAndStadium() {
    // Pitch Texture with realistic markings
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 2048;
    const ctx = canvas.getContext('2d');

    // Turf Stripes
    const stripeCount = 14;
    const sH = 2048 / stripeCount;
    for (let i = 0; i < stripeCount; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#1b4d24' : '#225d2c';
        ctx.fillRect(0, i * sH, 2048, sH);
    }

    // Lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 8;
    const cw = 2048;
    const ch = 2048 * (PITCH_HEIGHT / PITCH_WIDTH);
    const offsetY = (2048 - ch) / 2;

    // Bounds
    ctx.strokeRect(0, offsetY, cw, ch);
    // Center line
    ctx.beginPath();
    ctx.moveTo(cw / 2, offsetY);
    ctx.lineTo(cw / 2, offsetY + ch);
    ctx.stroke();
    // Center circle & spot
    ctx.beginPath();
    ctx.arc(cw / 2, offsetY + ch / 2, 180, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cw / 2, offsetY + ch / 2, 10, 0, Math.PI * 2);
    ctx.fill();

    // Penalty areas (18-yard box)
    ctx.strokeRect(0, offsetY + ch / 2 - 350, 280, 700);
    ctx.strokeRect(cw - 280, offsetY + ch / 2 - 350, 280, 700);
    // 6-yard box
    ctx.strokeRect(0, offsetY + ch / 2 - 150, 90, 300);
    ctx.strokeRect(cw - 90, offsetY + ch / 2 - 150, 90, 300);

    // Penalty spots
    ctx.beginPath();
    ctx.arc(200, offsetY + ch / 2, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cw - 200, offsetY + ch / 2, 8, 0, Math.PI * 2);
    ctx.fill();

    const pitchTexture = new THREE.CanvasTexture(canvas);
    const pitchMat = new THREE.MeshStandardMaterial({ map: pitchTexture, roughness: 0.8 });
    const pitchMesh = new THREE.Mesh(new THREE.PlaneGeometry(PITCH_WIDTH, PITCH_WIDTH), pitchMat);
    pitchMesh.receiveShadow = true;
    scene.add(pitchMesh);

    // Stadium Bleachers
    const standMat = new THREE.MeshStandardMaterial({ color: 0x1f2136, roughness: 0.9 });
    const topStand = new THREE.Mesh(new THREE.BoxGeometry(PITCH_WIDTH + 600, PITCH_HEIGHT / 2, 250), standMat);
    topStand.position.set(0, PITCH_HEIGHT + 150, 80);
    topStand.rotation.x = -Math.PI / 6;
    scene.add(topStand);

    const bottomStand = new THREE.Mesh(new THREE.BoxGeometry(PITCH_WIDTH + 600, PITCH_HEIGHT / 2, 250), standMat);
    bottomStand.position.set(0, -PITCH_HEIGHT - 150, 80);
    bottomStand.rotation.x = Math.PI / 6;
    scene.add(bottomStand);
}

function buildGoalPosts() {
    function createGoal(xOffset, color, isRight) {
        const goalGroup = new THREE.Group();
        const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
        const postGeo = new THREE.CylinderGeometry(4, 4, 100);

        // Posts
        const p1 = new THREE.Mesh(postGeo, postMat);
        p1.position.set(0, GOAL_WIDTH / 2, 50);
        p1.rotation.x = Math.PI / 2;
        goalGroup.add(p1);

        const p2 = new THREE.Mesh(postGeo, postMat);
        p2.position.set(0, -GOAL_WIDTH / 2, 50);
        p2.rotation.x = Math.PI / 2;
        goalGroup.add(p2);

        // Crossbar
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, GOAL_WIDTH), postMat);
        bar.position.set(0, 0, 100);
        goalGroup.add(bar);

        // Net
        const netMat = new THREE.MeshStandardMaterial({ color, wireframe: true, transparent: true, opacity: 0.5 });
        const netDepth = 75;
        const backNet = new THREE.Mesh(new THREE.PlaneGeometry(100, GOAL_WIDTH), netMat);
        backNet.position.set(isRight ? netDepth : -netDepth, 0, 50);
        backNet.rotation.y = Math.PI / 2;
        goalGroup.add(backNet);

        goalGroup.position.set(xOffset, 0, 0);
        scene.add(goalGroup);
    }
    createGoal(-PITCH_WIDTH / 2, 0x00ffcc, false);
    createGoal(PITCH_WIDTH / 2, 0xff00ff, true);
}

function createPlayerMesh(id, color, team = 'A') {
    const group = new THREE.Group();
    const hex = parseInt((color || (team === 'A' ? '#00ffcc' : '#ff00ff')).replace('#', ''), 16) || 0x00ffcc;
    const teamColor = new THREE.Color(hex);
    const shortsColor = new THREE.Color(team === 'A' ? 0x004438 : 0x440038);

    // PBR Materials
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xffdcb1, roughness: 0.35, metalness: 0.05 }); 
    const jerseyMat = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.6, emissive: teamColor.clone().multiplyScalar(0.25) });
    const shortsMat = new THREE.MeshStandardMaterial({ color: shortsColor, roughness: 0.7 });
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 });
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x241408, roughness: 0.85 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });

    // Torso / Jersey (Athletic V-Shape)
    const torsoGeo = new THREE.BoxGeometry(17, 24, 11);
    const torso = new THREE.Mesh(torsoGeo, jerseyMat);
    torso.position.z = 26; // Height off ground
    torso.castShadow = true;
    group.add(torso);

    // Kit Number / Stripe on chest
    const chestStripe = new THREE.Mesh(new THREE.PlaneGeometry(8, 12), stripeMat);
    chestStripe.position.set(0, 5.6, 0);
    chestStripe.rotation.x = Math.PI / 2;
    torso.add(chestStripe);

    // 3D Head with Hair
    const headGeo = new THREE.SphereGeometry(6.5, 16, 16);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.set(0, 0, 16);
    head.castShadow = true;
    torso.add(head);

    const hairGeo = new THREE.SphereGeometry(6.7, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const hair = new THREE.Mesh(hairGeo, hairMat);
    hair.position.set(0, 0, 1.2);
    head.add(hair);

    // Arms (Sleeves + Forearms)
    const sleeveGeo = new THREE.BoxGeometry(4.5, 7, 4.5);
    const forearmGeo = new THREE.BoxGeometry(4, 11, 4);

    const leftArmGroup = new THREE.Group();
    leftArmGroup.position.set(-11, 0, 3);
    const leftSleeve = new THREE.Mesh(sleeveGeo, jerseyMat);
    leftSleeve.position.set(0, 0, -2);
    leftArmGroup.add(leftSleeve);
    const leftForearm = new THREE.Mesh(forearmGeo, skinMat);
    leftForearm.position.set(0, 0, -10);
    leftForearm.castShadow = true;
    leftArmGroup.add(leftForearm);
    torso.add(leftArmGroup);

    const rightArmGroup = new THREE.Group();
    rightArmGroup.position.set(11, 0, 3);
    const rightSleeve = new THREE.Mesh(sleeveGeo, jerseyMat);
    rightSleeve.position.set(0, 0, -2);
    rightArmGroup.add(rightSleeve);
    const rightForearm = new THREE.Mesh(forearmGeo, skinMat);
    rightForearm.position.set(0, 0, -10);
    rightForearm.castShadow = true;
    rightArmGroup.add(rightForearm);
    torso.add(rightArmGroup);

    // Legs (Shorts + Skin + Cleats)
    const shortsGeo = new THREE.BoxGeometry(6, 9, 6);
    const legSkinGeo = new THREE.BoxGeometry(4.5, 11, 4.5);
    const bootGeo = new THREE.BoxGeometry(5.2, 7.5, 4.2);

    const leftLegGroup = new THREE.Group();
    leftLegGroup.position.set(-4.5, 0, -13);
    const leftShort = new THREE.Mesh(shortsGeo, shortsMat);
    leftLegGroup.add(leftShort);
    const leftLegSkin = new THREE.Mesh(legSkinGeo, skinMat);
    leftLegSkin.position.set(0, 0, -9);
    leftLegSkin.castShadow = true;
    leftLegGroup.add(leftLegSkin);
    const leftBoot = new THREE.Mesh(bootGeo, bootMat);
    leftBoot.position.set(0, 1.5, -15);
    leftBoot.castShadow = true;
    leftLegGroup.add(leftBoot);
    torso.add(leftLegGroup);

    const rightLegGroup = new THREE.Group();
    rightLegGroup.position.set(4.5, 0, -13);
    const rightShort = new THREE.Mesh(shortsGeo, shortsMat);
    rightLegGroup.add(rightShort);
    const rightLegSkin = new THREE.Mesh(legSkinGeo, skinMat);
    rightLegSkin.position.set(0, 0, -9);
    rightLegSkin.castShadow = true;
    rightLegGroup.add(rightLegSkin);
    const rightBoot = new THREE.Mesh(bootGeo, bootMat);
    rightBoot.position.set(0, 1.5, -15);
    rightBoot.castShadow = true;
    rightLegGroup.add(rightBoot);
    torso.add(rightLegGroup);

    // Secondary Animation (Jersey flow tail)
    const tailGeo = new THREE.PlaneGeometry(12, 10);
    const tail = new THREE.Mesh(tailGeo, jerseyMat);
    tail.position.set(0, -9, -10);
    tail.rotation.x = -Math.PI / 4;
    torso.add(tail);

    group.userData = {
        torso,
        leftArm: leftArmGroup,
        rightArm: rightArmGroup,
        leftLeg: leftLegGroup,
        rightLeg: rightLegGroup,
        tail,
        animTime: Math.random() * 50
    };
    scene.add(group);
    playerMeshes[id] = group;
    return group;
}


// --- TOUCH CONTROLS ---
function setupTouchControls() {
    const stickZone = document.getElementById('touch-joystick-zone');
    const thumb = document.getElementById('virtual-stick-thumb');
    let touchId = null;
    let baseRect = null;

    stickZone.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        touchId = t.identifier;
        baseRect = stickZone.getBoundingClientRect();
        handleStickMove(t.clientX, t.clientY);
    });

    stickZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === touchId) {
                handleStickMove(e.changedTouches[i].clientX, e.changedTouches[i].clientY);
                break;
            }
        }
    });

    const resetStick = (e) => {
        if (e) e.preventDefault();
        touchId = null;
        inputState.x = 0;
        inputState.y = 0;
        thumb.style.transform = `translate(-50%, -50%)`;
    };

    stickZone.addEventListener('touchend', resetStick);
    stickZone.addEventListener('touchcancel', resetStick);

    function handleStickMove(clientX, clientY) {
        if (!baseRect) baseRect = stickZone.getBoundingClientRect();
        const centerX = baseRect.left + baseRect.width / 2;
        const centerY = baseRect.top + baseRect.height / 2;
        const dx = clientX - centerX;
        const dy = clientY - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxRadius = baseRect.width / 2 - 10;

        let nx = dx;
        let ny = dy;
        if (dist > maxRadius) {
            nx = (dx / dist) * maxRadius;
            ny = (dy / dist) * maxRadius;
        }

        thumb.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;

        // Normalize -1 to 1
        inputState.x = Number((nx / maxRadius).toFixed(2));
        inputState.y = Number((ny / maxRadius).toFixed(2));
    }

    // Action buttons
    const bindBtn = (id, key) => {
        const btn = document.getElementById(id);
        const setOn = (e) => {
            e.preventDefault();
            inputState.btns[key] = true;
            btn.classList.add('active');
            if (navigator.vibrate) navigator.vibrate(30);
        };
        const setOff = (e) => {
            e.preventDefault();
            inputState.btns[key] = false;
            btn.classList.remove('active');
        };
        btn.addEventListener('touchstart', setOn);
        btn.addEventListener('touchend', setOff);
        btn.addEventListener('touchcancel', setOff);
    };

    bindBtn('btn-touch-sprint', 'sprint');
    bindBtn('btn-touch-shoot', 'shoot');
    bindBtn('btn-touch-pass', 'pass');
}

// --- OFFLINE SOLO MATCH MODE ---
function startOfflineMatch() {
    gameMode = 'offline';
    menuScreen.classList.remove('active');
    gameHud.classList.add('active');
    hudBadge.innerText = '🤖 SOLO OFFLINE';

    score = { A: 0, B: 0 };
    matchTimer = 180;
    updateScoreDisplay();

    initOfflinePhysics();
    isGameActive = true;

    clearInterval(matchInterval);
    matchInterval = setInterval(() => {
        matchTimer--;
        updateTimerDisplay();
        if (matchTimer <= 0) {
            endMatch('DRAW');
        }
    }, 1000);

    requestAnimationFrame(offlineGameLoop);
}

function initOfflinePhysics() {
    engine = Matter.Engine.create({ gravity: { x: 0, y: 0 } });
    world = engine.world;

    // Pitch Walls
    const wallOpts = { isStatic: true, restitution: 0.3, friction: 0 };
    localBodies.walls = [
        Matter.Bodies.rectangle(0, -PITCH_HEIGHT / 2 - 25, PITCH_WIDTH, 50, wallOpts),
        Matter.Bodies.rectangle(0, PITCH_HEIGHT / 2 + 25, PITCH_WIDTH, 50, wallOpts),
        Matter.Bodies.rectangle(-PITCH_WIDTH / 2 - 25, -PITCH_HEIGHT / 4 - GOAL_WIDTH / 4, 50, PITCH_HEIGHT / 2 - GOAL_WIDTH / 2, wallOpts),
        Matter.Bodies.rectangle(-PITCH_WIDTH / 2 - 25, PITCH_HEIGHT / 4 + GOAL_WIDTH / 4, 50, PITCH_HEIGHT / 2 - GOAL_WIDTH / 2, wallOpts),
        Matter.Bodies.rectangle(PITCH_WIDTH / 2 + 25, -PITCH_HEIGHT / 4 - GOAL_WIDTH / 4, 50, PITCH_HEIGHT / 2 - GOAL_WIDTH / 2, wallOpts),
        Matter.Bodies.rectangle(PITCH_WIDTH / 2 + 25, PITCH_HEIGHT / 4 + GOAL_WIDTH / 4, 50, PITCH_HEIGHT / 2 - GOAL_WIDTH / 2, wallOpts)
    ];

    // Goal Nets
    const netOpts = { isStatic: true, restitution: 0.1, friction: 0.8 };
    const netD = 75;
    const nets = [
        Matter.Bodies.rectangle(-PITCH_WIDTH / 2 - netD, 0, 20, GOAL_WIDTH, netOpts),
        Matter.Bodies.rectangle(PITCH_WIDTH / 2 + netD, 0, 20, GOAL_WIDTH, netOpts)
    ];

    // Goal Sensors
    localBodies.goals.A = Matter.Bodies.rectangle(-PITCH_WIDTH / 2 - 20, 0, 40, GOAL_WIDTH - 20, { isStatic: true, isSensor: true, label: 'goalA' });
    localBodies.goals.B = Matter.Bodies.rectangle(PITCH_WIDTH / 2 + 20, 0, 40, GOAL_WIDTH - 20, { isStatic: true, isSensor: true, label: 'goalB' });

    // Ball
    localBodies.ball = Matter.Bodies.circle(0, 0, BALL_RADIUS, {
        restitution: 0.3,
        friction: 0.05,
        frictionAir: 0.015,
        density: 0.003
    });

    // Clear old player meshes
    Object.keys(playerMeshes).forEach(k => scene.remove(playerMeshes[k]));
    playerMeshes = {};
    localBodies.players = {};

    // User Player (Team A Cyan)
    const userBody = Matter.Bodies.circle(-PITCH_WIDTH / 5, 0, PLAYER_RADIUS, {
        restitution: 0,
        frictionAir: 0.08,
        density: 0.006,
        label: 'player_user'
    });
    localBodies.players['user'] = userBody;
    createPlayerMesh('user', '#00ffcc', 'A');

    // Bot Goalkeeper (Team B Magenta - Locked on Goal Line)
    const botBody = Matter.Bodies.circle(PITCH_WIDTH / 2 - 70, 0, PLAYER_RADIUS, {
        restitution: 0,
        frictionAir: 0.08,
        density: 0.006,
        label: 'player_bot_b'
    });
    localBodies.players['bot_b'] = botBody;
    createPlayerMesh('bot_b', '#ff00ff', 'B');

    Matter.Composite.add(world, [
        ...localBodies.walls,
        ...nets,
        localBodies.goals.A,
        localBodies.goals.B,
        localBodies.ball,
        userBody,
        botBody
    ]);

    // Goal collision detection
    Matter.Events.on(engine, 'collisionStart', (evt) => {
        evt.pairs.forEach(pair => {
            const labels = [pair.bodyA.label, pair.bodyB.label];
            if (labels.includes('goalA')) triggerGoal('B');
            else if (labels.includes('goalB')) triggerGoal('A');
        });
    });
}

function offlineGameLoop() {
    if (!isGameActive || gameMode !== 'offline') return;

    const nowTime = performance.now();
    const userBody = localBodies.players['user'];
    const botBody = localBodies.players['bot_b'];
    const ball = localBodies.ball;

    // Apply User Touch Input (Smooth, responsive mobile controls)
    if (userBody) {
        const force = inputState.btns.sprint ? 0.0068 : 0.0038;
        Matter.Body.applyForce(userBody, userBody.position, {
            x: inputState.x * force,
            y: inputState.y * force
        });

        // Shooting & Passing
        if (inputState.btns.shoot || inputState.btns.pass) {
            const dist = ball ? Matter.Vector.magnitude(Matter.Vector.sub(ball.position, userBody.position)) : 999;
            if (dist < PLAYER_RADIUS + BALL_RADIUS + 35 || offlinePossessionId === 'user') {
                offlinePossessionId = null;
                offlinePossessionCooldown = nowTime + 400;

                let dir = (Math.abs(inputState.x) > 0.1 || Math.abs(inputState.y) > 0.1)
                    ? Matter.Vector.normalise({ x: inputState.x, y: inputState.y })
                    : (ball ? Matter.Vector.normalise(Matter.Vector.sub(ball.position, userBody.position)) : { x: 1, y: 0 });

                const kickForce = inputState.btns.shoot ? 0.022 : 0.012;
                Matter.Body.applyForce(ball, ball.position, { x: dir.x * kickForce, y: dir.y * kickForce });
            }
        }
    }

    // --- FAIR BALL POSSESSION & DRIBBLE MECHANICS ---
    if (ball) {
        ['user', 'bot_b'].forEach(id => {
            const body = localBodies.players[id];
            if (!body) return;
            const d = Matter.Vector.magnitude(Matter.Vector.sub(ball.position, body.position));
            const touchRadius = PLAYER_RADIUS + BALL_RADIUS + 14;

            if (d < touchRadius) {
                if (!offlinePossessionId && nowTime > offlinePossessionCooldown) {
                    offlinePossessionId = id;
                } else if (offlinePossessionId && offlinePossessionId !== id && nowTime > offlinePossessionCooldown) {
                    // Fair dispossession / steal contest
                    const oppSpeed = Matter.Vector.magnitude(body.velocity);
                    const isTackling = (id === 'user' && (inputState.btns.shoot || inputState.btns.pass)) || oppSpeed > 1.2;
                    if (isTackling) {
                        offlinePossessionId = id;
                        offlinePossessionCooldown = nowTime + 350;
                    }
                }
            }
        });

        // Tether ball smoothly to front of dribbler's feet
        if (offlinePossessionId && localBodies.players[offlinePossessionId]) {
            const pBody = localBodies.players[offlinePossessionId];
            let angle = 0;
            const spd = Matter.Vector.magnitude(pBody.velocity);
            if (spd > 0.3) {
                angle = Math.atan2(pBody.velocity.y, pBody.velocity.x);
            } else {
                angle = offlinePossessionId === 'user' ? 0 : Math.PI;
            }

            const frontOffset = PLAYER_RADIUS + BALL_RADIUS + 3;
            const targetBx = pBody.position.x + Math.cos(angle) * frontOffset;
            const targetBy = pBody.position.y + Math.sin(angle) * frontOffset;

            const steerX = targetBx - ball.position.x;
            const steerY = targetBy - ball.position.y;
            Matter.Body.setVelocity(ball, {
                x: pBody.velocity.x * 0.95 + steerX * 0.35,
                y: pBody.velocity.y * 0.95 + steerY * 0.35
            });
        }
    }

    // --- BOT GOALKEEPER AI (Strictly confined to Goal Line) ---
    if (botBody && ball) {
        const goalLineX = PITCH_WIDTH / 2 - 70;
        const maxGoalY = GOAL_WIDTH / 2 - 15;
        let targetY = ball.position.y;
        if (targetY < -maxGoalY) targetY = -maxGoalY;
        if (targetY > maxGoalY) targetY = maxGoalY;

        const dy = targetY - botBody.position.y;
        const dx = goalLineX - botBody.position.x;
        const dist = Math.sqrt(dx * dx + dy * dy);

        let inputX = 0;
        let inputY = 0;
        if (dist > 8) {
            inputX = dx / dist;
            inputY = dy / dist;
        }

        const distToBall = Matter.Vector.magnitude(Matter.Vector.sub(ball.position, botBody.position));
        if (distToBall < PLAYER_RADIUS + BALL_RADIUS + 30) {
            // Save & Clear shot away from goal
            offlinePossessionId = null;
            offlinePossessionCooldown = nowTime + 400;
            const clearDir = Matter.Vector.normalise({ x: -1, y: (Math.random() - 0.5) * 0.6 });
            Matter.Body.applyForce(ball, ball.position, { x: clearDir.x * 0.018, y: clearDir.y * 0.018 });
        } else {
            Matter.Body.applyForce(botBody, botBody.position, {
                x: inputX * 0.005,
                y: inputY * 0.005
            });
        }
    }

    // Step physics
    Matter.Engine.update(engine, 1000 / 60);

    // Sync 3D Meshes
    if (ballMesh && ball) {
        ballMesh.position.x = ball.position.x;
        ballMesh.position.y = -ball.position.y;
        ballMesh.position.z = BALL_RADIUS;
        ballMesh.rotation.x += ball.velocity.y * 0.1;
        ballMesh.rotation.y += ball.velocity.x * 0.1;
    }

    // Sync players with smooth anatomical animation
    Object.keys(localBodies.players).forEach(id => {
        const b = localBodies.players[id];
        const m = playerMeshes[id];
        if (b && m) {
            m.position.x = b.position.x;
            m.position.y = -b.position.y;
            const spd = Matter.Vector.magnitude(b.velocity);
            const data = m.userData;
            data.animTime += spd * 0.1;

            if (spd > 0.4) {
                const angle = Math.atan2(-b.velocity.y, b.velocity.x);
                data.torso.rotation.z = angle - Math.PI / 2;
                const sw = Math.sin(data.animTime);
                data.leftArm.position.y = sw * 5;
                data.rightArm.position.y = -sw * 5;
                data.leftLeg.position.y = -sw * 6;
                data.rightLeg.position.y = sw * 6;
                if (data.tail) data.tail.rotation.x = -Math.PI / 4 + Math.sin(data.animTime * 2) * 0.2;
            } else {
                data.leftArm.position.y = 0;
                data.rightArm.position.y = 0;
                data.leftLeg.position.y = 0;
                data.rightLeg.position.y = 0;
                if (data.tail) data.tail.rotation.x = -Math.PI / 4;
            }
        }
    });

    // Dynamic Mobile Camera: Follows User & Ball smoothly
    if (userBody && ball) {
        const focusX = (userBody.position.x + ball.position.x) / 2;
        const focusY = (-userBody.position.y + -ball.position.y) / 2;
        camera.position.x += (focusX * 0.5 - camera.position.x) * 0.05;
        camera.position.y += (focusY * 0.5 - 900 - camera.position.y) * 0.05;
        camera.lookAt(camera.position.x, camera.position.y + 900, 0);
    }

    renderRadar();
    renderer.render(scene, camera);
    requestAnimationFrame(offlineGameLoop);
}

function triggerGoal(team) {
    if (isResetting) return;
    isResetting = true;
    score[team]++;
    updateScoreDisplay();

    announceGoal(`GOAL TEAM ${team}!`);
    if (navigator.vibrate) navigator.vibrate([100, 50, 200]);

    setTimeout(() => {
        // Reset positions to center
        offlinePossessionId = null;
        offlinePossessionCooldown = performance.now() + 1000;

        if (localBodies.ball) {
            Matter.Body.setPosition(localBodies.ball, { x: 0, y: 0 });
            Matter.Body.setVelocity(localBodies.ball, { x: 0, y: 0 });
        }
        if (localBodies.players['user']) {
            Matter.Body.setPosition(localBodies.players['user'], { x: -PITCH_WIDTH / 5, y: 0 });
            Matter.Body.setVelocity(localBodies.players['user'], { x: 0, y: 0 });
        }
        if (localBodies.players['bot_b']) {
            Matter.Body.setPosition(localBodies.players['bot_b'], { x: PITCH_WIDTH / 2 - 70, y: 0 });
            Matter.Body.setVelocity(localBodies.players['bot_b'], { x: 0, y: 0 });
        }
        isResetting = false;
    }, 2500);
}

// --- LAN / WI-FI MULTIPLAYER MODE ---
function connectToLanMatch(name, code, customIp) {
    gameMode = 'lan';
    myUsername = name;

    const hostAddress = customIp ? (customIp.startsWith('http') ? customIp : `http://${customIp}:3000`) : window.location.origin;
    
    // Connect socket
    socket = io(hostAddress);

    socket.on('connect', () => {
        socket.emit('join_room', {
            shortCode: code,
            username: myUsername,
            color: myTeam === 'A' ? '#00ffcc' : '#ff00ff'
        });
    });

    socket.on('join_success', (data) => {
        joinModal.classList.remove('active');
        menuScreen.classList.remove('active');
        gameHud.classList.add('active');
        hudBadge.innerText = `📶 LAN ROOM: ${code}`;
        myPlayerId = socket.id;
        isGameActive = true;
        requestAnimationFrame(lanGameLoop);
    });

    socket.on('join_error', (data) => {
        showJoinError(data.message || 'Could not join room');
    });

    socket.on('game_state_update', (state) => {
        if (!isGameActive) return;
        
        // Target Ball position
        if (state.ball) {
            targetBall.x = state.ball.x;
            targetBall.y = -state.ball.y;
        }

        // Target Players
        if (state.players) {
            state.players.forEach(p => {
                targetPlayers[p.id] = {
                    x: p.x,
                    y: -p.y,
                    vx: p.vx,
                    vy: p.vy,
                    color: p.color,
                    team: p.team
                };
            });
        }

        // Update Score & Timer
        if (state.score) {
            score = state.score;
            updateScoreDisplay();
        }
        if (state.matchTimer !== undefined) {
            matchTimer = state.matchTimer;
            updateTimerDisplay();
        }
    });

    socket.on('host_disconnected', () => {
        alert('LAN Host closed the match');
        quitMatch();
    });
}

function lanGameLoop() {
    if (!isGameActive || gameMode !== 'lan') return;

    // Send touch controls to LAN Host throttled (60fps max ~16ms)
    const now = performance.now();
    if (socket && socket.connected && (now - lastMobileInputSend >= 16)) {
        lastMobileInputSend = now;
        socket.emit('controller_input', inputState);
    }

    // Smoothly interpolate Ball position
    if (ballMesh) {
        ballMesh.position.x += (targetBall.x - ballMesh.position.x) * 0.45;
        ballMesh.position.y += (targetBall.y - ballMesh.position.y) * 0.45;
        ballMesh.position.z = BALL_RADIUS;
    }

    // Smoothly interpolate Player positions and anims
    Object.keys(targetPlayers).forEach(id => {
        const tp = targetPlayers[id];
        if (!playerMeshes[id]) {
            createPlayerMesh(id, tp.color || (tp.team === 'A' ? '#00ffcc' : '#ff00ff'), tp.team);
        }
        const m = playerMeshes[id];
        if (m) {
            m.position.x += (tp.x - m.position.x) * 0.4;
            m.position.y += (tp.y - m.position.y) * 0.4;

            const spd = Math.sqrt(tp.vx * tp.vx + tp.vy * tp.vy);
            const data = m.userData;
            data.animTime += spd * 0.1;

            if (spd > 0.4) {
                const angle = Math.atan2(tp.vy, tp.vx);
                data.torso.rotation.z = angle - Math.PI / 2;
                const sw = Math.sin(data.animTime);
                data.leftArm.position.y = sw * 5;
                data.rightArm.position.y = -sw * 5;
                data.leftLeg.position.y = -sw * 6;
                data.rightLeg.position.y = sw * 6;
                if (data.tail) data.tail.rotation.x = -Math.PI / 4 + Math.sin(data.animTime * 2) * 0.2;
            } else {
                data.leftArm.position.y = 0;
                data.rightArm.position.y = 0;
                data.leftLeg.position.y = 0;
                data.rightLeg.position.y = 0;
                if (data.tail) data.tail.rotation.x = -Math.PI / 4;
            }
        }
    });

    // Camera follow user player if available
    const myMesh = playerMeshes[myPlayerId];
    if (myMesh && ballMesh) {
        const camX = (myMesh.position.x + ballMesh.position.x) / 2;
        const camY = (myMesh.position.y + ballMesh.position.y) / 2;
        camera.position.x += (camX * 0.4 - camera.position.x) * 0.05;
        camera.position.y += (camY * 0.4 - 950 - camera.position.y) * 0.05;
        camera.lookAt(camera.position.x, camera.position.y + 950, 0);
    }

    renderRadar();
    renderer.render(scene, camera);
    requestAnimationFrame(lanGameLoop);
}

// --- RADAR / MINIMAP ---
function renderRadar() {
    radarCtx.clearRect(0, 0, radarCanvas.width, radarCanvas.height);

    // Pitch background
    radarCtx.fillStyle = 'rgba(27, 77, 36, 0.85)';
    radarCtx.fillRect(0, 0, radarCanvas.width, radarCanvas.height);
    radarCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    radarCtx.lineWidth = 1;
    radarCtx.strokeRect(0, 0, radarCanvas.width, radarCanvas.height);
    // Center line
    radarCtx.beginPath();
    radarCtx.moveTo(radarCanvas.width / 2, 0);
    radarCtx.lineTo(radarCanvas.width / 2, radarCanvas.height);
    radarCtx.stroke();

    // Map 3D coordinate (-PITCH_WIDTH/2 to +PITCH_WIDTH/2) to radar canvas
    const mapX = (x) => ((x + PITCH_WIDTH / 2) / PITCH_WIDTH) * radarCanvas.width;
    const mapY = (y) => ((-y + PITCH_HEIGHT / 2) / PITCH_HEIGHT) * radarCanvas.height;

    // Draw Ball
    if (ballMesh) {
        radarCtx.fillStyle = '#ffffff';
        radarCtx.beginPath();
        radarCtx.arc(mapX(ballMesh.position.x), mapY(ballMesh.position.y), 2.5, 0, Math.PI * 2);
        radarCtx.fill();
    }

    // Draw Players
    Object.keys(playerMeshes).forEach(id => {
        const m = playerMeshes[id];
        const isUser = id === myPlayerId || id === 'user';
        radarCtx.fillStyle = isUser ? '#ffff00' : (m.position.x < 0 ? '#00ffcc' : '#ff00ff');
        radarCtx.beginPath();
        radarCtx.arc(mapX(m.position.x), mapY(m.position.y), isUser ? 4 : 3, 0, Math.PI * 2);
        radarCtx.fill();
    });
}

// --- HUD HELPERS ---
function updateScoreDisplay() {
    hudScoreA.innerText = score.A;
    hudScoreB.innerText = score.B;
}

function updateTimerDisplay() {
    const mins = Math.floor(matchTimer / 60);
    const secs = matchTimer % 60;
    hudTimer.innerText = `${mins}:${secs.toString().padStart(2, '0')}`;
}

function announceGoal(text) {
    hudAnnouncer.innerText = text;
    hudAnnouncer.classList.add('show');
    setTimeout(() => {
        hudAnnouncer.classList.remove('show');
    }, 2000);
}

function endMatch(winner) {
    isGameActive = false;
    clearInterval(matchInterval);
    announceGoal(`MATCH OVER! ${winner}`);
    setTimeout(() => {
        quitMatch();
    }, 4000);
}
