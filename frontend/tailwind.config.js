/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'graph-bg': '#0a0a0f',
        'graph-node': '#4f46e5',
        'graph-edge': '#3b82f6',
        'graph-highlight': '#10b981',
      },
    },
  },
  plugins: [],
}
