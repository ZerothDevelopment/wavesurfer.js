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
        // Optimized for smooth continuous scrolling
        const DRAG_DAMPING = 0.98; // Minimal damping for maximum responsiveness
        const MIN_DRAG_INTERVAL = 8; // 120fps - balanced for smooth performance
        const MIN_MOVEMENT_THRESHOLD = 0.05; // Very responsive threshold
        const SCROLL_COMPENSATION_FACTOR = 1; // Fully compensate for container scroll, keeping pointer aligned
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
            // Check if we should start dragging
            const totalDx = currentMouseX - initialMouseX;
            const totalDy = currentMouseY - initialMouseY;
            if (isDragging || Math.abs(totalDx) > threshold || Math.abs(totalDy) > threshold) {
                // Get current element position
                const currentRect = element.getBoundingClientRect();
                const { left, top, width } = currentRect;
                // Track scroll changes with partial compensation for smooth scrolling
                let scrollDelta = 0;
                if (scrollContainer) {
                    const currentScrollLeft = scrollContainer.scrollLeft;
                    scrollDelta = currentScrollLeft - lastScrollLeft;
                    lastScrollLeft = currentScrollLeft;
                }
                // Calculate current mouse position relative to element
                const currentRelativeX = currentMouseX - left;
                const currentRelativeY = currentMouseY - top;
                if (!isDragging) {
                    onStart === null || onStart === void 0 ? void 0 : onStart(initialRelativeX, initialRelativeY);
                    isDragging = true;
                }
                // Minimal edge effects since smooth scrolling handles positioning
                let edgeDamping = 1.0;
                const distanceFromLeftEdge = currentRelativeX;
                const distanceFromRightEdge = width - currentRelativeX;
                const minDistanceFromEdge = Math.min(distanceFromLeftEdge, distanceFromRightEdge);
                // Very light edge damping only for extreme edges
                if (minDistanceFromEdge < 20) {
                    const edgeRatio = minDistanceFromEdge / 20;
                    edgeDamping = Math.max(0.9, edgeRatio);
                }
                // Partial scroll compensation for smooth scrolling system
                let compensatedDx = rawDx;
                if (Math.abs(scrollDelta) > 0.5) {
                    // Partial compensation works better with smooth scrolling
                    compensatedDx = rawDx - (scrollDelta * SCROLL_COMPENSATION_FACTOR);
                }
                // Minimal damping for maximum responsiveness
                const dampedDx = compensatedDx * DRAG_DAMPING * edgeDamping;
                const dampedDy = rawDy * DRAG_DAMPING * edgeDamping;
                // Accumulate movements
                accumulatedDx += dampedDx;
                // Very responsive threshold
                if (Math.abs(accumulatedDx) > MIN_MOVEMENT_THRESHOLD) {
                    onDrag(accumulatedDx, dampedDy, currentRelativeX, currentRelativeY);
                    accumulatedDx = 0;
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
