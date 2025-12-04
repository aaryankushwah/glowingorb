// ===========================
// Global Variables
// ===========================
let scene, camera, renderer;
let particles = [];
let particleSystem;
let hands = [];
let numParticles = 4000;

// Hand state  
let handCenter = { x: 0, y: 0, z: 0 };
let targetHandCenter = { x: 0, y: 0, z: 0 };
let handRotation = { x: 0, y: 0, z: 0 };
let targetHandRotation = { x: 0, y: 0, z: 0 };

// Expansion state (0 = closed fist/cube, 1 = open hand/expanded)
let handOpenness = 0;
let targetOpenness = 0;

// Status elements
const loadingEl = document.getElementById('loading');
// UI elements removed as per visual overhaul

// ===========================
// Three.js Setup
// ===========================
function initThreeJS() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 300;

    const canvas = document.getElementById('output');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

    createParticles();

    const ambientLight = new THREE.AmbientLight(0x00FFFF, 0.6);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0x00FFFF, 2.0, 800);
    pointLight.position.set(0, 0, 100);
    scene.add(pointLight);

    window.addEventListener('resize', onWindowResize);
}

function createGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');

    const gradient = context.createRadialGradient(12, 12, 0, 12, 12, 12);
    // Tighter, brighter core
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.15, 'rgba(0, 255, 255, 1)');
    gradient.addColorStop(0.4, 'rgba(0, 255, 255, 0.2)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
}

function createParticles() {
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const colors = [];

    const size = 60; // Compact cube size
    const expansionScale = 12; // How much it expands

    for (let i = 0; i < numParticles; i++) {
        // Initial position (compact cube)
        const x = (Math.random() - 0.5) * size;
        const y = (Math.random() - 0.5) * size;
        const z = (Math.random() - 0.5) * size;

        positions.push(x, y, z);

        // Store positions for animation
        particles.push({
            // Cube state
            originalPos: new THREE.Vector3(x, y, z),
            // Expanded state (random explosion outward)
            expansionPos: new THREE.Vector3(
                x * (1 + Math.random() * expansionScale),
                y * (1 + Math.random() * expansionScale),
                z * (1 + Math.random() * expansionScale)
            ),
            // Current interpolated position
            currentPos: new THREE.Vector3(x, y, z),
            targetPos: new THREE.Vector3(x, y, z)
        });

        const colorVariation = 0.5 + Math.random() * 0.5;
        // Electric Blue / Cyan (R=0, G=High, B=High)
        colors.push(0, colorVariation, colorVariation);
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 40, // Increased size for soft glow effect
        map: createGlowTexture(),
        vertexColors: true,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    particleSystem = new THREE.Points(geometry, material);
    scene.add(particleSystem);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// ===========================
// MediaPipe Hands Setup
// ===========================
function initHandTracking() {
    const videoElement = document.getElementById('webcam');

    const handsModel = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    handsModel.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
    });

    handsModel.onResults(onHandsDetected);

    const cameraObj = new Camera(videoElement, {
        onFrame: async () => {
            await handsModel.send({ image: videoElement });
        },
        width: 640,
        height: 480
    });

    cameraObj.start()
        .then(() => {
            // Camera active
            setTimeout(() => loadingEl.classList.add('hidden'), 500);
        })
        .catch((err) => {
            console.error('Camera error:', err);
        });
}

// ===========================
// Hand Detection & Processing
// ===========================
function onHandsDetected(results) {
    hands = results.multiHandLandmarks || [];

    if (hands.length === 0) {
        // Slowly return to neutral if no hands
        targetOpenness = 0;
        targetHandRotation.x = 0;
        targetHandRotation.y = 0;
        targetHandRotation.z = 0;
        return;
    }

    // Process primary hand (first detected)
    const hand = hands[0];
    const center = getHandCenter(hand);

    // 1. Calculate Continuous Openness (0% to 100%)
    const openness = calculateHandOpenness(hand);
    targetOpenness = openness;

    // 2. Calculate Rotation
    // Position-based rotation (Inverted)
    const posRotY = -(center.x - 0.5) * Math.PI * 1.5;
    const posRotX = (center.y - 0.5) * Math.PI * 1.5;

    // Orientation-based rotation (Tilt)
    const orientation = calculateHandOrientation(hand);

    // Combine them smoothly
    targetHandRotation.y = posRotY + orientation.y;
    targetHandRotation.x = posRotX + orientation.x;
    targetHandRotation.z = orientation.z;

    // Particles stay centered
    targetHandCenter.x = 0;
    targetHandCenter.y = 0;
    targetHandCenter.z = 0;
}

