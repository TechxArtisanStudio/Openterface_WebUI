<script setup lang="ts">
import { ref, provide, onMounted, onUnmounted, computed } from 'vue'
import { HIDTransportKey, loadWasm } from '@openterface/core'
import { Layout, BrowserWarningModal, useBrowserDetection } from '@openterface/control-ui'
import { useWebRtcTransport } from '@openterface/webrtc-core'

const transport = useWebRtcTransport()
provide(HIDTransportKey, transport)

const showWarning = ref(false)
const detection = useBrowserDetection()

// Auto-connect for WebRTC
const autoConnect = computed(() => !detection.fullSupport || true)

onMounted(async () => {
  try {
    await loadWasm()
    console.log('[App] WASM loaded')
  } catch (err) {
    console.error('[App] WASM load failed:', err)
  }
  if (!detection.fullSupport) {
    showWarning.value = true
  }
  // Auto-connect to Android server
  await transport.connect()
})

onUnmounted(() => {
  transport.disconnect()
})
</script>

<template>
  <Layout
    :show-camera-selector="false"
    :remote-stream="transport.remoteStream?.value ?? undefined"
    @show-warning="showWarning = true"
  />
  <BrowserWarningModal v-if="showWarning" @close="showWarning = false" />
</template>