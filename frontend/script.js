
let detector;
let selectedExercise = null;

const webcam = document.getElementById("webcam");
const canvas = document.getElementById("output");
const ctx = canvas.getContext("2d");
const feedback = document.getElementById("feedback");

const exerciseImage = document.getElementById("exerciseImage");
const exerciseDescription = document.getElementById("exerciseDescription");
const exerciseList = document.getElementById("exerciseList");


// Load Exercise Buttons
EXERCISES.forEach(ex => {
    const btn = document.createElement("button");
    btn.innerText = ex.name;
    btn.onclick = () => loadExercise(ex);
    exerciseList.appendChild(btn);
});

function loadExercise(ex) {
    selectedExercise = ex;
    exerciseImage.src = ex.image;
    exerciseDescription.innerText = ex.description;
    feedback.innerText = "Perform the exercise. AI is analyzing...";
}


// Load Camera
async function setupCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 }
    });
    webcam.srcObject = stream;

    return new Promise(resolve => {
        webcam.onloadedmetadata = () => resolve(webcam);
    });
}


// Load Pose Detector
async function loadModel() {
    detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.MoveNet,
        { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
    );
}

// Helper function to get keypoint by name
function getKeypoint(pose, name) {
    return pose.keypoints.find(kp => kp.name === name);
}

// Calculate angle between three points
function calculateAngle(point1, point2, point3) {
    if (!point1 || !point2 || !point3 || 
        point1.score < 0.4 || point2.score < 0.4 || point3.score < 0.4) {
        return null;
    }
    
    const radians = Math.atan2(point3.y - point2.y, point3.x - point2.x) - 
                    Math.atan2(point1.y - point2.y, point1.x - point2.x);
    let angle = Math.abs(radians * 180.0 / Math.PI);
    if (angle > 180.0) angle = 360 - angle;
    return angle;
}

// Validate pose based on selected exercise
function validatePose(pose) {
    if (!selectedExercise) {
        return { isValid: false, message: "Please select an exercise first" };
    }

    const exerciseId = selectedExercise.id;
    
    switch(exerciseId) {
        case 1: // Neck Rotation
            return validateNeckRotation(pose);
        case 2: // Shoulder Flexion
            return validateShoulderFlexion(pose);
        case 3: // Knee Extension
            return validateKneeExtension(pose);
        case 4: // Hip Bridge
            return validateHipBridge(pose);
        case 5: // Ankle Pumps
            return validateAnklePumps(pose);
        default:
            return { isValid: false, message: "Exercise validation not implemented" };
    }
}

function validateNeckRotation(pose) {
    const nose = getKeypoint(pose, 'nose');
    const leftShoulder = getKeypoint(pose, 'left_shoulder');
    const rightShoulder = getKeypoint(pose, 'right_shoulder');
    const leftEar = getKeypoint(pose, 'left_ear');
    const rightEar = getKeypoint(pose, 'right_ear');
    
    if (!nose || nose.score < 0.4 || !leftShoulder || !rightShoulder) {
        return { isValid: false, message: "⚠️ Position yourself so your face and shoulders are clearly visible" };
    }
    
    // Check if head is rotated (nose is not centered between shoulders)
    const shoulderCenterX = (leftShoulder.x + rightShoulder.x) / 2;
    const offset = nose.x - shoulderCenterX;
    const offsetAbs = Math.abs(offset);
    const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
    const rotationPercent = (offsetAbs / shoulderWidth) * 100;
    
    // Check head tilt (ear position relative to shoulders)
    let tiltMessage = "";
    
    // If offset is significant relative to shoulder width, rotation detected
    if (rotationPercent > 20) {
        const direction = offset > 0 ? "right" : "left";
        let qualityMessage = "";
        
        if (rotationPercent > 40) {
            qualityMessage = "Excellent rotation! Hold for 2-3 seconds, then slowly return to center";
        } else if (rotationPercent > 30) {
            qualityMessage = "Good rotation! Try rotating a bit more to the " + direction;
        } else {
            qualityMessage = "Nice start! Rotate your head further to the " + direction + " - aim for 45 degrees";
        }
        
        // Check if head is tilted up/down (should stay level)
        if (leftEar && leftEar.score > 0.4 && rightEar && rightEar.score > 0.4) {
            const earHeightDiff = Math.abs(leftEar.y - rightEar.y);
            if (earHeightDiff > 10) {
                tiltMessage = " Keep your head level - avoid tilting up or down";
            }
        }
        
        return { isValid: true, message: "✅ " + qualityMessage + tiltMessage + ". Move slowly and smoothly." };
    } else if (rotationPercent > 10) {
        const direction = offset > 0 ? "right" : "left";
        return { isValid: false, message: "🔄 Rotate your head more to the " + direction + ". You're at about " + Math.round(rotationPercent) + " degrees - aim for 45 degrees. Keep your shoulders still." };
    } else {
        return { isValid: false, message: "🔄 Start by rotating your head slowly to the left or right. Keep your shoulders facing forward and only move your neck. Aim for a 45-degree rotation." };
    }
}

