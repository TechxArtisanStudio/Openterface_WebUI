/**
 * Signaling protocol for Openterface WebRTC
 * Client (Web) ↔ Server (Android NanoHTTPD)
 */

/**
 * POST /offer - Client sends SDP offer
 */
export interface SdpOfferRequest {
  type: 'offer'
  sdp: string
}

/**
 * GET /sdp response - Server returns SDP answer and ICE candidates
 */
export interface SdpAnswerResponse {
  type: 'answer'
  sdp: string
  status: 'waiting' | 'ready'
  candidates: IceCandidate[]
}

/**
 * ICE candidate
 */
export interface IceCandidate {
  candidate: string
  sdpMid: string
  sdpMLineIndex: number
}

/**
 * POST /ice - Client sends ICE candidate to server
 */
export interface IceCandidateMessage {
  candidate: IceCandidate
}

/**
 * DataChannel JSON message: Keyboard event
 */
export interface KeyboardMessage {
  type: 'keyboard'
  keysym: number      // VNC keysym value
  down: boolean      // true = press, false = release
}

/**
 * DataChannel JSON message: Mouse event
 */
export interface MouseMessage {
  type: 'mouse'
  buttonMask: number  // 1=left, 2=middle, 4=right
  x: number           // Absolute X (0-4095 for CH9329)
  y: number           // Absolute Y (0-4095 for CH9329)
  pressed: boolean    // Any button pressed
}