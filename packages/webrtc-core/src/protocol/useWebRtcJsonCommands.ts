/**
 * JSON-based HID command sender for WebRTC DataChannel.
 * Translates high-level HID commands to JSON messages that Android expects.
 */
import type { HIDTransport } from '@openterface/core'

export function useWebRtcJsonCommands(transport: HIDTransport) {
  /**
   * Send mouse event as JSON via DataChannel.
   * Android expects: { type: "mouse", buttonMask, x, y, pressed }
   */
  async function sendMouseEvent(buttonMask: number, x: number, y: number, pressed: boolean): Promise<void> {
    const message = JSON.stringify({
      type: 'mouse',
      buttonMask,
      x,
      y,
      pressed
    })
    await transport.write(new TextEncoder().encode(message))
  }

  /**
   * Send keyboard event as JSON via DataChannel.
   * Android expects: { type: "keyboard", keysym, down }
   */
  async function sendKeyboardEvent(keysym: number, down: boolean): Promise<void> {
    const message = JSON.stringify({
      type: 'keyboard',
      keysym,
      down
    })
    console.log('[WebRTC] Sending keyboard:', message)
    await transport.write(new TextEncoder().encode(message))
  }

  /**
   * Send absolute mouse move.
   * buttonMask: 0 = move only, 1 = left, 2 = middle, 4 = right
   */
  async function sendMouseAbsolute(x: number, y: number, buttonMask: number = 0): Promise<void> {
    await sendMouseEvent(buttonMask, x, y, buttonMask !== 0)
  }

  /**
   * Send mouse button press.
   */
  async function sendMouseButton(x: number, y: number, button: 'left' | 'middle' | 'right', pressed: boolean): Promise<void> {
    const buttonMask = button === 'left' ? 1 : button === 'middle' ? 2 : button === 'right' ? 4 : 0
    await sendMouseEvent(buttonMask, x, y, pressed)
  }

  /**
   * Send key press (uses RFB keysym values).
   */
  async function sendKeyDown(keysym: number): Promise<void> {
    await sendKeyboardEvent(keysym, true)
  }

  /**
   * Send key release.
   */
  async function sendKeyUp(keysym: number): Promise<void> {
    await sendKeyboardEvent(keysym, false)
  }

  return {
    sendMouseEvent,
    sendKeyboardEvent,
    sendMouseAbsolute,
    sendMouseButton,
    sendKeyDown,
    sendKeyUp
  }
}