function getHandCenter(hand) {
    let sumX = 0, sumY = 0, sumZ = 0;
    hand.forEach(landmark => {
        sumX += landmark.x;
        sumY += landmark.y;
        sumZ += landmark.z;
    });
    return {
        x: sumX / hand.length,
        y: sumY / hand.length,
        z: sumZ / hand.length
    };
}

function getDistance(p1, p2) {
    return Math.sqrt(
        Math.pow(p1.x - p2.x, 2) +
        Math.pow(p1.y - p2.y, 2) +
        Math.pow(p1.z - p2.z, 2)
    );
}

function calculateHandOpenness(hand) {
    // Wrist is point 0
    const wrist = hand[0];

    // Fingertips: 4 (Thumb), 8 (Index), 12 (Middle), 16 (Ring), 20 (Pinky)
    // Finger MCPs (bases): 2, 5, 9, 13, 17

    // We compare distance from wrist to tip vs wrist to base
    // If tip is far from wrist -> Open
    // If tip is close to wrist -> Closed

    const tips = [4, 8, 12, 16, 20];
    let totalOpenness = 0;

    tips.forEach(tipIdx => {
        const tip = hand[tipIdx];
        const dist = getDistance(wrist, tip);

        // Approximate ranges based on normalized coordinates
        // Closed fist ~ 0.1 - 0.15
        // Open hand ~ 0.3 - 0.4
        // We normalize this to 0-1 range

        // Thumb is shorter, so we treat it slightly differently or just average it in
        let normalized = (dist - 0.15) / 0.25;
        normalized = Math.max(0, Math.min(1, normalized));
        totalOpenness += normalized;
    });

    let avgOpenness = totalOpenness / 5;

    // Increase sensitivity: Remap range to hit 0 and 1 easier
    // (val - 0.2) * 1.5 -> Clamped 0-1
    avgOpenness = (avgOpenness - 0.2) * 1.5;
    return Math.max(0, Math.min(1, avgOpenness));
}

function calculateHandOrientation(hand) {
    // Reverting to simpler, more stable logic as requested
    // Wrist (0) to Middle Finger MCP (9)
    const wrist = hand[0];
    const middleMCP = hand[9];

    // Pitch (X-axis): Tilt up/down
    // Inverted: If MiddleMCP.y is higher/lower than Wrist.y
    const pitch = -(wrist.y - middleMCP.y) * 3.0;

    // Yaw (Y-axis): Turn left/right
    // Inverted: Compare Wrist x vs MiddleMCP x
    const yaw = -(middleMCP.x - wrist.x) * 3.0;

    // Roll (Z-axis): IGNORED to prevent glitching
    const roll = 0;

    return { x: pitch, y: yaw, z: roll };
}

// ===========================
function animate() {
    requestAnimationFrame(animate);

    // Smooth Interpolation (Lerp)
    // Using 0.1 for rotation/position for smoothness
    // Using 0.15 for openness for slightly snappier response

    handOpenness += (targetOpenness - handOpenness) * 0.15;

    handRotation.x += (targetHandRotation.x - handRotation.x) * 0.1;
    handRotation.y += (targetHandRotation.y - handRotation.y) * 0.1;
    handRotation.z += (targetHandRotation.z - handRotation.z) * 0.1;

    updateParticles();
    renderer.render(scene, camera);
}

function updateParticles() {
    const positions = particleSystem.geometry.attributes.position.array;

    for (let i = 0; i < numParticles; i++) {
        const particle = particles[i];
        const i3 = i * 3;

        // Interpolate between Cube (originalPos) and Explosion (expansionPos)
        // based on handOpenness (0 to 1)
        particle.targetPos.lerpVectors(particle.originalPos, particle.expansionPos, handOpenness);

        // Smoothly move current position to target position
        // This adds a second layer of smoothing for the particle movement itself
        particle.currentPos.lerp(particle.targetPos, 0.2);

        // Add subtle vibration/jitter for "alive" feel
        const time = Date.now() * 0.005;
        const jitterAmount = 1; // Adjust for intensity
        const jitterX = Math.sin(time + i) * jitterAmount;
        const jitterY = Math.cos(time + i * 0.5) * jitterAmount;
        const jitterZ = Math.sin(time + i * 0.2) * jitterAmount;

        positions[i3] = particle.currentPos.x + jitterX;
        positions[i3 + 1] = particle.currentPos.y + jitterY;
        positions[i3 + 2] = particle.currentPos.z + jitterZ;
    }

    particleSystem.geometry.attributes.position.needsUpdate = true;

    // Apply Global Rotation
    particleSystem.rotation.x = handRotation.x;
    particleSystem.rotation.y = handRotation.y;
    particleSystem.rotation.z = handRotation.z;
}

// ===========================
// Initialize Application
// ===========================
window.addEventListener('DOMContentLoaded', () => {
    initThreeJS();
    initHandTracking();
    animate();
});