function validateShoulderFlexion(pose) {
    const leftShoulder = getKeypoint(pose, 'left_shoulder');
    const rightShoulder = getKeypoint(pose, 'right_shoulder');
    const leftElbow = getKeypoint(pose, 'left_elbow');
    const rightElbow = getKeypoint(pose, 'right_elbow');
    const leftWrist = getKeypoint(pose, 'left_wrist');
    const rightWrist = getKeypoint(pose, 'right_wrist');
    
    if (!leftShoulder || !rightShoulder || leftShoulder.score < 0.4 || rightShoulder.score < 0.4) {
        return { isValid: false, message: "⚠️ Please ensure your shoulders are visible in the camera" };
    }
    
    // Check both arms
    let leftAnalysis = null, rightAnalysis = null;
    
    if (leftWrist && leftShoulder && leftElbow && 
        leftWrist.score > 0.4 && leftShoulder.score > 0.4 && leftElbow.score > 0.4) {
        const heightDiff = leftShoulder.y - leftWrist.y;
        const armAngle = calculateAngle(leftShoulder, leftElbow, leftWrist);
        const isRaised = leftWrist.y < leftShoulder.y;
        leftAnalysis = { heightDiff, armAngle, isRaised, side: "left" };
    }
    
    if (rightWrist && rightShoulder && rightElbow && 
        rightWrist.score > 0.4 && rightShoulder.score > 0.4 && rightElbow.score > 0.4) {
        const heightDiff = rightShoulder.y - rightWrist.y;
        const armAngle = calculateAngle(rightShoulder, rightElbow, rightWrist);
        const isRaised = rightWrist.y < rightShoulder.y;
        rightAnalysis = { heightDiff, armAngle, isRaised, side: "right" };
    }
    
    const bestArm = leftAnalysis?.isRaised ? leftAnalysis : (rightAnalysis?.isRaised ? rightAnalysis : null);
    
    if (bestArm) {
        const heightPercent = (bestArm.heightDiff / 100) * 100;
        let feedback = "✅ ";
        
        if (heightPercent > 30) {
            feedback += "Excellent! Your " + bestArm.side + " arm is well raised above your shoulder. ";
        } else if (heightPercent > 15) {
            feedback += "Good! Your " + bestArm.side + " arm is raised. ";
        } else {
            feedback += "Your " + bestArm.side + " arm is slightly raised. ";
        }
        
        // Check arm straightness (angle should be close to 180 degrees)
        if (bestArm.armAngle && bestArm.armAngle > 150 && bestArm.armAngle < 210) {
            feedback += "Keep your arm straight and fully extended toward the ceiling.";
        } else if (bestArm.armAngle && bestArm.armAngle < 150) {
            feedback += "⚠️ Straighten your elbow more - your arm should be fully extended.";
        }
        
        feedback += " Keep your back straight and hold for 5 seconds.";
        return { isValid: true, message: feedback };
    }
    
    // Neither arm is raised properly
    if (leftAnalysis || rightAnalysis) {
        const arm = leftAnalysis || rightAnalysis;
        if (arm.heightDiff < 0) {
            return { isValid: false, message: "🔄 Raise your " + arm.side + " arm higher. Your wrist should be well above your shoulder. Lift straight up toward the ceiling, not forward." };
        }
    }
    
    return { isValid: false, message: "🔄 Raise one arm straight up toward the ceiling. Keep your elbow straight, palm facing forward, and lift slowly until your arm is fully vertical. Keep your other arm relaxed at your side." };
}

