// ==============================
// INIT THREE.JS & POST-PROCESSING
// ==============================
const container = document.getElementById('game-container');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x050505, 0.02); // Deep darkness fading

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
// Camera will be controlled dynamically

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.toneMapping = THREE.ReinhardToneMapping;
container.appendChild(renderer.domElement);

// Post-processing for Neon Glow (Bloom)
const renderScene = new THREE.RenderPass(scene, camera);
const bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
bloomPass.threshold = 0.1;
bloomPass.strength = 1.8;
bloomPass.radius = 0.5;

const composer = new THREE.EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

// ==============================
// ENVIRONMENT (CYBERPUNK GRID)
// ==============================
const bounds = 25; // Grid limits from -bounds to +bounds (50x50 playable area)
const gridSize = bounds * 2;

// Main Grid
const gridHelper = new THREE.GridHelper(gridSize, gridSize, 0x00ffff, 0x00ffff);
gridHelper.position.y = -0.5;
gridHelper.material.opacity = 0.15;
gridHelper.material.transparent = true;
scene.add(gridHelper);

// Border Walls
const wallMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.3 });
const wallGeoX = new THREE.BoxGeometry(gridSize + 1, 2, 1);
const wallGeoZ = new THREE.BoxGeometry(1, 2, gridSize + 1);

const wallN = new THREE.Mesh(wallGeoX, wallMaterial); wallN.position.set(0, 0.5, -bounds - 0.5); scene.add(wallN);
const wallS = new THREE.Mesh(wallGeoX, wallMaterial); wallS.position.set(0, 0.5, bounds + 0.5); scene.add(wallS);
const wallE = new THREE.Mesh(wallGeoZ, wallMaterial); wallE.position.set(bounds + 0.5, 0.5, 0); scene.add(wallE);
const wallW = new THREE.Mesh(wallGeoZ, wallMaterial); wallW.position.set(-bounds - 0.5, 0.5, 0); scene.add(wallW);

// Floating particles
const particlesGeo = new THREE.BufferGeometry();
const particlesCount = 300;
const posArray = new Float32Array(particlesCount * 3);
for(let i=0; i < particlesCount*3; i++) {
    posArray[i] = (Math.random() - 0.5) * gridSize * 1.5;
}
particlesGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
const particlesMat = new THREE.PointsMaterial({ size: 0.1, color: 0x00ffff, transparent: true, opacity: 0.5 });
const particlesMesh = new THREE.Points(particlesGeo, particlesMat);
particlesMesh.position.y = 5;
scene.add(particlesMesh);

// ==============================
// GAME LOGIC & OBJECTS
// ==============================
let snakeLogic = [];
let snakeMeshes = [];
let moveDirection = { x: 1, z: 0 };
let inputQueue = [];

let foodPos = { x: 0, z: 0 };
let foodMesh;

let score = 0;
let isGameOver = true;
let lastTickTime = 0;
let tickRate = 120; // ms per move (lower is faster)

// Materials
const snakeMat = new THREE.MeshStandardMaterial({ color: 0x00ff00, emissive: 0x00ff00, emissiveIntensity: 0.8, roughness: 0.2 });
const snakeHeadMat = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 1.0, roughness: 0.1 });
const segmentGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);

const foodMat = new THREE.MeshStandardMaterial({ color: 0xff00ff, emissive: 0xff00ff, emissiveIntensity: 1.5 });
const foodGeo = new THREE.OctahedronGeometry(0.5);

// Lights
const ambientLight = new THREE.AmbientLight(0x222222);
scene.add(ambientLight);
const headLight = new THREE.PointLight(0x00ffff, 1.5, 15);
scene.add(headLight);

