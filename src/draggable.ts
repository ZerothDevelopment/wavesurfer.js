export function makeDraggable(
  element: HTMLElement | null,
  onDrag: (dx: number, dy: number, x: number, y: number) => void,
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
    
    // Optimized settings for smooth scrolling
    const DRAG_DAMPING = 0.95 // Higher damping for smoother interaction with auto-scroll
    const EDGE_THRESHOLD = 60 // Match the scroll threshold in renderer
    const MIN_DRAG_INTERVAL = 4 // 240fps for ultra-smooth updates
    const MIN_MOVEMENT_THRESHOLD = 0.1 // Very low threshold for immediate response

    const onPointerMove = (event: PointerEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (isTouchDevice && Date.now() - touchStartTime < touchDelay) return

      const currentTime = Date.now()
      const timeDelta = currentTime - lastDragTime
      
      // High-frequency updates for smooth scrolling
      if (timeDelta < MIN_DRAG_INTERVAL) return
      
      const currentMouseX = event.clientX
      const currentMouseY = event.clientY
      
      // Calculate movement from last position
      const rawDx = currentMouseX - lastMouseX
      const rawDy = currentMouseY - lastMouseY
      
      // Check if we should start dragging
      const totalDx = currentMouseX - initialMouseX
      const totalDy = currentMouseY - initialMouseY
      
      if (isDragging || Math.abs(totalDx) > threshold || Math.abs(totalDy) > threshold) {
        // Get current element position and detect scroll changes
        const currentRect = element.getBoundingClientRect()
        const { left, top, width } = currentRect
        
        // Detect and compensate for scroll changes
        let scrollDelta = 0
        if (scrollContainer) {
          const currentScrollLeft = scrollContainer.scrollLeft
          scrollDelta = currentScrollLeft - lastScrollLeft
          lastScrollLeft = currentScrollLeft
        }
        
        // Calculate current mouse position relative to element
        const currentRelativeX = currentMouseX - left
        const currentRelativeY = currentMouseY - top

        if (!isDragging) {
          onStart?.(initialRelativeX, initialRelativeY)
          isDragging = true
        }

        // Calculate distance from edges for smooth interaction
        const distanceFromLeftEdge = currentRelativeX
        const distanceFromRightEdge = width - currentRelativeX
        const minDistanceFromEdge = Math.min(distanceFromLeftEdge, distanceFromRightEdge)
        
        // Minimal edge damping to allow smooth scrolling
        let edgeDamping = 1.0
        if (minDistanceFromEdge < EDGE_THRESHOLD) {
          const edgeRatio = minDistanceFromEdge / EDGE_THRESHOLD
          // Light damping that doesn't interfere with smooth scrolling
          edgeDamping = Math.max(0.7, edgeRatio)
        }
        
        // Smooth scroll compensation
        let compensatedDx = rawDx
        if (Math.abs(scrollDelta) > 0) {
          // Precise compensation for smooth scrolling
          compensatedDx = rawDx - scrollDelta
        }
        
        // Apply minimal damping to preserve responsiveness
        const dampedDx = compensatedDx * DRAG_DAMPING * edgeDamping
        const dampedDy = rawDy * DRAG_DAMPING * edgeDamping
        
        // Accumulate movements for precision
        accumulatedDx += dampedDx
        
        // Immediate response with very low threshold
        if (Math.abs(accumulatedDx) > MIN_MOVEMENT_THRESHOLD) {
          onDrag(accumulatedDx, dampedDy, currentRelativeX, currentRelativeY)
          accumulatedDx = 0
        }

        // Update tracking variables
        lastDragTime = currentTime
        lastMouseX = currentMouseX
        lastMouseY = currentMouseY
      }
    }

    const onPointerUp = (event: PointerEvent) => {
      if (isDragging) {
        const currentRect = element.getBoundingClientRect()
        const { left, top } = currentRect
        const finalX = event.clientX - left
        const finalY = event.clientY - top

        onEnd?.(finalX, finalY)
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
