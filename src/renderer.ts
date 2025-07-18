import { makeDraggable } from './draggable.js'
import EventEmitter from './event-emitter.js'
import type { WaveSurferOptions } from './wavesurfer.js'
// @ts-ignore
import Lenis from 'lenis'

type RendererEvents = {
  click: [relativeX: number, relativeY: number]
  dblclick: [relativeX: number, relativeY: number]
  drag: [relativeX: number]
  dragstart: [relativeX: number]
  dragend: [relativeX: number]
  scroll: [relativeStart: number, relativeEnd: number, scrollLeft: number, scrollRight: number]
  render: []
  rendered: []
}

class Renderer extends EventEmitter<RendererEvents> {
  private static MAX_CANVAS_WIDTH = 8000
  private static MAX_NODES = 10
  private options: WaveSurferOptions
  private parent: HTMLElement
  private container: HTMLElement
  private scrollContainer: HTMLElement
  private wrapper: HTMLElement
  private canvasWrapper: HTMLElement
  private progressWrapper: HTMLElement
  private cursor: HTMLElement
  private timeouts: Array<() => void> = []
  private isScrollable = false
  private audioData: AudioBuffer | null = null
  private resizeObserver: ResizeObserver | null = null
  private lastContainerWidth = 0
  private dragRelativeX: number | null = null
  private subscriptions: (() => void)[] = []
  private unsubscribeOnScroll: (() => void)[] = []
  private lenis: any = null
  private isDragging = false
  private realTimeProgress: number | null = null
  private animationFrameId: number | null = null
  private isUserInteracting = false
  private interactionTimeout: number | null = null
  private continuousScrollInterval: number | null = null
  private continuousScrollDirection: 'left' | 'right' | null = null

  // Stores the pointer's X position during drag so we can recompute progress when auto-scroll moves the waveform
  private lastDragMouseX: number | null = null

  // Cache last cursor progress to skip redundant DOM writes
  private lastCursorProgress: number = -1

  // Cache wrapper rect during a drag session
  private wrapperRect: DOMRect | null = null

  // Store last Lenis options hash to avoid unnecessary re-init
  private lastLenisHash: string | null = null

  // Track DOM listeners to ensure we can remove them in destroy()
  private domSubscriptions: Array<() => void> = []

  constructor(options: WaveSurferOptions, audioElement?: HTMLElement) {
    super()

    this.subscriptions = []
    this.options = options

    const parent = this.parentFromOptionsContainer(options.container)
    this.parent = parent

    const [div, shadow] = this.initHtml()
    parent.appendChild(div)
    this.container = div
    this.scrollContainer = shadow.querySelector('.scroll') as HTMLElement
    this.wrapper = shadow.querySelector('.wrapper') as HTMLElement
    this.canvasWrapper = shadow.querySelector('.canvases') as HTMLElement
    this.progressWrapper = shadow.querySelector('.progress') as HTMLElement
    this.cursor = shadow.querySelector('.cursor') as HTMLElement

    if (audioElement) {
      shadow.appendChild(audioElement)
    }

    this.initEvents()
    this.initLenis()
  }

  private parentFromOptionsContainer(container: WaveSurferOptions['container']) {
    let parent
    if (typeof container === 'string') {
      parent = document.querySelector(container) satisfies HTMLElement | null
    } else if (container instanceof HTMLElement) {
      parent = container
    }

    if (!parent) {
      throw new Error('Container not found')
    }

    return parent
  }