function validateKneeExtension(pose) {
    const leftHip = getKeypoint(pose, 'left_hip');
    const rightHip = getKeypoint(pose, 'right_hip');
    const leftKnee = getKeypoint(pose, 'left_knee');
    const rightKnee = getKeypoint(pose, 'right_knee');
    const leftAnkle = getKeypoint(pose, 'left_ankle');
    const rightAnkle = getKeypoint(pose, 'right_ankle');
    
    if (!leftHip || !rightHip || !leftKnee || !rightKnee) {
        return { isValid: false, message: "⚠️ Please sit so your hips and knees are visible in the camera" };
    }
    
    // Check both knees, at least one should be extended
    let leftAngle = null, rightAngle = null;
    let leftExtended = false, rightExtended = false;
    
    if (leftHip && leftKnee && leftAnkle && 
        leftHip.score > 0.4 && leftKnee.score > 0.4 && leftAnkle.score > 0.4) {
        leftAngle = calculateAngle(leftHip, leftKnee, leftAnkle);
        leftExtended = leftAngle && leftAngle > 160 && leftAngle < 200;
    }
    
    if (rightHip && rightKnee && rightAnkle && 
        rightHip.score > 0.4 && rightKnee.score > 0.4 && rightAnkle.score > 0.4) {
        rightAngle = calculateAngle(rightHip, rightKnee, rightAnkle);
        rightExtended = rightAngle && rightAngle > 160 && rightAngle < 200;
    }
    
    // Check sitting posture (hips should be higher than knees, shoulders relatively straight)
    const avgHipY = (leftHip.y + rightHip.y) / 2;
    const avgKneeY = (leftKnee.y + rightKnee.y) / 2;
    const isSitting = avgHipY < avgKneeY;
    
    let feedback = "";
    const extendedLeg = leftExtended ? "left" : (rightExtended ? "right" : null);
    
    if (extendedLeg) {
        feedback = "✅ Perfect! Your " + extendedLeg + " knee is fully extended. ";
        
        // Check extension quality
        const extAngle = extendedLeg === "left" ? leftAngle : rightAngle;
        if (extAngle && extAngle > 175 && extAngle < 185) {
            feedback += "Excellent straight leg! ";
        } else {
            feedback += "Try to straighten it a bit more - aim for 180 degrees. ";
        }
        
        // Check sitting posture
        if (!isSitting) {
            feedback += "⚠️ Make sure you're sitting upright with your back straight. ";
        } else {
            feedback += "Good posture! ";
        }
        
        // Check if other leg is bent
        const otherExtended = extendedLeg === "left" ? rightExtended : leftExtended;
        if (!otherExtended) {
            feedback += "Keep your other foot on the ground. Hold this position for 5 seconds, then slowly lower.";
        } else {
            feedback += "You can extend one leg at a time - try focusing on one leg.";
        }
        
        return { isValid: true, message: feedback };
    }
    
    // No leg properly extended
    if (leftAngle !== null || rightAngle !== null) {
        const angle = leftAngle || rightAngle;
        const side = leftAngle ? "left" : "right";
        
        if (angle < 160) {
            const flexion = Math.round(180 - angle);
            feedback = "🔄 Straighten your " + side + " knee more. You're " + flexion + " degrees from full extension. ";
            feedback += "Sit tall, engage your thigh muscle, and lift your foot until your leg is completely straight. ";
        } else if (angle > 200) {
            feedback = "🔄 Your " + side + " leg appears overextended. Lower it slightly to a comfortable straight position. ";
        }
        
        if (!isSitting) {
            feedback += "⚠️ Make sure you're sitting upright, not leaning forward or backward.";
        }
        
        return { isValid: false, message: feedback || "🔄 Fully extend your knee. Sit upright, engage your quadriceps, and lift your foot until your leg is completely straight (180 degrees)." };
    }
    
    return { isValid: false, message: "🔄 Sit upright in a chair. Slowly extend one knee fully until your leg is straight. Keep your back straight and hold for 5 seconds before lowering." };
}

