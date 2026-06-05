// WebRTC Core exports

// Transport
export { useWebRtcTransport, type WebRtcHIDTransport } from './transport/useWebRtcTransport'

// Protocol
export { useWebRtcJsonCommands } from './protocol/useWebRtcJsonCommands'
export type {
  SdpOfferRequest,
  SdpAnswerResponse,
  IceCandidate,
  IceCandidateMessage,
  KeyboardMessage,
  MouseMessage,
} from './protocol/signaling-protocol'

// Types
export type {
  WebRtcTransportConfig,
  WebRtcConnectionState,
} from './types/webrtc-types'