  private initEvents() {
    const getClickPosition = (e: MouseEvent): [number, number] => {
      const rect = this.wrapper.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const relativeX = x / rect.width
      const relativeY = y / rect.height
      return [relativeX, relativeY]
    }

    // Helper to add and track DOM listeners for cleanup
    const addDOMListener = <E extends Event>(
      target: EventTarget,
      type: string,
      handler: (evt: E) => void,
      options?: AddEventListenerOptions,
    ) => {
      // Cast to the broader EventListener type to satisfy the addEventListener signature
      const listener: EventListener = handler as unknown as EventListener
      target.addEventListener(type, listener, options)
      const unsubscribe = () => target.removeEventListener(type, listener, options)
      this.domSubscriptions.push(unsubscribe)
      return unsubscribe
    }

    // Click & double-click listeners
    addDOMListener(this.wrapper, 'click', (e: MouseEvent) => {
      const [x, y] = getClickPosition(e)
      this.emit('click', x, y)
    })

    addDOMListener(this.wrapper, 'dblclick', (e: MouseEvent) => {
      const [x, y] = getClickPosition(e)
      this.emit('dblclick', x, y)
    })

    // Unified PointerEvents to handle mouse, touch, pen
    addDOMListener(this.wrapper, 'pointerdown', () => this.startUserInteraction())
    addDOMListener(this.wrapper, 'pointerup', () => this.endUserInteraction())
    addDOMListener(this.wrapper, 'pointerleave', () => this.endUserInteraction())
    addDOMListener(this.wrapper, 'pointercancel', () => this.endUserInteraction())

    // Drag
    if (this.options.dragToSeek === true || typeof this.options.dragToSeek === 'object') {
      this.initDrag()
    }

    // Add a scroll listener
    this.scrollContainer.addEventListener('scroll', () => {
      const { scrollLeft, scrollWidth, clientWidth } = this.scrollContainer
      const startX = scrollLeft / scrollWidth
      const endX = (scrollLeft + clientWidth) / scrollWidth
      this.emit('scroll', startX, endX, scrollLeft, scrollLeft + clientWidth)
    })

    // Re-render the waveform on container resize
    if (typeof ResizeObserver === 'function') {
      const delay = this.createIdleDelay(100)
      this.resizeObserver = new ResizeObserver(() => {
        delay()
          .then(() => this.onContainerResize())
          .catch(() => undefined)
      })
      this.resizeObserver.observe(this.scrollContainer)
    }
  }

  private onContainerResize() {
    const width = this.parent.clientWidth
    if (width === this.lastContainerWidth && this.options.height !== 'auto') return
    this.lastContainerWidth = width
    this.reRender()
  }

  private initDrag() {
    this.subscriptions.push(
      makeDraggable(
        this.wrapper,
        // Drag callback: dx, dy are unused here; x is the relative X position within wrapper
        (_, __, x, ___, velocity = 0, mouseX = 0) => {
          const wrapperWidth = this.wrapperRect?.width ?? this.wrapper.getBoundingClientRect().width
          const relative = Math.max(0, Math.min(1, x / wrapperWidth))
          this.dragRelativeX = relative
          this.realTimeProgress = relative
          // Store mouse position for later recalculations during auto-scroll
          this.lastDragMouseX = mouseX

          // Immediate updates for both cursor and progress fill
          this.updateCursorPosition(relative)
          this.renderProgress(relative)
          
          // Start real-time cursor updates
          this.startRealTimeCursorUpdates()
          
          // Update continuous scroll based on mouse position
          this.updateContinuousScroll(mouseX)
          
          this.emit('drag', relative)
        },
        // On start drag
        (x) => {
          this.isDragging = true
          this.startUserInteraction() // Stop smooth scrolling during drag
          this.wrapperRect = this.wrapper.getBoundingClientRect()
          const wrapperWidth = this.wrapperRect.width
          this.dragRelativeX = this.clamp(x / wrapperWidth, 0, 1)
          this.realTimeProgress = this.dragRelativeX
          

          
          this.emit('dragstart', this.dragRelativeX)
        },
        // On end drag
        (x) => {
          this.isDragging = false
          this.stopRealTimeCursorUpdates()
          this.stopContinuousScroll() // Stop continuous scrolling
          const wrapperWidth = this.wrapperRect?.width ?? this.wrapper.getBoundingClientRect().width
          const relative = Math.max(0, Math.min(1, x / wrapperWidth))
          this.dragRelativeX = null
          this.realTimeProgress = null
          this.wrapperRect = null
          this.lastDragMouseX = null
          this.endUserInteraction() // Re-enable smooth scrolling after drag
          this.emit('dragend', relative)
        },
      ),
    )
  }

  private getHeight(
    optionsHeight?: WaveSurferOptions['height'],
    optionsSplitChannel?: WaveSurferOptions['splitChannels'],
  ): number {
    const defaultHeight = 128
    const numberOfChannels = this.audioData?.numberOfChannels || 1
    if (optionsHeight == null) return defaultHeight
    if (!isNaN(Number(optionsHeight))) return Number(optionsHeight)
    if (optionsHeight === 'auto') {
      const height = this.parent.clientHeight || defaultHeight
      if (optionsSplitChannel?.every((channel) => !channel.overlay)) return height / numberOfChannels
      return height
    }
    return defaultHeight
  }

