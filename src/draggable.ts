export function makeDraggable(
  element: HTMLElement | null,
  onDrag: (dx: number, dy: number, x: number, y: number, velocity?: number) => void,
  onStart?: (x: number, y: number) => void,
  onEnd?: (x: number, y: number) => void,
  threshold = 3,
  mouseButton = 0,
  touchDelay = 100,
): () => void {
  if (!element) return () => void 0

  const isTouchDevice = matchMedia('(pointer: coarse)').matches

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
    
    // Store initial element position for consistent calculation
    const initialElementLeft = initialRect.left
    const initialElementTop = initialRect.top
    
    // Find the scroll container (look for parent with scrollable overflow)
    let scrollContainer: HTMLElement | null = element.parentElement
    while (scrollContainer && scrollContainer !== document.body) {
      const style = window.getComputedStyle(scrollContainer)
      if (style.overflowX === 'auto' || style.overflowX === 'scroll') {
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
    let lastScrollLeft = scrollContainer ? scrollContainer.scrollLeft : 0
    
    // Velocity tracking for adaptive scrolling
    let velocityHistory: Array<{ dx: number, dt: number, time: number }> = []
    let currentVelocity = 0
    let animationFrameId: number | null = null
    
    // Optimized for smooth continuous scrolling
    const DRAG_DAMPING = 0.98 // Minimal damping for maximum responsiveness
    const MIN_DRAG_INTERVAL = 4 // 240fps - increased frequency for smoother auto-scroll response
    const MIN_MOVEMENT_THRESHOLD = 0.01 // More responsive threshold for rapid scrolling
    const VELOCITY_SAMPLES = 5 // Number of velocity samples to average
    const VELOCITY_DECAY = 0.95 // How quickly velocity decays when not moving

    // Calculate current drag velocity (pixels per millisecond)
    const calculateVelocity = (dx: number, dt: number) => {
      const currentTime = Date.now()
      
      // Add current sample to history
      velocityHistory.push({ dx, dt, time: currentTime })
      
      // Keep only recent samples
      if (velocityHistory.length > VELOCITY_SAMPLES) {
        velocityHistory.shift()
      }
      
      // Calculate average velocity from recent samples
      if (velocityHistory.length > 1) {
        const totalDx = velocityHistory.reduce((sum, sample) => sum + sample.dx, 0)
        const totalDt = velocityHistory.reduce((sum, sample) => sum + sample.dt, 0)
        currentVelocity = totalDt > 0 ? Math.abs(totalDx / totalDt) : 0
      }
      
      return currentVelocity
    }

    // Use requestAnimationFrame for smooth position updates
    const updatePositionWithRAF = (callback: () => void) => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
      }
      animationFrameId = requestAnimationFrame(callback)
    }

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
        
        // Use requestAnimationFrame for smooth position calculations
        updatePositionWithRAF(() => {
          // Get current element position
          const currentRect = element.getBoundingClientRect()
          const { left, top, width } = currentRect
          
          // Calculate position relative to the initial element position
          // This maintains consistency regardless of scroll changes
          const elementPositionDelta = left - initialElementLeft
          const adjustedRelativeX = (currentMouseX - initialElementLeft) - elementPositionDelta
          const adjustedRelativeY = (currentMouseY - initialElementTop) - elementPositionDelta
          
          // Also calculate the traditional relative position for comparison
          const currentRelativeX = currentMouseX - left
          const currentRelativeY = currentMouseY - top

          if (!isDragging) {
            console.log('🎯 DRAG START:', {
              initialMouseX, initialMouseY,
              initialRelativeX, initialRelativeY,
              elementRect: { left, top, width },
              initialElementLeft, initialElementTop
            })
            onStart?.(initialRelativeX, initialRelativeY)
            isDragging = true
          }

          // DEBUG: Log key values during drag including velocity
          console.log('📊 POSITION TRACKING:', {
            currentMouseX,
            elementLeft: left,
            initialElementLeft,
            elementPositionDelta,
            currentRelativeX,
            adjustedRelativeX,
            rawDx,
            velocity: velocity.toFixed(2),
            timeDelta
          })

          // Minimal edge effects since smooth scrolling handles positioning
          let edgeDamping = 1.0
          const distanceFromLeftEdge = currentRelativeX
          const distanceFromRightEdge = width - currentRelativeX
          const minDistanceFromEdge = Math.min(distanceFromLeftEdge, distanceFromRightEdge)
          
          // Very light edge damping only for extreme edges
          if (minDistanceFromEdge < 20) {
            const edgeRatio = minDistanceFromEdge / 20
            edgeDamping = Math.max(0.9, edgeRatio)
          }
          
          // Use raw movement for maximum responsiveness
          const dampedDx = rawDx * DRAG_DAMPING * edgeDamping
          const dampedDy = rawDy * DRAG_DAMPING * edgeDamping
          
          // Accumulate movements
          accumulatedDx += dampedDx
          
          // Very responsive threshold
          if (Math.abs(accumulatedDx) > MIN_MOVEMENT_THRESHOLD) {
            console.log('🎮 DRAG MOVE:', {
              accumulatedDx,
              dampedDy,
              currentRelativeX,
              adjustedRelativeX,
              rawDx,
              dampedDx,
              elementPositionDelta,
              velocity: velocity.toFixed(2)
            })
            // Use the adjusted relative position for more consistent behavior
            // Pass velocity as additional parameter for adaptive scrolling
            onDrag(accumulatedDx, dampedDy, adjustedRelativeX, adjustedRelativeY, velocity)
            accumulatedDx = 0
          }
        })

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
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
        animationFrameId = null
      }
      
      if (isDragging) {
        const currentRect = element.getBoundingClientRect()
        const { left, top } = currentRect
        
        // Use the same adjustment logic as in onPointerMove
        const elementPositionDelta = left - initialElementLeft
        const adjustedFinalX = (event.clientX - initialElementLeft) - elementPositionDelta
        const adjustedFinalY = (event.clientY - initialElementTop) - elementPositionDelta

        console.log('🎯 DRAG END:', {
          clientX: event.clientX,
          elementLeft: left,
          initialElementLeft,
          elementPositionDelta,
          adjustedFinalX,
          adjustedFinalY
        })

        onEnd?.(adjustedFinalX, adjustedFinalY)
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

    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointerout', onPointerLeave)
    document.addEventListener('pointercancel', onPointerLeave)
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('click', onClick, { capture: true })

    unsubscribeDocument = () => {
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointerout', onPointerLeave)
      document.removeEventListener('pointercancel', onPointerLeave)
      document.removeEventListener('touchmove', onTouchMove)
      setTimeout(() => {
        document.removeEventListener('click', onClick, { capture: true })
      }, 10)
    }
  }

  element.addEventListener('pointerdown', onPointerDown)

  return () => {
    unsubscribeDocument()
    element.removeEventListener('pointerdown', onPointerDown)
  }
}