// Audio Synthesis Helper
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playTone(freq, type, duration, vol=0.1) {
    if(audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

function playEatSound() {
    playTone(600, 'square', 0.1, 0.1);
    setTimeout(() => playTone(900, 'sine', 0.15, 0.1), 50);
}

function playGameOverSound() {
    playTone(200, 'sawtooth', 0.3, 0.2);
    setTimeout(() => playTone(150, 'sawtooth', 0.4, 0.2), 150);
    setTimeout(() => playTone(100, 'square', 0.6, 0.2), 300);
}

// ==============================
// GAMEPLAY FUNCTIONS
// ==============================
function initGame() {
    // Clear old snake
    snakeMeshes.forEach(m => scene.remove(m));
    snakeMeshes = [];
    snakeLogic = [];
    
    score = 0;
    updateScoreDisplay();
    tickRate = 140;

    moveDirection = { x: 1, z: 0 };
    inputQueue = [];

    // Initial 3 segments
    for(let i=0; i<3; i++) {
        snakeLogic.push({ x: -i, z: 0 });
        const mesh = new THREE.Mesh(segmentGeo, i === 0 ? snakeHeadMat : snakeMat);
        mesh.position.set(-i, 0, 0);
        scene.add(mesh);
        snakeMeshes.push(mesh);
    }

    if(!foodMesh) {
        foodMesh = new THREE.Mesh(foodGeo, foodMat);
        scene.add(foodMesh);
    }
    spawnFood();

    isGameOver = false;
    lastTickTime = performance.now();
    document.getElementById('overlay').classList.remove('visible');
    
    if(audioCtx.state === 'suspended') audioCtx.resume();
}

function spawnFood() {
    let valid = false;
    while(!valid) {
        foodPos.x = Math.floor(Math.random() * gridSize) - bounds;
        foodPos.z = Math.floor(Math.random() * gridSize) - bounds;
        valid = !snakeLogic.some(segment => segment.x === foodPos.x && segment.z === foodPos.z);
    }
    foodMesh.position.set(foodPos.x, 0, foodPos.z);
    foodMesh.rotation.set(0, 0, 0);
}

function updateScoreDisplay() {
    document.getElementById('score').innerText = score;
}

function gameOver() {
    isGameOver = true;
    playGameOverSound();
    
    // Glitch effect on death
    document.getElementById('overlay').classList.add('visible');
    document.getElementById('title').innerText = 'SISTEMA COMPROMETIDO';
    document.getElementById('title').setAttribute('data-text', 'SISTEMA COMPROMETIDO');
    document.getElementById('message').innerText = `DATA RECOLECTADA: ${score} TB | PRESIONE [ENTER] PARA REBOOT`;
}

function tick() {
    if(isGameOver) return;

    if(inputQueue.length > 0) {
        moveDirection = inputQueue.shift();
    }

    const newHeadX = snakeLogic[0].x + moveDirection.x;
    const newHeadZ = snakeLogic[0].z + moveDirection.z;

    // Collisions with walls
    if(newHeadX < -bounds || newHeadX > bounds || newHeadZ < -bounds || newHeadZ > bounds) {
        gameOver();
        return;
    }

    // Collisions with self
    for(let i=0; i<snakeLogic.length; i++) {
        if(snakeLogic[i].x === newHeadX && snakeLogic[i].z === newHeadZ) {
            gameOver();
            return;
        }
    }

    // Create new logic head
    const newHead = { x: newHeadX, z: newHeadZ };
    snakeLogic.unshift(newHead);

    // Create new mesh head
    const headMesh = new THREE.Mesh(segmentGeo, snakeHeadMat);
    headMesh.position.set(snakeLogic[1].x, 0, snakeLogic[1].z); // start at old head
    scene.add(headMesh);
    snakeMeshes.unshift(headMesh);

    // Update old head material to body
    snakeMeshes[1].material = snakeMat;

    // Check food
    if(newHeadX === foodPos.x && newHeadZ === foodPos.z) {
        score += 1;
        updateScoreDisplay();
        playEatSound();
        spawnFood();
        // Speed up slightly
        if(tickRate > 60) tickRate -= 2;
    } else {
        // Remove tail
        snakeLogic.pop();
        const tailMesh = snakeMeshes.pop();
        scene.remove(tailMesh);
        // dispose geo/mat optionally for perf, but here geometry is shared
    }
}

// ==============================
// INPUTS
// ==============================
window.addEventListener('keydown', (e) => {
    let refDir = inputQueue.length > 0 ? inputQueue[inputQueue.length - 1] : moveDirection;
    let nextDir = null;

    switch(e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
            // Avanzar: mantiene la misma dirección
            nextDir = { x: refDir.x, z: refDir.z };
            break;
        case 'ArrowDown':
        case 's':
        case 'S':
            // Retroceder instantáneo bloqueado (giro de 180 grados imposible)
            break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
            // Girar a la izquierda (-90 grados relacional)
            nextDir = { x: refDir.z, z: -refDir.x };
            break;
        case 'ArrowRight':
        case 'd':
        case 'D':
            // Girar a la derecha (+90 grados relacional)
            nextDir = { x: -refDir.z, z: refDir.x };
            break;
        case 'Enter':
        case ' ':
            if(isGameOver) initGame();
            break;
    }

    // Buffer de inputs: permite hacer dobles giros rápidos
    if(nextDir && inputQueue.length < 3) {
        // Evitar encolar el mismo vector repetidamente para no gastar el buffer en "avanzar" extra
        if(nextDir.x !== refDir.x || nextDir.z !== refDir.z) {
            inputQueue.push(nextDir);
        }
    }
});

// Click on start button
document.getElementById('start-btn').addEventListener('click', () => {
    if(isGameOver) initGame();
});

// Mobile basic touch (swipe)
let touchStartX = 0;
let touchStartY = 0;
window.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
});
window.addEventListener('touchend', e => {
    if(isGameOver) return;
    const touchEndX = e.changedTouches[0].screenX;
    const touchEndY = e.changedTouches[0].screenY;
    const dx = touchEndX - touchStartX;
    const dy = touchEndY - touchStartY;
    
    // Ignore small swipes
    if(Math.abs(dx) < 30 && Math.abs(dy) < 30) return;

    let refDir = inputQueue.length > 0 ? inputQueue[inputQueue.length - 1] : moveDirection;
    let nextDir = null;

    if(Math.abs(dx) > Math.abs(dy)) {
        if(dx > 0) {
            // Swipe Derecha -> Girar Derecha
            nextDir = { x: -refDir.z, z: refDir.x };
        } else {
            // Swipe Izquierda -> Girar Izquierda
            nextDir = { x: refDir.z, z: -refDir.x };
        }
    } else {
        if(dy > 0) {
            // Swipe Abajo -> Ignorado (evita 180 instántaneo)
        } else {
            // Swipe Arriba -> Avanzar (redundante pero da control)
        }
    }

    if(nextDir && inputQueue.length < 3) {
        if(nextDir.x !== refDir.x || nextDir.z !== refDir.z) {
            inputQueue.push(nextDir);
        }
    }
});