  private initHtml(): [HTMLElement, ShadowRoot] {
    const div = document.createElement('div')
    const shadow = div.attachShadow({ mode: 'open' })

    const cspNonce =
      this.options.cspNonce && typeof this.options.cspNonce === 'string' ? this.options.cspNonce.replace(/"/g, '') : ''

    shadow.innerHTML = `
      <style${cspNonce ? ` nonce="${cspNonce}"` : ''}>
        :host {
          user-select: none;
          min-width: 1px;
        }
        :host audio {
          display: block;
          width: 100%;
        }
        :host .scroll {
          overflow-x: auto;
          overflow-y: hidden;
          width: 100%;
          position: relative;
          scroll-behavior: auto; /* Disable smooth scrolling for instant response during drag */
        }
        :host .noScrollbar {
          scrollbar-color: transparent;
          scrollbar-width: none;
        }
        :host .noScrollbar::-webkit-scrollbar {
          display: none;
          -webkit-appearance: none;
        }
        :host .wrapper {
          position: relative;
          overflow: visible;
          z-index: 2;
        }
        :host .canvases {
          min-height: ${this.getHeight(this.options.height, this.options.splitChannels)}px;
        }
        :host .canvases > div {
          position: relative;
        }
        :host canvas {
          display: block;
          position: absolute;
          top: 0;
          image-rendering: pixelated;
        }
        :host .progress {
          pointer-events: none;
          position: absolute;
          z-index: 2;
          top: 0;
          left: 0;
          width: 0;
          height: 100%;
          overflow: hidden;
        }
        :host .progress > div {
          position: relative;
        }
        :host .cursor {
          pointer-events: none;
          position: absolute;
          z-index: 5;
          top: 0;
          left: 0;
          height: 100%;
          border-radius: 2px;
        }
      </style>

      <div class="scroll" part="scroll">
        <div class="wrapper" part="wrapper">
          <div class="canvases" part="canvases"></div>
          <div class="progress" part="progress"></div>
          <div class="cursor" part="cursor"></div>
        </div>
      </div>
    `

    return [div, shadow]
  }

  /** Wavesurfer itself calls this method. Do not call it manually. */
  setOptions(options: WaveSurferOptions) {
    if (this.options.container !== options.container) {
      const newParent = this.parentFromOptionsContainer(options.container)
      newParent.appendChild(this.container)

      this.parent = newParent
    }

    if (options.dragToSeek === true || typeof this.options.dragToSeek === 'object') {
      this.initDrag()
    }

    this.options = options

    // Re-render the waveform
    this.reRender()
  }

  getWrapper(): HTMLElement {
    return this.wrapper
  }

  getWidth(): number {
    return this.scrollContainer.clientWidth
  }

  getScroll(): number {
    return this.scrollContainer.scrollLeft
  }

  setScroll(pixels: number) {
    this.scrollContainer.scrollLeft = pixels
  }

  setScrollPercentage(percent: number) {
    const { scrollWidth } = this.scrollContainer
    const scrollStart = scrollWidth * percent
    this.setScroll(scrollStart)
  }

  destroy() {
    this.subscriptions.forEach((unsubscribe) => unsubscribe())
    this.domSubscriptions.forEach((unsubscribe) => unsubscribe())
    this.container.remove()
    this.resizeObserver?.disconnect()
    this.unsubscribeOnScroll?.forEach((unsubscribe) => unsubscribe())
    this.unsubscribeOnScroll = []
    this.stopRealTimeCursorUpdates()
    this.stopContinuousScroll()
    
    // Clean up interaction timeout
    if (this.interactionTimeout) {
      clearTimeout(this.interactionTimeout)
      this.interactionTimeout = null
    }
    
    if (this.lenis) {
      this.lenis.destroy()
      this.lenis = null
    }
  }

  private initLenis() {
    const optionsHash = JSON.stringify({ smooth: true, lerp: 0.05, wheelMultiplier: 0.8, touchMultiplier: 1 })
    if (this.lenis && this.lastLenisHash === optionsHash) {
      return // No change in config, skip re-init
    }

    if (this.lenis) {
      this.lenis.destroy()
    }

    this.lastLenisHash = optionsHash

    this.lenis = new Lenis({
      wrapper: this.scrollContainer,
      content: this.wrapper,
      lerp: 0.05,
      smoothWheel: true,
      wheelMultiplier: 0.8,
      touchMultiplier: 1.0,
      autoRaf: true,
      orientation: 'horizontal'
    })
    
    this.lenis.on('scroll', (instance: any) => {
      const animatedScrollLeft = instance.animatedScroll || 0
      const { scrollWidth, clientWidth } = this.scrollContainer
      const startX = animatedScrollLeft / scrollWidth
      const endX = (animatedScrollLeft + clientWidth) / scrollWidth
      this.emit('scroll', startX, endX, animatedScrollLeft, animatedScrollLeft + clientWidth)
      

      
      this.syncCursorWithScroll()
    })
  }

  private startRealTimeCursorUpdates() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId)
    }
    
    const updateCursor = () => {
      if (this.isDragging && this.realTimeProgress !== null) {
        this.updateCursorPosition(this.realTimeProgress)
        this.animationFrameId = requestAnimationFrame(updateCursor)
      } else {
        this.animationFrameId = null
      }
    }
    
    this.animationFrameId = requestAnimationFrame(updateCursor)
  }

  private stopRealTimeCursorUpdates() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
    
    if (this.realTimeProgress !== null) {
      this.updateCursorPosition(this.realTimeProgress)
    }
  }

  private updateCursorPosition(progress: number) {
    if (isNaN(progress)) return
    if (progress === this.lastCursorProgress) return
    this.lastCursorProgress = progress
    const percents = progress * 100
    this.cursor.style.left = `${percents}%`
    this.cursor.style.transform = `translateX(-${Math.round(percents) === 100 ? this.options.cursorWidth : 0}px)`
  }

  private syncCursorWithScroll() {
    if (!this.isDragging && this.realTimeProgress !== null) {
      this.updateCursorPosition(this.realTimeProgress)
    }
  }

  private startUserInteraction() {
    this.isUserInteracting = true
    
    if (this.interactionTimeout) {
      clearTimeout(this.interactionTimeout)
    }
    
    if (this.lenis) {
      this.lenis.stop()
    }
  }

  private endUserInteraction() {
    if (this.interactionTimeout) {
      clearTimeout(this.interactionTimeout)
    }
    
    this.interactionTimeout = window.setTimeout(() => {
      this.isUserInteracting = false
      
      if (this.lenis) {
        this.lenis.start()
      }
    }, 500)
  }



  private startContinuousScroll(direction: 'left' | 'right', speed: number) {
    this.stopContinuousScroll()
    
    this.continuousScrollDirection = direction
    
    let currentSpeed = speed * 0.3
    const maxSpeed = speed
    const acceleration = 0.1
    
    const scroll = () => {
      if (!this.isDragging || !this.continuousScrollDirection) {
        this.stopContinuousScroll()
        return
      }
      
      currentSpeed = Math.min(currentSpeed + acceleration, maxSpeed)
      const scrollAmount = this.continuousScrollDirection === 'right' ? currentSpeed : -currentSpeed
      const currentScrollLeft = this.lenis?.animatedScroll || this.scrollContainer.scrollLeft
      const newScrollLeft = currentScrollLeft + scrollAmount
      const maxScrollLeft = this.scrollContainer.scrollWidth - this.scrollContainer.clientWidth
      const clampedScrollLeft = this.clamp(newScrollLeft, 0, maxScrollLeft)
      
      if (this.lenis) {
        this.lenis.scrollTo(clampedScrollLeft, { immediate: true, force: true })
      } else {
        this.scrollContainer.scrollLeft = clampedScrollLeft
      }

      // Recompute progress based on current mouse position to keep cursor aligned
      if (this.lastDragMouseX !== null) {
        const wrapperRect = this.wrapper.getBoundingClientRect()
        const wrapperWidth = wrapperRect.width
        const newRelative = this.clamp((this.lastDragMouseX - wrapperRect.left) / wrapperWidth, 0, 1)
        this.dragRelativeX = newRelative
        this.realTimeProgress = newRelative
        this.updateCursorPosition(newRelative)
        this.renderProgress(newRelative)
      }
      
      this.continuousScrollInterval = requestAnimationFrame(scroll)
    }
    
    this.continuousScrollInterval = requestAnimationFrame(scroll)
  }

  private stopContinuousScroll() {
    if (this.continuousScrollInterval) {
      cancelAnimationFrame(this.continuousScrollInterval)
      this.continuousScrollInterval = null
    }
    this.continuousScrollDirection = null
  }

  private updateContinuousScroll(mouseX: number) {
    if (!this.isDragging) return
    
    const containerRect = this.scrollContainer.getBoundingClientRect()
    const relativeX = mouseX - containerRect.left
    const containerWidth = containerRect.width
    const edgeZoneWidth = containerWidth * 0.2
    const leftEdgeZone = edgeZoneWidth
    const rightEdgeZone = containerWidth - edgeZoneWidth
    
    let shouldScroll = false
    let direction: 'left' | 'right' | null = null
    let speed = 0
    
    if (relativeX < leftEdgeZone) {
      shouldScroll = true
      direction = 'left'
      const edgeProximity = 1 - (relativeX / leftEdgeZone)
      speed = Math.max(2, edgeProximity * 12)
    } else if (relativeX > rightEdgeZone) {
      shouldScroll = true
      direction = 'right'
      const edgeProximity = (relativeX - rightEdgeZone) / edgeZoneWidth
      speed = Math.max(2, edgeProximity * 12)
    }
    
    if (shouldScroll && direction) {
      if (this.continuousScrollDirection !== direction) {
        this.startContinuousScroll(direction, speed)
      }
    } else {
      this.stopContinuousScroll()
    }
  }



  private createDelay(delayMs = 10): () => Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    let reject: (() => void) | undefined

    const onClear = () => {
      if (timeout) clearTimeout(timeout)
      if (reject) reject()
    }

    this.timeouts.push(onClear)

    return () => {
      return new Promise((resolveFn, rejectFn) => {
        onClear()
        reject = rejectFn
        timeout = setTimeout(() => {
          timeout = undefined
          reject = undefined
          resolveFn()
        }, delayMs)
      })
    }
  }

  // Like createDelay but prefers requestIdleCallback when available
  private createIdleDelay(delayMs = 10): () => Promise<void> {
    if ('requestIdleCallback' in window) {
      let id: number | null = null
      let reject: (() => void) | undefined

      const clear = () => {
        if (id !== null) (window as any).cancelIdleCallback(id)
        if (reject) reject()
      }

      this.timeouts.push(clear)

      return () => {
        return new Promise<void>((resolve, rej) => {
          clear()
          reject = rej
          id = (window as any).requestIdleCallback(() => {
            id = null
            reject = undefined
            resolve()
          }, { timeout: delayMs })
        })
      }
    }

    return this.createDelay(delayMs)
  }

  // Convert array of color values to linear gradient
  private convertColorValues(color?: WaveSurferOptions['waveColor']): string | CanvasGradient {
    if (!Array.isArray(color)) return color || ''
    if (color.length < 2) return color[0] || ''

    const canvasElement = document.createElement('canvas')
    const ctx = canvasElement.getContext('2d') as CanvasRenderingContext2D
    const gradientHeight = canvasElement.height * (window.devicePixelRatio || 1)
    const gradient = ctx.createLinearGradient(0, 0, 0, gradientHeight)

    const colorStopPercentage = 1 / (color.length - 1)
    color.forEach((color, index) => {
      const offset = index * colorStopPercentage
      gradient.addColorStop(offset, color)
    })

    return gradient
  }

  private getPixelRatio() {
    return Math.max(1, window.devicePixelRatio || 1)
  }

  // Simple clamp helper
  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
  }

  private renderBarWaveform(
    channelData: Array<Float32Array | number[]>,
    options: WaveSurferOptions,
    ctx: CanvasRenderingContext2D,
    vScale: number,
  ) {
    const topChannel = channelData[0]
    const bottomChannel = channelData[1] || channelData[0]
    const length = topChannel.length

    const { width, height } = ctx.canvas
    const halfHeight = height / 2

    const { barWidth, barGap, barRadius } = this.getBarDimensions(options)
    const barIndexScale = width / (barWidth + barGap) / length

    const rectFn = barRadius && 'roundRect' in ctx ? 'roundRect' : 'rect'

    ctx.beginPath()

    let prevX = 0
    let maxTop = 0
    let maxBottom = 0
    for (let i = 0; i <= length; i++) {
      const x = Math.round(i * barIndexScale)

      if (x > prevX) {
        const topBarHeight = Math.round(maxTop * halfHeight * vScale)
        const bottomBarHeight = Math.round(maxBottom * halfHeight * vScale)
        const barHeight = topBarHeight + bottomBarHeight || 1

        // Vertical alignment
        let y = halfHeight - topBarHeight
        if (options.barAlign === 'top') {
          y = 0
        } else if (options.barAlign === 'bottom') {
          y = height - barHeight
        }

        ctx[rectFn](prevX * (barWidth + barGap), y, barWidth, barHeight, barRadius)

        prevX = x
        maxTop = 0
        maxBottom = 0
      }

      const magnitudeTop = Math.abs(topChannel[i] || 0)
      const magnitudeBottom = Math.abs(bottomChannel[i] || 0)
      if (magnitudeTop > maxTop) maxTop = magnitudeTop
      if (magnitudeBottom > maxBottom) maxBottom = magnitudeBottom
    }

    ctx.fill()
    ctx.closePath()
  }

  private renderLineWaveform(
    channelData: Array<Float32Array | number[]>,
    _options: WaveSurferOptions,
    ctx: CanvasRenderingContext2D,
    vScale: number,
  ) {
    const drawChannel = (index: number) => {
      const channel = channelData[index] || channelData[0]
      const length = channel.length
      const { height } = ctx.canvas
      const halfHeight = height / 2
      const hScale = ctx.canvas.width / length

      ctx.moveTo(0, halfHeight)

      let prevX = 0
      let max = 0
      for (let i = 0; i <= length; i++) {
        const x = Math.round(i * hScale)

        if (x > prevX) {
          const h = Math.round(max * halfHeight * vScale) || 1
          const y = halfHeight + h * (index === 0 ? -1 : 1)
          ctx.lineTo(prevX, y)
          prevX = x
          max = 0
        }

        const value = Math.abs(channel[i] || 0)
        if (value > max) max = value
      }

      ctx.lineTo(prevX, halfHeight)
    }

    ctx.beginPath()

    drawChannel(0)
    drawChannel(1)

    ctx.fill()
    ctx.closePath()
  }

  private renderWaveform(
    channelData: Array<Float32Array | number[]>,
    options: WaveSurferOptions,
    ctx: CanvasRenderingContext2D,
  ) {
    ctx.fillStyle = this.convertColorValues(options.waveColor)

    // Custom rendering function
    if (options.renderFunction) {
      options.renderFunction(channelData, ctx)
      return
    }

    // Vertical scaling
    let vScale = options.barHeight || 1
    if (options.normalize) {
      const max = Array.from(channelData[0]).reduce((max, value) => Math.max(max, Math.abs(value)), 0)
      vScale = max ? 1 / max : 1
    }

    // Render waveform as bars
    if (options.barWidth || options.barGap || options.barAlign) {
      this.renderBarWaveform(channelData, options, ctx, vScale)
      return
    }

    // Render waveform as a polyline
    this.renderLineWaveform(channelData, options, ctx, vScale)
  }

  private renderSingleCanvas(
    data: Array<Float32Array | number[]>,
    options: WaveSurferOptions,
    width: number,
    height: number,
    offset: number,
    canvasContainer: HTMLElement,
    progressContainer: HTMLElement,
  ) {
    const pixelRatio = this.getPixelRatio()
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * pixelRatio)
    canvas.height = Math.round(height * pixelRatio)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    canvas.style.left = `${Math.round(offset)}px`
    canvasContainer.appendChild(canvas)

    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D

    this.renderWaveform(data, options, ctx)

    // Draw a progress canvas
    if (canvas.width > 0 && canvas.height > 0) {
      const progressCanvas = canvas.cloneNode() as HTMLCanvasElement
      const progressCtx = progressCanvas.getContext('2d') as CanvasRenderingContext2D
      progressCtx.drawImage(canvas, 0, 0)
      // Set the composition method to draw only where the waveform is drawn
      progressCtx.globalCompositeOperation = 'source-in'
      progressCtx.fillStyle = this.convertColorValues(options.progressColor)
      // This rectangle acts as a mask thanks to the composition method
      progressCtx.fillRect(0, 0, canvas.width, canvas.height)
      progressContainer.appendChild(progressCanvas)
    }
  }

  private renderMultiCanvas(
    channelData: Array<Float32Array | number[]>,
    options: WaveSurferOptions,
    width: number,
    height: number,
    canvasContainer: HTMLElement,
    progressContainer: HTMLElement,
  ) {
    const pixelRatio = this.getPixelRatio()
    const { clientWidth } = this.scrollContainer
    const totalWidth = width / pixelRatio

    let singleCanvasWidth = Math.min(Renderer.MAX_CANVAS_WIDTH, clientWidth, totalWidth)
    let drawnIndexes: Record<number, boolean> = {}

    // Adjust width to avoid gaps between canvases when using bars
    if (options.barWidth || options.barGap) {
      const barWidth = options.barWidth || 0.5
      const barGap = options.barGap || barWidth / 2
      const totalBarWidth = barWidth + barGap
      if (singleCanvasWidth % totalBarWidth !== 0) {
        singleCanvasWidth = Math.floor(singleCanvasWidth / totalBarWidth) * totalBarWidth
      }
    }

    // Nothing to render
    if (singleCanvasWidth === 0) return

    // Draw a single canvas
    const draw = (index: number) => {
      if (index < 0 || index >= numCanvases) return
      if (drawnIndexes[index]) return
      drawnIndexes[index] = true
      const offset = index * singleCanvasWidth
      let clampedWidth = Math.min(totalWidth - offset, singleCanvasWidth)

      // Clamp the width to the bar grid to avoid empty canvases at the end
      if (options.barWidth || options.barGap) {
        const barWidth = options.barWidth || 0.5
        const barGap = options.barGap || barWidth / 2
        const totalBarWidth = barWidth + barGap
        clampedWidth = Math.floor(clampedWidth / totalBarWidth) * totalBarWidth
      }

      if (clampedWidth <= 0) return
      const data = channelData.map((channel) => {
        const start = Math.floor((offset / totalWidth) * channel.length)
        const end = Math.floor(((offset + clampedWidth) / totalWidth) * channel.length)
        return channel.slice(start, end)
      })
      this.renderSingleCanvas(data, options, clampedWidth, height, offset, canvasContainer, progressContainer)
    }

    // Clear canvases to avoid too many DOM nodes
    const clearCanvases = () => {
      if (Object.keys(drawnIndexes).length > Renderer.MAX_NODES) {
        canvasContainer.innerHTML = ''
        progressContainer.innerHTML = ''
        drawnIndexes = {}
      }
    }

    // Calculate how many canvases to render
    const numCanvases = Math.ceil(totalWidth / singleCanvasWidth)

    // Render all canvases if the waveform doesn't scroll
    if (!this.isScrollable) {
      for (let i = 0; i < numCanvases; i++) {
        draw(i)
      }
      return
    }

    // Lazy rendering
    const viewPosition = this.scrollContainer.scrollLeft / totalWidth
    const startCanvas = Math.floor(viewPosition * numCanvases)

    // Draw the canvases in the viewport first
    draw(startCanvas - 1)
    draw(startCanvas)
    draw(startCanvas + 1)

    // Subscribe to the scroll event to draw additional canvases
    if (numCanvases > 1) {
      const unsubscribe = this.on('scroll', () => {
        const { scrollLeft } = this.scrollContainer
        const canvasIndex = Math.floor((scrollLeft / totalWidth) * numCanvases)
        clearCanvases()
        draw(canvasIndex - 1)
        draw(canvasIndex)
        draw(canvasIndex + 1)
      })

      this.unsubscribeOnScroll.push(unsubscribe)
    }
  }

  private renderChannel(
    channelData: Array<Float32Array | number[]>,
    { overlay, ...options }: WaveSurferOptions & { overlay?: boolean },
    width: number,
    channelIndex: number,
  ) {
    // A container for canvases
    const canvasContainer = document.createElement('div')
    const height = this.getHeight(options.height, options.splitChannels)
    canvasContainer.style.height = `${height}px`
    if (overlay && channelIndex > 0) {
      canvasContainer.style.marginTop = `-${height}px`
    }
    this.canvasWrapper.style.minHeight = `${height}px`
    this.canvasWrapper.appendChild(canvasContainer)

    // A container for progress canvases
    const progressContainer = canvasContainer.cloneNode() as HTMLElement
    this.progressWrapper.appendChild(progressContainer)

    // Render the waveform
    this.renderMultiCanvas(channelData, options, width, height, canvasContainer, progressContainer)
  }

  async render(audioData: AudioBuffer) {
    // Clear previous timeouts
    this.timeouts.forEach((clear) => clear())
    this.timeouts = []

    // Clear the canvases
    this.canvasWrapper.innerHTML = ''
    this.progressWrapper.innerHTML = ''

    // Width
    if (this.options.width != null) {
      this.scrollContainer.style.width =
        typeof this.options.width === 'number' ? `${this.options.width}px` : this.options.width
    }

    // Determine the width of the waveform
    const pixelRatio = this.getPixelRatio()
    const parentWidth = this.scrollContainer.clientWidth
    const scrollWidth = Math.ceil(audioData.duration * (this.options.minPxPerSec || 0))

    // Whether the container should scroll
    this.isScrollable = scrollWidth > parentWidth
    const useParentWidth = this.options.fillParent && !this.isScrollable
    // Width of the waveform in pixels
    const width = (useParentWidth ? parentWidth : scrollWidth) * pixelRatio

    // Set the width of the wrapper
    this.wrapper.style.width = useParentWidth ? '100%' : `${scrollWidth}px`

    // Set additional styles
    this.scrollContainer.style.overflowX = this.isScrollable ? 'auto' : 'hidden'
    this.scrollContainer.classList.toggle('noScrollbar', !!this.options.hideScrollbar)
    this.cursor.style.backgroundColor = `${this.options.cursorColor || this.options.progressColor}`
    this.cursor.style.width = `${this.options.cursorWidth}px`

    this.audioData = audioData

    // Reinitialize Lenis after rendering
    this.initLenis()

    this.emit('render')

    // Render the waveform
    if (this.options.splitChannels) {
      // Render a waveform for each channel
      for (let i = 0; i < audioData.numberOfChannels; i++) {
        const options = { ...this.options, ...this.options.splitChannels?.[i] }
        this.renderChannel([audioData.getChannelData(i)], options, width, i)
      }
    } else {
      // Render a single waveform for the first two channels (left and right)
      const channels = [audioData.getChannelData(0)]
      if (audioData.numberOfChannels > 1) channels.push(audioData.getChannelData(1))
      this.renderChannel(channels, this.options, width, 0)
    }

    // Must be emitted asynchronously for backward compatibility
    Promise.resolve().then(() => this.emit('rendered'))
  }

  reRender() {
    this.unsubscribeOnScroll.forEach((unsubscribe) => unsubscribe())
    this.unsubscribeOnScroll = []

    // Return if the waveform has not been rendered yet
    if (!this.audioData) return

    // Remember the current cursor position
    const { scrollWidth } = this.scrollContainer
    const { right: before } = this.progressWrapper.getBoundingClientRect()

    // Re-render the waveform
    this.render(this.audioData)

    // Adjust the scroll position so that the cursor stays in the same place
    if (this.isScrollable && scrollWidth !== this.scrollContainer.scrollWidth) {
      const { right: after } = this.progressWrapper.getBoundingClientRect()
      let delta = after - before
      // to limit compounding floating-point drift
      // we need to round to the half px furthest from 0
      delta *= 2
      delta = delta < 0 ? Math.floor(delta) : Math.ceil(delta)
      delta /= 2
      this.scrollContainer.scrollLeft += delta
    }
  }

  zoom(minPxPerSec: number) {
    this.options.minPxPerSec = minPxPerSec
    this.reRender()
  }

  private scrollIntoView(progress: number, isPlaying = false) {
    if (this.isUserInteracting && !isPlaying) {
      return
    }

    const animatedScrollLeft = this.lenis?.animatedScroll || this.scrollContainer.scrollLeft
    const { scrollWidth, clientWidth } = this.scrollContainer
    const progressWidth = progress * scrollWidth
    const startEdge = animatedScrollLeft
    const endEdge = animatedScrollLeft + clientWidth
    const middle = clientWidth / 2

    if (this.isDragging) {
      const EDGE_BUFFER = 80
      const leftBuffer = startEdge + EDGE_BUFFER
      const rightBuffer = endEdge - EDGE_BUFFER
      
      if (progressWidth < leftBuffer || progressWidth > rightBuffer) {
        const targetScrollLeft = progressWidth - middle
        
        if (this.lenis) {
          this.lenis.scrollTo(targetScrollLeft, {
            lerp: 0.08,
            duration: 0.4,
            immediate: false
          })
        }
      }
    } else {
      if (progressWidth < startEdge || progressWidth > endEdge) {
        const targetScrollLeft = progressWidth - (this.options.autoCenter ? middle : 0)
        
        if (this.lenis) {
          this.lenis.scrollTo(targetScrollLeft, {
            lerp: 0.06,
            duration: 0.6,
            immediate: false
          })
        } else {
          this.scrollContainer.scrollLeft = targetScrollLeft
        }
      }

      const center = progressWidth - animatedScrollLeft - middle
      if (isPlaying && this.options.autoCenter && center > 0) {
        const newScrollLeft = animatedScrollLeft + Math.min(center, 10)
        if (this.lenis) {
          this.lenis.scrollTo(newScrollLeft, { immediate: true })
        } else {
          this.scrollContainer.scrollLeft = newScrollLeft
        }
      }
    }
  }

  renderProgress(progress: number, isPlaying?: boolean) {
    if (isNaN(progress)) return
    const percents = progress * 100
    this.canvasWrapper.style.clipPath = `polygon(${percents}% 0%, 100% 0%, 100% 100%, ${percents}% 100%)`
    this.progressWrapper.style.width = `${percents}%`
    
    if (!this.isDragging) {
      this.updateCursorPosition(progress)
    }

    if (this.isScrollable && this.options.autoScroll) {
      this.scrollIntoView(progress, isPlaying)
    }
  }

  async exportImage(format: string, quality: number, type: 'dataURL' | 'blob'): Promise<string[] | Blob[]> {
    const canvases = this.canvasWrapper.querySelectorAll('canvas')
    if (!canvases.length) {
      throw new Error('No waveform data')
    }

    // Data URLs
    if (type === 'dataURL') {
      const images = Array.from(canvases).map((canvas) => canvas.toDataURL(format, quality))
      return Promise.resolve(images)
    }

    // Blobs
    return Promise.all(
      Array.from(canvases).map((canvas) => {
        return new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob)
              } else {
                reject(new Error('Could not export image'))
              }
            },
            format,
            quality,
          )
        })
      }),
    )
  }

  // Helper that computes bar metrics taking pixelRatio into account
  private getBarDimensions(options: WaveSurferOptions) {
    const barWidth = options.barWidth ? options.barWidth * this.getPixelRatio() : 1
    const barGap = options.barGap ? options.barGap * this.getPixelRatio() : options.barWidth ? barWidth / 2 : 0
    const barRadius = options.barRadius || 0
    return { barWidth, barGap, barRadius }
  }
}

export default Renderer
