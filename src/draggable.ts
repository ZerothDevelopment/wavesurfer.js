export function makeDraggable(
  element: HTMLElement | null,
  onDrag: (dx: number, dy: number, x: number, y: number, velocity?: number, mouseX?: number) => void,
  onStart?: (x: number, y: number) => void,
  onEnd?: (x: number, y: number) => void,
  threshold = 3,
  mouseButton = 0,
  touchDelay = 100,
): () => void {
  if (!element) return () => void 0

  const isTouchDevice = matchMedia("(pointer: coarse)").matches

  let unsubscribeDocument = () => void 0

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== mouseButton) return

    event.preventDefault()
    event.stopPropagation()

    // Store initial positions
    const initialMouseX = event.clientX
    const initialMouseY = event.clientY
    const initialRect = element.getBoundingClientRect()
    const initialRelativeX = initialMouseX - initialRect.left
    const initialRelativeY = initialMouseY - initialRect.top
    
    // Find the scroll container (look for parent with scrollable overflow)
    let scrollContainer: HTMLElement | null = element.parentElement
    while (scrollContainer && scrollContainer !== document.body) {
      const style = window.getComputedStyle(scrollContainer)
      if (style.overflowX === "auto" || style.overflowX === "scroll") {
        break
      }
      scrollContainer = scrollContainer.parentElement
    }
    
    let isDragging = false
    const touchStartTime = Date.now()
    
    // Enhanced drag tracking variables
    let lastDragTime = Date.now()
    let lastMouseX = initialMouseX
    let lastMouseY = initialMouseY
    let accumulatedDx = 0
    
    // Velocity tracking for adaptive scrolling (uses incremental moving average to avoid costly reductions)
    const velocityHistory: Array<{ dx: number; dt: number }> = []
    let sumDx = 0
    let sumDt = 0
    let currentVelocity = 0
    
    // Optimized for ultra-smooth continuous scrolling
    const DRAG_DAMPING = 0.99 // Minimal damping for maximum responsiveness
    const MIN_DRAG_INTERVAL = 2 // 500fps - ultra-high frequency for instant response
    const MIN_MOVEMENT_THRESHOLD = 0.001 // Ultra-responsive threshold for rapid scrolling
    const VELOCITY_SAMPLES = 8 // More velocity samples for smoother average
    const VELOCITY_DECAY = 0.92 // Faster velocity decay when not moving

    // Calculate current drag velocity (pixels per millisecond)
    const calculateVelocity = (dx: number, dt: number) => {
      // Maintain a small history of recent movements while tracking their cumulative sums
      velocityHistory.push({ dx, dt })
      sumDx += dx
      sumDt += dt

      if (velocityHistory.length > VELOCITY_SAMPLES) {
        const removed = velocityHistory.shift()!
        sumDx -= removed.dx
        sumDt -= removed.dt
      }

      currentVelocity = sumDt > 0 ? Math.abs(sumDx / sumDt) : 0
      return currentVelocity
    }

    // Removed unused updatePositionDirect helper (was a no-op)

    const onPointerMove = (event: PointerEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (isTouchDevice && Date.now() - touchStartTime < touchDelay) return

      const currentTime = Date.now()
      const timeDelta = currentTime - lastDragTime
      
      // Balanced update frequency for smooth scrolling
      if (timeDelta < MIN_DRAG_INTERVAL) return
      
      const currentMouseX = event.clientX
      const currentMouseY = event.clientY
      
      // Calculate movement from last position
      const rawDx = currentMouseX - lastMouseX
      const rawDy = currentMouseY - lastMouseY
      
      // Calculate velocity for adaptive scrolling
      const velocity = calculateVelocity(rawDx, timeDelta)
      
      // Check if we should start dragging
      const totalDx = currentMouseX - initialMouseX
      const totalDy = currentMouseY - initialMouseY
      
      if (isDragging || Math.abs(totalDx) > threshold || Math.abs(totalDy) > threshold) {
        
        // Simplified position calculation for minimal lag
        const currentRect = element.getBoundingClientRect()
        const { left, top, width } = currentRect
        
        // Use direct relative position for immediate response
        const currentRelativeX = currentMouseX - left
        const currentRelativeY = currentMouseY - top

        if (!isDragging) {
          onStart?.(initialRelativeX, initialRelativeY)
          isDragging = true
        }

        // Debug logging removed for production performance

        // Minimal edge effects since smooth scrolling handles positioning
        let edgeDamping = 1.0
        const distanceFromLeftEdge = currentRelativeX
        const distanceFromRightEdge = width - currentRelativeX
        const minDistanceFromEdge = Math.min(distanceFromLeftEdge, distanceFromRightEdge)
        
        // Very light edge damping only for extreme edges
        if (minDistanceFromEdge < 15) {
          const edgeRatio = minDistanceFromEdge / 15
          edgeDamping = Math.max(0.95, edgeRatio)
        }
        
        // Use raw movement for maximum responsiveness
        const dampedDx = rawDx * DRAG_DAMPING * edgeDamping
        const dampedDy = rawDy * DRAG_DAMPING * edgeDamping
        
        // Accumulate movements
        accumulatedDx += dampedDx
        
        // Ultra-responsive threshold
        if (Math.abs(accumulatedDx) > MIN_MOVEMENT_THRESHOLD) {
          // Use direct relative position for immediate response
          // Pass velocity and absolute mouse X position for adaptive scrolling and continuous scroll
          onDrag(accumulatedDx, dampedDy, currentRelativeX, currentRelativeY, velocity, currentMouseX)
          accumulatedDx = 0
        }

        // Update tracking variables
        lastDragTime = currentTime
        lastMouseX = currentMouseX
        lastMouseY = currentMouseY
      } else {
        // Decay velocity when not actively dragging
        currentVelocity *= VELOCITY_DECAY
      }
    }

    const onPointerUp = (event: PointerEvent) => {
      // Removed unused animation frame cleanup (was never scheduled)
      
      if (isDragging) {
        const currentRect = element.getBoundingClientRect()
        const { left, top } = currentRect
        
        // Use direct relative position for consistency
        const finalRelativeX = event.clientX - left
        const finalRelativeY = event.clientY - top

        // Debug logging removed

        onEnd?.(finalRelativeX, finalRelativeY)
      }
      unsubscribeDocument()
    }

    const onPointerLeave = (e: PointerEvent) => {
      // Listen to events only on the document and not on inner elements
      if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
        onPointerUp(e)
      }
    }

    const onClick = (event: MouseEvent) => {
      if (isDragging) {
        event.stopPropagation()
        event.preventDefault()
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      if (isDragging) {
        event.preventDefault()
      }
    }

    document.addEventListener("pointermove", onPointerMove)
    document.addEventListener("pointerup", onPointerUp)
    document.addEventListener("pointerout", onPointerLeave)
    document.addEventListener("pointercancel", onPointerLeave)
    document.addEventListener("touchmove", onTouchMove, { passive: false })
    document.addEventListener("click", onClick, { capture: true })

    unsubscribeDocument = () => {
      document.removeEventListener("pointermove", onPointerMove)
      document.removeEventListener("pointerup", onPointerUp)
      document.removeEventListener("pointerout", onPointerLeave)
      document.removeEventListener("pointercancel", onPointerLeave)
      document.removeEventListener("touchmove", onTouchMove)
      setTimeout(() => {
        document.removeEventListener("click", onClick, { capture: true })
      }, 10)
    }
  }

  element.addEventListener("pointerdown", onPointerDown)

  return () => {
    unsubscribeDocument()
    element.removeEventListener("pointerdown", onPointerDown)
  }
}