function validateHipBridge(pose) {
    const leftHip = getKeypoint(pose, 'left_hip');
    const rightHip = getKeypoint(pose, 'right_hip');
    const leftShoulder = getKeypoint(pose, 'left_shoulder');
    const rightShoulder = getKeypoint(pose, 'right_shoulder');
    const leftKnee = getKeypoint(pose, 'left_knee');
    const rightKnee = getKeypoint(pose, 'right_knee');
    const leftAnkle = getKeypoint(pose, 'left_ankle');
    const rightAnkle = getKeypoint(pose, 'right_ankle');
    
    if (!leftHip || !rightHip || !leftShoulder || !rightShoulder ||
        leftHip.score < 0.4 || rightHip.score < 0.4 || 
        leftShoulder.score < 0.4 || rightShoulder.score < 0.4) {
        return { isValid: false, message: "⚠️ Please lie down so your full body (shoulders to hips) is visible in the camera. Position yourself side-on to the camera." };
    }
    
    // In a hip bridge, hips should be higher than shoulders (smaller y value)
    const avgHipY = (leftHip.y + rightHip.y) / 2;
    const avgShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
    const hipHeightDiff = avgShoulderY - avgHipY;
    const heightPercent = (hipHeightDiff / 100) * 100;
    
    // Check knee angles (knees should be bent at ~90 degrees)
    let leftKneeAngle = null, rightKneeAngle = null;
    if (leftHip && leftKnee && leftAnkle && 
        leftKnee.score > 0.4 && leftAnkle.score > 0.4) {
        leftKneeAngle = calculateAngle(leftHip, leftKnee, leftAnkle);
    }
    if (rightHip && rightKnee && rightAnkle && 
        rightKnee.score > 0.4 && rightAnkle.score > 0.4) {
        rightKneeAngle = calculateAngle(rightHip, rightKnee, rightAnkle);
    }
    
    // Knees should be bent around 90-120 degrees for hip bridge
    const leftBent = leftKneeAngle && leftKneeAngle > 75 && leftKneeAngle < 150;
    const rightBent = rightKneeAngle && rightKneeAngle > 75 && rightKneeAngle < 150;
    const kneesBent = (leftBent || rightBent);
    
    if (avgHipY < avgShoulderY) {
        // Hips are above shoulders (lifted position)
        let feedback = "✅ Great! Your hips are lifted. ";
        
        if (heightPercent > 15) {
            feedback += "Excellent height! ";
        } else if (heightPercent > 8) {
            feedback += "Good lift! Try lifting a bit higher. ";
        } else {
            feedback += "You're lifting, but aim for higher. ";
        }
        
        // Check knee position
        if (kneesBent) {
            feedback += "Keep your knees bent and feet flat on the ground. ";
        } else {
            feedback += "⚠️ Make sure your knees are bent at about 90 degrees with feet flat. ";
        }
        
        // Check body alignment (hips should be level)
        const hipHeightDiff_lr = Math.abs(leftHip.y - rightHip.y);
        if (hipHeightDiff_lr > 15) {
            feedback += "⚠️ Keep your hips level - avoid tilting to one side. ";
        }
        
        feedback += "Squeeze your glutes and hold for 10 seconds. Keep your shoulders and head on the ground.";
        return { isValid: true, message: feedback };
    }
    
    // Hips not lifted high enough
    let feedback = "🔄 Lift your hips higher. ";
    
    // Check starting position
    const initialHipPos = Math.abs(avgHipY - avgShoulderY);
    if (initialHipPos < 30) {
        feedback += "You're still in the starting position. ";
    }
    
    if (hipHeightDiff < 0) {
        feedback += "Your hips need to be higher than your shoulders. ";
    } else if (hipHeightDiff < 5) {
        feedback += "Lift just a bit more - aim for your body to form a straight line from shoulders to knees. ";
    }
    
    // Check knee position
    if (!kneesBent) {
        feedback += "⚠️ Make sure you're lying on your back with knees bent at 90 degrees and feet flat. ";
    } else {
        feedback += "Keep your knees bent, feet flat on the ground, and slowly lift your hips. ";
    }
    
    feedback += "Press through your heels and engage your glutes. Your body should form a bridge shape.";
    return { isValid: false, message: feedback };
}

