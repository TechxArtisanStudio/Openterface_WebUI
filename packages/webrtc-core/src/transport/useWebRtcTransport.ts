import { ref, computed } from 'vue'
import { TransportState, type TransportDeviceInfo, type HIDTransport } from '@openterface/core'

/**
 * Extended HIDTransport with WebRTC-specific properties
 */
export interface WebRtcHIDTransport extends HIDTransport {
  /** The remote video stream from the peer connection */
  remoteStream: ReturnType<typeof ref<MediaStream | null>>
}

/**
 * WebRTC transport implementation using RTCPeerConnection + RTCDataChannel.
 * Implements HIDTransport interface with CH9329 → JSON translation for Android.
 */
export function useWebRtcTransport(): WebRtcHIDTransport {
  const pc = ref<RTCPeerConnection | null>(null)
  const dc = ref<RTCDataChannel | null>(null)
  const state = ref<TransportState>(TransportState.Disconnected)
  const deviceInfo = ref<TransportDeviceInfo | null>(null)
  const remoteStream = ref<MediaStream | null>(null)

  const isConnected = computed(() => state.value === TransportState.Connected)

  async function connect(): Promise<boolean> {
    if (state.value !== TransportState.Disconnected) return false

    state.value = TransportState.Connecting
    console.log('[WebRTC] Creating peer connection...')

    try {
      // 1. Create RTCPeerConnection
      pc.value = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      })

      // 2. Create DataChannel for HID commands
      dc.value = pc.value.createDataChannel('hid', { ordered: true })
      dc.value.binaryType = 'arraybuffer'

      dc.value.onopen = () => {
        console.log('[WebRTC] DataChannel opened')
        state.value = TransportState.Connected
      }

      dc.value.onclose = () => {
        console.log('[WebRTC] DataChannel closed')
        state.value = TransportState.Disconnected
      }

      dc.value.onerror = (err) => {
        console.error('[WebRTC] DataChannel error:', err)
        state.value = TransportState.Error
      }

      // 3. Add transceiver for receiving video from Android
      pc.value.addTransceiver('video', { direction: 'recvonly' })

      // 4. Handle remote video track
      pc.value.ontrack = (event) => {
        console.log('[WebRTC] Received remote track:', event.track.kind)
        if (event.track.kind === 'video') {
          remoteStream.value = event.streams[0]
        }
      }

      // 5. Handle ICE candidates
      const iceCandidates: RTCIceCandidateInit[] = []
      pc.value.onicecandidate = (event) => {
        if (event.candidate) {
          iceCandidates.push(event.candidate.toJSON())
          // Send to server
          fetch('/ice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(event.candidate.toJSON()),
          }).catch(err => console.error('[WebRTC] ICE send error:', err))
        }
      }

      // 6. Create offer
      const offer = await pc.value.createOffer()
      await pc.value.setLocalDescription(offer)
      console.log('[WebRTC] Created offer')

      // 7. Send offer to server
      const response = await fetch('/offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: offer.type, sdp: offer.sdp }),
      })

      if (!response.ok) {
        throw new Error(`Offer failed: ${response.status}`)
      }

      // 8. Poll for answer
      console.log('[WebRTC] Waiting for answer...')
      const answer = await pollForAnswer()

      // 9. Set remote description
      await pc.value.setRemoteDescription(answer)
      console.log('[WebRTC] Set remote description')

      // 10. Start polling for ICE candidates
      startIceCandidatePolling()

      return true
    } catch (err) {
      console.error('[WebRTC] Connection error:', err)
      state.value = TransportState.Error
      return false
    }
  }

  let icePollInterval: ReturnType<typeof setInterval> | null = null

  async function pollForAnswer(): Promise<RTCSessionDescriptionInit> {
    const maxAttempts = 60 // 60 seconds timeout
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch('/sdp')
        if (response.ok) {
          const data = await response.json()
          if (data.type === 'answer' && data.sdp) {
            console.log('[WebRTC] Got answer from server')
            // Process any ICE candidates from Android (initial batch)
            processIceCandidates(data.candidates)
            return { type: data.type, sdp: data.sdp }
          }
        }
      } catch (err) {
        // Ignore polling errors
      }
      await new Promise(r => setTimeout(r, 1000))
    }
    throw new Error('Timeout waiting for answer')
  }

  function processIceCandidates(candidates: any[] | undefined) {
    if (!candidates || !Array.isArray(candidates)) return
    for (const cand of candidates) {
      try {
        const candidate = new RTCIceCandidate(cand)
        pc.value?.addIceCandidate(candidate)
        console.log('[WebRTC] Added Android ICE candidate')
      } catch (e) {
        console.error('[WebRTC] Failed to add ICE candidate:', e)
      }
    }
  }

  function startIceCandidatePolling() {
    // Stop any existing polling
    if (icePollInterval) {
      clearInterval(icePollInterval)
      icePollInterval = null
    }
    // Poll for new ICE candidates every 500ms for 30 seconds
    let pollCount = 0
    const maxPolls = 60
    icePollInterval = setInterval(async () => {
      pollCount++
      if (pollCount > maxPolls) {
        if (icePollInterval) {
          clearInterval(icePollInterval)
          icePollInterval = null
        }
        return
      }
      try {
        const response = await fetch('/sdp')
        if (response.ok) {
          const data = await response.json()
          processIceCandidates(data.candidates)
        }
      } catch (err) {
        // Ignore polling errors
      }
    }, 500)
  }

  async function disconnect(): Promise<void> {
    state.value = TransportState.Disconnected
    deviceInfo.value = null
    remoteStream.value = null

    // Stop ICE candidate polling
    if (icePollInterval) {
      clearInterval(icePollInterval)
      icePollInterval = null
    }

    if (dc.value) {
      dc.value.close()
      dc.value = null
    }

    if (pc.value) {
      pc.value.close()
      pc.value = null
    }

    console.log('[WebRTC] Disconnected')
  }

  /**
   * Write data to DataChannel.
   * Translates CH9329 binary frames to JSON for Android compatibility.
   */
  async function write(data: Uint8Array): Promise<void> {
    if (dc.value?.readyState !== 'open') {
      console.warn('[WebRTC] Cannot write: DataChannel not open')
      return
    }

    // Detect CH9329 frame header (0x57 0xAB)
    if (data.length >= 6 && data[0] === 0x57 && data[1] === 0xab) {
      const command = data[3]

      if (command === 0x02) { // Keyboard command
        const modifier = data[4]
        const hidCode = data[5]
        const keysym = hidToVncKeysym(hidCode, modifier)
        const msg = JSON.stringify({ type: 'keyboard', keysym, down: true })
        dc.value.send(new TextEncoder().encode(msg))
        return
      }

      if (command === 0x05) { // Mouse absolute command
        const buttons = data[4]
        const x = (data[5] << 8) | data[6]
        const y = (data[7] << 8) | data[8]
        const msg = JSON.stringify({
          type: 'mouse',
          buttonMask: buttons,
          x, y,
          pressed: buttons !== 0
        })
        dc.value.send(new TextEncoder().encode(msg))
        return
      }

      if (command === 0x04) { // Mouse relative command
        // Android doesn't support relative mouse, send absolute with current position
        const buttons = data[4]
        const dx = data[5]
        const dy = data[6]
        const wheel = data[7]
        // For now, just send as-is - Android may handle or ignore
        const msg = JSON.stringify({
          type: 'mouse',
          buttonMask: buttons,
          x: dx,  // Approximate
          y: dy,
          pressed: buttons !== 0
        })
        dc.value.send(new TextEncoder().encode(msg))
        return
      }
    }

    // Fallback: send raw binary
    dc.value.send(data)
  }

  async function queryDeviceInfo(): Promise<void> {
    console.log('[WebRTC] Query device info requested')
  }

  return {
    state,
    deviceInfo,
    isConnected,
    remoteStream,
    connect,
    disconnect,
    write,
    queryDeviceInfo,
  }
}