// ==============================
// RENDER LOOP
// ==============================
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);

    const timeInSeconds = clock.getElapsedTime();
    const now = performance.now();

    // Logic ticks
    if(!isGameOver && now - lastTickTime > tickRate) {
        tick();
        lastTickTime = now;
    }

    // Visual Interpolation for smooth movement
    if(!isGameOver && snakeMeshes.length > 0) {
        const lerpFactor = 0.4; // adjust for snappiness vs smoothness
        for(let i=0; i<snakeMeshes.length; i++) {
            const targetX = snakeLogic[i].x;
            const targetZ = snakeLogic[i].z;
            snakeMeshes[i].position.x += (targetX - snakeMeshes[i].position.x) * lerpFactor;
            snakeMeshes[i].position.z += (targetZ - snakeMeshes[i].position.z) * lerpFactor;
        }

        // Camera follow logic (dynamic 3rd person)
        const headPos = snakeMeshes[0].position;
        // The camera sits behind and above the head based on movement direction
        const cameraOffsetX = -moveDirection.x * 12;
        const cameraOffsetZ = -moveDirection.z * 12;
        
        const targetCamX = headPos.x + cameraOffsetX;
        const targetCamZ = headPos.z + cameraOffsetZ;
        const targetCamY = 10; // height

        camera.position.x += (targetCamX - camera.position.x) * 0.05;
        camera.position.y += (targetCamY - camera.position.y) * 0.05;
        camera.position.z += (targetCamZ - camera.position.z) * 0.05;
        
        // Make camera look slightly ahead of the snake
        const lookTarget = new THREE.Vector3(
            headPos.x + moveDirection.x * 5, 
            0, 
            headPos.z + moveDirection.z * 5
        );
        
        // Smooth camera lookAt by interpolating a dummy point
        if(!camera.lookAtTarget) camera.lookAtTarget = new THREE.Vector3().copy(lookTarget);
        camera.lookAtTarget.lerp(lookTarget, 0.1);
        camera.lookAt(camera.lookAtTarget);

        // Link PointLight to Head
        headLight.position.set(headPos.x, headPos.y + 1, headPos.z);
    } else if (isGameOver) {
        // Slow pan around the scene while game over
        const radius = 30;
        camera.position.x = Math.sin(timeInSeconds * 0.5) * radius;
        camera.position.z = Math.cos(timeInSeconds * 0.5) * radius;
        camera.position.y = 20;
        camera.lookAt(0, 0, 0);
    }

    // Particles slow swirl
    if(particlesMesh) {
        particlesMesh.rotation.y = timeInSeconds * 0.05;
    }
    
    // Food animation (bobbing and rotating)
    if(foodMesh && !isGameOver) {
        foodMesh.rotation.x += 0.02;
        foodMesh.rotation.y += 0.03;
        foodMesh.position.y = Math.sin(timeInSeconds * 5) * 0.2 + 0.2;
        // Flicker effect on emissive
        foodMat.emissiveIntensity = 1.0 + Math.sin(timeInSeconds * 20) * 0.5;
    }

    // Optional Grid Pulse
    gridHelper.material.opacity = 0.15 + Math.sin(timeInSeconds * 2) * 0.05;

    composer.render();
}

// Window resize handler
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

// Start loop
animate();
