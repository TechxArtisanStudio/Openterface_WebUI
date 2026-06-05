/**
 * WebRTC transport configuration
 */
export interface WebRtcTransportConfig {
  iceServers: RTCIceServer[]
  signalingUrl: string
}

/**
 * WebRTC connection states
 */
export type WebRtcConnectionState =
  | 'new'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'closed'
