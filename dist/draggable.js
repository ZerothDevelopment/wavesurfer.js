export function makeDraggable(element, onDrag, onStart, onEnd, threshold = 3, mouseButton = 0, touchDelay = 100) {
    if (!element)
        return () => void 0;
    const isTouchDevice = matchMedia('(pointer: coarse)').matches;
    let unsubscribeDocument = () => void 0;
    const onPointerDown = (event) => {
        if (event.button !== mouseButton)
            return;
        event.preventDefault();
        event.stopPropagation();
        // Store initial positions
        const initialMouseX = event.clientX;
        const initialMouseY = event.clientY;
        const initialRect = element.getBoundingClientRect();
        const initialRelativeX = initialMouseX - initialRect.left;
        const initialRelativeY = initialMouseY - initialRect.top;
        // Store initial element position for consistent calculation
        const initialElementLeft = initialRect.left;
        const initialElementTop = initialRect.top;
        // Find the scroll container (look for parent with scrollable overflow)
        let scrollContainer = element.parentElement;
        while (scrollContainer && scrollContainer !== document.body) {
            const style = window.getComputedStyle(scrollContainer);
            if (style.overflowX === 'auto' || style.overflowX === 'scroll') {
                break;
            }
            scrollContainer = scrollContainer.parentElement;
        }
        let isDragging = false;
        const touchStartTime = Date.now();
        // Enhanced drag tracking variables
        let lastDragTime = Date.now();
        let lastMouseX = initialMouseX;
        let lastMouseY = initialMouseY;
        let accumulatedDx = 0;
        let lastScrollLeft = scrollContainer ? scrollContainer.scrollLeft : 0;
        // Velocity tracking for adaptive scrolling
        let velocityHistory = [];
        let currentVelocity = 0;
        let animationFrameId = null;
        // Optimized for ultra-smooth continuous scrolling
        const DRAG_DAMPING = 0.99; // Minimal damping for maximum responsiveness
        const MIN_DRAG_INTERVAL = 2; // 500fps - ultra-high frequency for instant response
        const MIN_MOVEMENT_THRESHOLD = 0.001; // Ultra-responsive threshold for rapid scrolling
        const VELOCITY_SAMPLES = 8; // More velocity samples for smoother average
        const VELOCITY_DECAY = 0.92; // Faster velocity decay when not moving
        // Calculate current drag velocity (pixels per millisecond)
        const calculateVelocity = (dx, dt) => {
            const currentTime = Date.now();
            // Add current sample to history
            velocityHistory.push({ dx, dt, time: currentTime });
            // Keep only recent samples
            if (velocityHistory.length > VELOCITY_SAMPLES) {
                velocityHistory.shift();
            }
            // Calculate average velocity from recent samples
            if (velocityHistory.length > 1) {
                const totalDx = velocityHistory.reduce((sum, sample) => sum + sample.dx, 0);
                const totalDt = velocityHistory.reduce((sum, sample) => sum + sample.dt, 0);
                currentVelocity = totalDt > 0 ? Math.abs(totalDx / totalDt) : 0;
            }
            return currentVelocity;
        };
        // Direct position updates for minimal lag
        const updatePositionDirect = (callback) => {
            callback();
        };
        const onPointerMove = (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (isTouchDevice && Date.now() - touchStartTime < touchDelay)
                return;
            const currentTime = Date.now();
            const timeDelta = currentTime - lastDragTime;
            // Balanced update frequency for smooth scrolling
            if (timeDelta < MIN_DRAG_INTERVAL)
                return;
            const currentMouseX = event.clientX;
            const currentMouseY = event.clientY;
            // Calculate movement from last position
            const rawDx = currentMouseX - lastMouseX;
            const rawDy = currentMouseY - lastMouseY;
            // Calculate velocity for adaptive scrolling
            const velocity = calculateVelocity(rawDx, timeDelta);
            // Check if we should start dragging
            const totalDx = currentMouseX - initialMouseX;
            const totalDy = currentMouseY - initialMouseY;
            if (isDragging || Math.abs(totalDx) > threshold || Math.abs(totalDy) > threshold) {
                // Simplified position calculation for minimal lag
                const currentRect = element.getBoundingClientRect();
                const { left, top, width } = currentRect;
                // Use direct relative position for immediate response
                const currentRelativeX = currentMouseX - left;
                const currentRelativeY = currentMouseY - top;
                if (!isDragging) {
                    console.log('🎯 DRAG START:', {
                        initialMouseX, initialMouseY,
                        initialRelativeX, initialRelativeY,
                        elementRect: { left, top, width }
                    });
                    onStart === null || onStart === void 0 ? void 0 : onStart(initialRelativeX, initialRelativeY);
                    isDragging = true;
                }
                // DEBUG: Log key values during drag including velocity
                console.log('📊 POSITION TRACKING:', {
                    currentMouseX,
                    elementLeft: left,
                    currentRelativeX,
                    rawDx,
                    velocity: velocity.toFixed(2),
                    timeDelta
                });
                // Minimal edge effects since smooth scrolling handles positioning
                let edgeDamping = 1.0;
                const distanceFromLeftEdge = currentRelativeX;
                const distanceFromRightEdge = width - currentRelativeX;
                const minDistanceFromEdge = Math.min(distanceFromLeftEdge, distanceFromRightEdge);
                // Very light edge damping only for extreme edges
                if (minDistanceFromEdge < 15) {
                    const edgeRatio = minDistanceFromEdge / 15;
                    edgeDamping = Math.max(0.95, edgeRatio);
                }
                // Use raw movement for maximum responsiveness
                const dampedDx = rawDx * DRAG_DAMPING * edgeDamping;
                const dampedDy = rawDy * DRAG_DAMPING * edgeDamping;
                // Accumulate movements
                accumulatedDx += dampedDx;
                // Ultra-responsive threshold
                if (Math.abs(accumulatedDx) > MIN_MOVEMENT_THRESHOLD) {
                    console.log('🎮 DRAG MOVE:', {
                        accumulatedDx,
                        dampedDy,
                        currentRelativeX,
                        rawDx,
                        dampedDx,
                        velocity: velocity.toFixed(2)
                    });
                    // Use direct relative position for immediate response
                    // Pass velocity as additional parameter for adaptive scrolling
                    onDrag(accumulatedDx, dampedDy, currentRelativeX, currentRelativeY, velocity);
                    accumulatedDx = 0;
                }
                // Update tracking variables
                lastDragTime = currentTime;
                lastMouseX = currentMouseX;
                lastMouseY = currentMouseY;
            }
            else {
                // Decay velocity when not actively dragging
                currentVelocity *= VELOCITY_DECAY;
            }
        };
        const onPointerUp = (event) => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
            if (isDragging) {
                const currentRect = element.getBoundingClientRect();
                const { left, top } = currentRect;
                // Use direct relative position for consistency
                const finalRelativeX = event.clientX - left;
                const finalRelativeY = event.clientY - top;
                console.log('🎯 DRAG END:', {
                    clientX: event.clientX,
                    elementLeft: left,
                    finalRelativeX,
                    finalRelativeY
                });
                onEnd === null || onEnd === void 0 ? void 0 : onEnd(finalRelativeX, finalRelativeY);
            }
            unsubscribeDocument();
        };
        const onPointerLeave = (e) => {
            // Listen to events only on the document and not on inner elements
            if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
                onPointerUp(e);
            }
        };
        const onClick = (event) => {
            if (isDragging) {
                event.stopPropagation();
                event.preventDefault();
            }
        };
        const onTouchMove = (event) => {
            if (isDragging) {
                event.preventDefault();
            }
        };
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);
        document.addEventListener('pointerout', onPointerLeave);
        document.addEventListener('pointercancel', onPointerLeave);
        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('click', onClick, { capture: true });
        unsubscribeDocument = () => {
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('pointerup', onPointerUp);
            document.removeEventListener('pointerout', onPointerLeave);
            document.removeEventListener('pointercancel', onPointerLeave);
            document.removeEventListener('touchmove', onTouchMove);
            setTimeout(() => {
                document.removeEventListener('click', onClick, { capture: true });
            }, 10);
        };
    };
    element.addEventListener('pointerdown', onPointerDown);
    return () => {
        unsubscribeDocument();
        element.removeEventListener('pointerdown', onPointerDown);
    };
}
