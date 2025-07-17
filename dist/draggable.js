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
        let startX = event.clientX;
        let startY = event.clientY;
        let isDragging = false;
        const touchStartTime = Date.now();
        // Add scroll damping variables
        let lastDragTime = Date.now();
        let dragVelocity = 0;
        let accumulatedDx = 0;
        const DRAG_DAMPING = 0.85; // Reduce drag sensitivity
        const EDGE_THRESHOLD = 50; // Pixels from edge to start reducing sensitivity
        const MIN_DRAG_INTERVAL = 16; // Minimum time between drag updates (60fps)
        const onPointerMove = (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (isTouchDevice && Date.now() - touchStartTime < touchDelay)
                return;
            const currentTime = Date.now();
            const timeDelta = currentTime - lastDragTime;
            // Throttle drag updates to prevent excessive scrolling
            if (timeDelta < MIN_DRAG_INTERVAL)
                return;
            const x = event.clientX;
            const y = event.clientY;
            const dx = x - startX;
            const dy = y - startY;
            if (isDragging || Math.abs(dx) > threshold || Math.abs(dy) > threshold) {
                const rect = element.getBoundingClientRect();
                const { left, top, width } = rect;
                if (!isDragging) {
                    onStart === null || onStart === void 0 ? void 0 : onStart(startX - left, startY - top);
                    isDragging = true;
                }
                // Calculate distance from edges
                const relativeX = x - left;
                const distanceFromLeftEdge = relativeX;
                const distanceFromRightEdge = width - relativeX;
                const minDistanceFromEdge = Math.min(distanceFromLeftEdge, distanceFromRightEdge);
                // Apply edge damping - reduce sensitivity near edges
                let edgeDamping = 1.0;
                if (minDistanceFromEdge < EDGE_THRESHOLD) {
                    edgeDamping = Math.max(0.1, minDistanceFromEdge / EDGE_THRESHOLD);
                }
                // Apply overall damping and edge damping
                const dampedDx = dx * DRAG_DAMPING * edgeDamping;
                const dampedDy = dy * DRAG_DAMPING * edgeDamping;
                // Accumulate small movements to prevent loss of precision
                accumulatedDx += dampedDx;
                // Only trigger drag if accumulated movement is significant
                if (Math.abs(accumulatedDx) > 1) {
                    onDrag(accumulatedDx, dampedDy, x - left, y - top);
                    accumulatedDx = 0; // Reset accumulator
                }
                // Update velocity for smoother movement
                dragVelocity = dampedDx / (timeDelta || 1);
                lastDragTime = currentTime;
                startX = x;
                startY = y;
            }
        };
        const onPointerUp = (event) => {
            if (isDragging) {
                const x = event.clientX;
                const y = event.clientY;
                const rect = element.getBoundingClientRect();
                const { left, top } = rect;
                onEnd === null || onEnd === void 0 ? void 0 : onEnd(x - left, y - top);
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