function validateAnklePumps(pose) {
    const leftAnkle = getKeypoint(pose, 'left_ankle');
    const rightAnkle = getKeypoint(pose, 'right_ankle');
    const leftKnee = getKeypoint(pose, 'left_knee');
    const rightKnee = getKeypoint(pose, 'right_knee');
    
    if (!leftAnkle || !rightAnkle || leftAnkle.score < 0.4 || rightAnkle.score < 0.4) {
        return { isValid: false, message: "⚠️ Position your feet so your ankles are clearly visible in the camera. Sit or lie down with your legs extended or slightly bent." };
    }
    
    // Ankle pumps involve movement - provide guidance
    let feedback = "✅ Your ankles are visible. ";
    
    // Check if legs are in good position for ankle pumps
    const leftVisible = leftAnkle && leftAnkle.score > 0.4;
    const rightVisible = rightAnkle && rightAnkle.score > 0.4;
    
    if (leftVisible && rightVisible) {
        feedback += "Focus on one foot at a time or both together. ";
    } else if (leftVisible) {
        feedback += "Work your left ankle. ";
    } else {
        feedback += "Work your right ankle. ";
    }
    
    feedback += "Point your toes away from your body (plantarflexion), then pull them toward your body (dorsiflexion). ";
    feedback += "Move slowly and deliberately through the full range of motion. ";
    feedback += "Aim for 15-20 repetitions per foot. ";
    feedback += "This exercise improves circulation and ankle mobility.";
    
    return { isValid: true, message: feedback };
}

// Start Detection Loop
async function detectPose() {
    const poses = await detector.estimatePoses(webcam);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (poses.length > 0) {
        drawPose(poses[0]);
        
        if (selectedExercise) {
            const validation = validatePose(poses[0]);
            feedback.innerText = validation.message;
            feedback.style.color = validation.isValid ? "#4ade80" : "#f87171";
        } else {
            feedback.innerText = "Please select an exercise";
            feedback.style.color = "#fbbf24";
        }
    } else {
        feedback.innerText = "No pose detected. Please position yourself in front of the camera";
        feedback.style.color = "#f87171";
    }

    requestAnimationFrame(detectPose);
}


// Draw Skeleton
function drawPose(pose) {
    canvas.width = webcam.videoWidth;
    canvas.height = webcam.videoHeight;

    pose.keypoints.forEach(kp => {
        if (kp.score > 0.4) {
            ctx.beginPath();
            ctx.arc(kp.x, kp.y, 6, 0, 2 * Math.PI);
            ctx.fillStyle = "aqua";
            ctx.fill();
        }
    });
}


async function init() {
    await setupCamera();
    await loadModel();
    detectPose();
}

init();
