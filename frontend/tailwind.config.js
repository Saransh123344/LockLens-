/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f4ff',
          100: '#e0e9ff',
          500: '#4f6ef7',
          600: '#3d5cf5',
          700: '#2b49e8',
          900: '#1a2d9e',
        },
        danger: '#ef4444',
        success: '#22c55e',
        warning: '#f59e0b',
      }
    }
  },
  plugins: [],
}