/**
 * Convert HID usage code to VNC keysym
 * Basic mapping for a-z, 0-9
 * TODO: Expand full mapping based on Android's VncKeyMap.java
 */
function hidToVncKeysym(hidCode: number, modifier: number): number {
  // Letter keys (a-z): HID 0x04-0x1d
  if (hidCode >= 0x04 && hidCode <= 0x1d) {
    // a-z (lowercase ASCII)
    return 0x61 + (hidCode - 0x04)
  }

  // Number keys: HID 0x1e-0x27
  if (hidCode >= 0x1e && hidCode <= 0x26) { // 1-9
    return 0x31 + (hidCode - 0x1e)
  }
  if (hidCode === 0x27) { // 0
    return 0x30
  }

  // Common special keys
  const specialKeys: Record<number, number> = {
    0x28: 0xff0d, // Return
    0x29: 0xff1b, // Escape
    0x2a: 0xff08, // Backspace
    0x2b: 0xff09, // Tab
    0x2c: 0x0020, // Space
    0x2d: 0x002d, // -
    0x2e: 0x003d, // =
    0x2f: 0x005b, // [
    0x30: 0x005d, // ]
    0x31: 0x005c, // \
    0x33: 0x003b, // ;
    0x34: 0x0027, // '
    0x35: 0x0060, // `
    0x36: 0x002c, // ,
    0x37: 0x002e, // .
    0x38: 0x002f, // /
  }

  if (specialKeys[hidCode]) {
    return specialKeys[hidCode]
  }

  // Function keys F1-F12
  if (hidCode >= 0x3a && hidCode <= 0x45) {
    // F1 = 0xffbe, F2 = 0xffbf, etc.
    return 0xffbe + (hidCode - 0x3a)
  }

  // Arrow keys
  if (hidCode === 0x50) return 0xff52 // Up
  if (hidCode === 0x51) return 0xff54 // Down
  if (hidCode === 0x4f) return 0xff53 // Right
  if (hidCode === 0x52) return 0xff51 // Left

  // Unknown HID code - return as-is
  return hidCode
}