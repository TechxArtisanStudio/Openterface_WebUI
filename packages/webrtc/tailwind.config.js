/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
    '../control-ui/src/**/*.{vue,js,ts,jsx,tsx}',
    '../core/src/**/*.{vue,js,ts,jsx,tsx}',
    '../webrtc-core/src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
