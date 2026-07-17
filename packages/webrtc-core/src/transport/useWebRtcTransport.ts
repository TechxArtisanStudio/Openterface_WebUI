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
          // Mark as connected so the welcome poster hides immediately
          // (DataChannel may open separately but media can flow independently)
          state.value = TransportState.Connected
        }
      }

      // 5. Track ICE connection state
      pc.value.oniceconnectionstatechange = () => {
        console.log('[WebRTC] ICE state:', pc.value?.iceConnectionState)
        if (pc.value?.iceConnectionState === 'failed') {
          state.value = TransportState.Error
        }
      }

      // 5. Handle ICE candidates
      const iceCandidates: RTCIceCandidateInit[] = []
      pc.value.onicecandidate = (event) => {
        if (event.candidate) {
          const candJson = event.candidate.toJSON()
          console.log('[WebRTC] Local ICE candidate:', JSON.stringify(candJson))
          iceCandidates.push(candJson)
          // Send to server
          fetch('/ice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(candJson),
          })
            .then(() => console.log('[WebRTC] Local ICE sent to server'))
            .catch(err => console.error('[WebRTC] ICE send error:', err))
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

      // 8. Poll for answer (returns both SDP and initial ICE candidates)
      console.log('[WebRTC] Waiting for answer...')
      const { sdp: answerSdp, initialCandidates } = await pollForAnswer()

      // 9. Set remote description FIRST
      const answer = { type: 'answer' as RTCSdpType, sdp: answerSdp }
      await pc.value.setRemoteDescription(answer)
      console.log('[WebRTC] Set remote description')

      // 10. Process initial ICE candidates from server (only NOW that remote description is set)
      processIceCandidates(initialCandidates)

      // 11. Start polling for additional ICE candidates
      startIceCandidatePolling()

      return true
    } catch (err) {
      console.error('[WebRTC] Connection error:', err)
      state.value = TransportState.Error
      return false
    }
  }

  let icePollInterval: ReturnType<typeof setInterval> | null = null

  async function pollForAnswer(): Promise<{ sdp: string, initialCandidates: any[] }> {
    const maxAttempts = 60 // 60 seconds timeout
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch('/sdp')
        if (response.ok) {
          const data = await response.json()
          if (data.type === 'answer' && data.sdp) {
            console.log('[WebRTC] Got answer from server')
            return { sdp: data.sdp, initialCandidates: data.candidates || [] }
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
   *
   * Handles both single 14-byte frames and dual 28-byte press+release frames
   * from WASM keymod's buildPressRelease().
   */
  async function write(data: Uint8Array): Promise<void> {
    if (dc.value?.readyState !== 'open') {
      console.warn('[WebRTC] Cannot write: DataChannel not open')
      return
    }

    // Handle WASM buildPressRelease 28-byte dual frame
    // This is two concatenated 14-byte CH9329 keyboard frames:
    // [0..13]  = press frame (modifier + hidCode)
    // [14..27] = release frame (all zeros)
    if (data.length === 28 && data[0] === 0x57 && data[1] === 0xab && data[3] === 0x02) {
      // Process press frame
      sendKeyboardFrame(data.subarray(0, 14))
      // Process release frame
      sendKeyboardFrame(data.subarray(14, 28))
      return
    }

    // Detect CH9329 frame header (0x57 0xAB)
    if (data.length >= 6 && data[0] === 0x57 && data[1] === 0xab) {
      const command = data[3]

      if (command === 0x02) { // Keyboard command
        sendKeyboardFrame(data)
        return
      }

      if (command === 0x04) { // Mouse absolute command
        // Core CH9329 absolute mouse packet format:
        // 57 AB 00 04 07 | mode | buttons | x_lo | x_hi | y_lo | y_hi | wheel | checksum
        const buttons = data[6]
        const x = data[7] | (data[8] << 8)
        const y = data[9] | (data[10] << 8)
        const msg = JSON.stringify({
          type: 'mouse',
          buttonMask: buttons,
          x, y,
          pressed: buttons !== 0
        })
        dc.value.send(new TextEncoder().encode(msg))
        return
      }

      if (command === 0x05) { // Mouse relative command
        // Core CH9329 relative mouse packet format:
        // 57 AB 00 05 05 | mode | buttons | deltaX | deltaY | wheel | checksum
        const buttons = data[6]
        const dx = data[7]
        const dy = data[8]
        const msg = JSON.stringify({
          type: 'mouse',
          buttonMask: buttons,
          x: dx,
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

  /**
   * Send a single 14-byte CH9329 keyboard frame as JSON.
   * Preserves the raw modifier byte so the Android side can apply
   * shift/ctrl/alt/win correctly when building the CH9329 HID frame.
   */
  function sendKeyboardFrame(frame: Uint8Array): void {
    // Core CH9329 keyboard packet format:
    // 57 AB 00 02 08 | modifier | reserved | key1..key6 | checksum
    const modifier = frame[5]
    const hidCode = frame[7]

    console.log('[WebRTC] sendKeyboardFrame: frame[5]=0x' + modifier.toString(16) + ', frame[7]=0x' + hidCode.toString(16) + ', frameLen=' + frame.length)

    // Empty key list means release all keys
    if (!hidCode && modifier === 0) {
      console.log('[WebRTC] Sending release frame')
      const msg = JSON.stringify({ type: 'keyboard', keysym: 0, down: false, modifier: 0 })
      dc.value.send(new TextEncoder().encode(msg))
      return
    }

    const keysym = hidToVncKeysym(hidCode, modifier)
    const msg = JSON.stringify({ type: 'keyboard', keysym, down: true, modifier })
    console.log('[WebRTC] Sending keyboard:', msg)
    dc.value.send(new TextEncoder().encode(msg))
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
 * Convert HID usage code to VNC keysym.
 * Checks the CH9329 modifier byte to return the correct case/symbol.
 *
 * Modifier byte layout (bit positions):
 *   bit 0 (0x01) = Left Ctrl
 *   bit 1 (0x02) = Left Shift
 *   bit 2 (0x04) = Left Alt
 *   bit 3 (0x08) = Left Win
 *   bit 4 (0x10) = Right Ctrl
 *   bit 5 (0x20) = Right Shift
 *   bit 6 (0x40) = Right Alt
 *   bit 7 (0x80) = Right Win
 */
function hidToVncKeysym(hidCode: number, modifier: number): number {
  console.log('[WebRTC] hidToVncKeysym: hidCode=0x' + hidCode.toString(16) + ', modifier=0x' + modifier.toString(16))

  // Check if any shift is held (Left Shift bit 1 or Right Shift bit 5)
  const shiftHeld = (modifier & 0x22) !== 0
  console.log('[WebRTC] shiftHeld=' + shiftHeld)

  // Letter keys (a-z / A-Z): HID 0x04-0x1d
  if (hidCode >= 0x04 && hidCode <= 0x1d) {
    return shiftHeld
      ? 0x41 + (hidCode - 0x04)  // A-Z (uppercase)
      : 0x61 + (hidCode - 0x04)  // a-z (lowercase)
  }

  // Number row keys: HID 0x1e-0x27
  // Without shift: 1-9, 0
  // With shift:      !, @, #, $, %, ^, &, *, (, )
  const numberShiftMap: Record<number, number> = {
    0x1e: 0x21, // 1 → !
    0x1f: 0x40, // 2 → @
    0x20: 0x23, // 3 → #
    0x21: 0x24, // 4 → $
    0x22: 0x25, // 5 → %
    0x23: 0x5e, // 6 → ^
    0x24: 0x26, // 7 → &
    0x25: 0x2a, // 8 → *
    0x26: 0x28, // 9 → (
    0x27: 0x29, // 0 → )
  }

  if (hidCode >= 0x1e && hidCode <= 0x27) {
    if (shiftHeld) return numberShiftMap[hidCode]
    // No shift: digits
    if (hidCode <= 0x26) return 0x31 + (hidCode - 0x1e)  // 1-9
    return 0x30  // 0
  }

  // Common special keys: HID 0x28-0x38
  // Shift produces shifted punctuation symbols
  if (shiftHeld) {
    const shiftedSpecialKeys: Record<number, number> = {
      0x2d: 0x005f, // - → _
      0x2e: 0x002b, // = → +
      0x2f: 0x007b, // [ → {
      0x30: 0x007d, // ] → }
      0x31: 0x007c, // \ → |
      0x33: 0x003a, // ; → :
      0x34: 0x0022, // ' → "
      0x35: 0x007e, // ` → ~
      0x36: 0x003c, // , → <
      0x37: 0x003e, // . → >
      0x38: 0x003f, // / → ?
    }
    if (shiftedSpecialKeys[hidCode]) return shiftedSpecialKeys[hidCode]
  }

  // Non-shifted special keys (same regardless of modifier)
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

  // Function keys F1-F12 (modifiers don't change the keysym)
  if (hidCode >= 0x3a && hidCode <= 0x45) {
    // F1 = 0xffbe, F2 = 0xffbf, etc.
    return 0xffbe + (hidCode - 0x3a)
  }

  // Arrow keys (modifiers don't change the keysym)
  if (hidCode === 0x50) return 0xff52 // Up
  if (hidCode === 0x51) return 0xff54 // Down
  if (hidCode === 0x4f) return 0xff53 // Right
  if (hidCode === 0x52) return 0xff51 // Left

  // Unknown HID code - return as-is
  return hidCode
}