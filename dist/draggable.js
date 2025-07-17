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
        let isDragging = false;
        const touchStartTime = Date.now();
        // Enhanced drag tracking variables
        let lastDragTime = Date.now();
        let lastMouseX = initialMouseX;
        let lastMouseY = initialMouseY;
        let accumulatedDx = 0;
        // Improved damping and sensitivity settings
        const DRAG_DAMPING = 0.9; // Slightly less damping for more responsive feel
        const EDGE_THRESHOLD = 60; // Increased threshold for smoother edge behavior
        const MIN_DRAG_INTERVAL = 8; // Reduced interval for more responsive updates (120fps)
        const SCROLL_COMPENSATION = 0.95; // Compensation factor for scroll-induced position changes
        const onPointerMove = (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (isTouchDevice && Date.now() - touchStartTime < touchDelay)
                return;
            const currentTime = Date.now();
            const timeDelta = currentTime - lastDragTime;
            // Throttle drag updates but allow more frequent updates
            if (timeDelta < MIN_DRAG_INTERVAL)
                return;
            const currentMouseX = event.clientX;
            const currentMouseY = event.clientY;
            // Calculate movement from last position (not initial position)
            const rawDx = currentMouseX - lastMouseX;
            const rawDy = currentMouseY - lastMouseY;
            // Check if we should start dragging
            const totalDx = currentMouseX - initialMouseX;
            const totalDy = currentMouseY - initialMouseY;
            if (isDragging || Math.abs(totalDx) > threshold || Math.abs(totalDy) > threshold) {
                // Get current element position (accounts for any scrolling that occurred)
                const currentRect = element.getBoundingClientRect();
                const { left, top, width } = currentRect;
                // Calculate current mouse position relative to element
                const currentRelativeX = currentMouseX - left;
                const currentRelativeY = currentMouseY - top;
                if (!isDragging) {
                    onStart === null || onStart === void 0 ? void 0 : onStart(initialRelativeX, initialRelativeY);
                    isDragging = true;
                }
                // Calculate distance from edges based on current position
                const distanceFromLeftEdge = currentRelativeX;
                const distanceFromRightEdge = width - currentRelativeX;
                const minDistanceFromEdge = Math.min(distanceFromLeftEdge, distanceFromRightEdge);
                // Apply progressive edge damping
                let edgeDamping = 1.0;
                if (minDistanceFromEdge < EDGE_THRESHOLD) {
                    // Smoother edge damping curve
                    const edgeRatio = minDistanceFromEdge / EDGE_THRESHOLD;
                    edgeDamping = Math.max(0.15, edgeRatio * edgeRatio); // Quadratic falloff
                }
                // Apply damping to the movement delta
                const dampedDx = rawDx * DRAG_DAMPING * edgeDamping;
                const dampedDy = rawDy * DRAG_DAMPING * edgeDamping;
                // Accumulate small movements to prevent precision loss
                accumulatedDx += dampedDx;
                // Only trigger drag if accumulated movement is significant
                if (Math.abs(accumulatedDx) > 0.5) { // Reduced threshold for more responsive feel
                    // Use current relative position for more accurate positioning
                    onDrag(accumulatedDx, dampedDy, currentRelativeX, currentRelativeY);
                    accumulatedDx = 0; // Reset accumulator
                }
                // Update tracking variables
                lastDragTime = currentTime;
                lastMouseX = currentMouseX;
                lastMouseY = currentMouseY;
            }
        };
        const onPointerUp = (event) => {
            if (isDragging) {
                const currentRect = element.getBoundingClientRect();
                const { left, top } = currentRect;
                const finalX = event.clientX - left;
                const finalY = event.clientY - top;
                onEnd === null || onEnd === void 0 ? void 0 : onEnd(finalX, finalY);
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
